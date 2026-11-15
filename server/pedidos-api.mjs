// API y servidor MCP de pedidos: cualquier IA (Claude, ChatGPT, Gemini, n8n…) puede consultar el catálogo y dejar un pedido.
// Los pedidos NO entran directo a tus ventas: quedan en «Pedidos entrantes» hasta que la tienda los acepte.
// Requiere FIREBASE_SERVICE_ACCOUNT. Las claves se crean en el panel (Integraciones) y solo se guarda su huella (SHA-256).
import { notificar } from './push.mjs';
import * as oauth from './oauth.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { cuentaServicio, leerDoc, listarDocs, crearDoc, actualizarDoc } from './fs-admin.mjs';

const VERSION = '1.0.0';
const PROTOCOLOS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BYTES = 60_000;
const golpes = new Map();
const fallos = new Map();
const cacheClaves = new Map();
const cacheCat = new Map();

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const limpio = (s, n = 120) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function limite(mapa, quien, max) {
  const ahora = Date.now(), l = (mapa.get(quien) || []).filter((t) => ahora - t < 60_000);
  l.push(ahora); mapa.set(quien, l);
  if (mapa.size > 800) for (const [k, v] of mapa) if (!v.some((t) => ahora - t < 60_000)) mapa.delete(k);
  return l.length > max;
}
class ErrorApi extends Error { constructor(estado, codigo, mensaje, extra) { super(mensaje); this.estado = estado; this.codigo = codigo; this.extra = extra || {}; } }

/* ---------- autenticación por clave ---------- */
export function claveDe(headers, query) {
  const h = (n) => headers[n] || headers[n.toLowerCase()] || '';
  const b = /^Bearer\s+(.+)$/i.exec(String(h('authorization')));
  return (b && b[1].trim()) || String(h('x-api-key') || '').trim() || String((query && (query.key || query.k)) || '').trim();
}
async function autenticar(clave) {
  if (/^ya_/.test(clave || '')) {
    const a = await oauth.verificarAcceso(clave);
    if (!a) throw new ErrorApi(401, 'token_invalido', 'El acceso venció o fue revocado. Vuelve a conectar.');
    return { id: 'oa:' + a.uid.slice(0, 8), huella: null, nombre: 'IA: ' + (a.cliente || 'OAuth'), adminUid: a.uid, scopes: a.scopes, ultimo: Date.now() };
  }
  if (!/^yk_[A-Za-z0-9_-]{24,80}$/.test(clave || '')) throw new ErrorApi(401, 'clave_invalida', 'Falta la clave de API o no es válida.');
  const huella = sha(clave), c = cacheClaves.get(huella);
  if (c && Date.now() < c.vence) return c.val;
  const d = await leerDoc('apiKeys/' + huella);
  if (!d || d.activa === false || !d.adminUid) { cacheClaves.delete(huella); throw new ErrorApi(401, 'clave_invalida', 'La clave de API no existe o está desactivada.'); }
  const val = { id: huella.slice(0, 10), huella, nombre: String(d.nombre || 'Integración'), adminUid: String(d.adminUid), scopes: Array.isArray(d.scopes) && d.scopes.length ? d.scopes : ['catalogo', 'pedidos'], ultimo: Number(d.ultimoUso) || 0 };
  cacheClaves.set(huella, { val, vence: Date.now() + 30_000 });
  return val;
}
const exige = (k, scope) => { if (!k.scopes.includes(scope)) throw new ErrorApi(403, 'sin_permiso', `Esta clave no tiene permiso de «${scope}».`); };

/* ---------- catálogo ---------- */
async function cargarCatalogo(uid) {
  const c = cacheCat.get(uid);
  if (c && Date.now() < c.vence) return c.val;
  const [inv, cfg] = await Promise.all([listarDocs(`users/${uid}/inventory`), leerDoc(`users/${uid}/config/settings`)]);
  const variantes = inv.filter((i) => i.tipo === 'prenda').map((i) => ({ id: i.id, producto: String(i.nombre || ''), modelo: String(i.cuello || ''), talla: String(i.talla || ''), color: String(i.color || ''), stock: Math.max(0, num(i.stock)), precio: num(i.precio) }));
  const val = { variantes, tienda: { nombre: String((cfg && cfg.marca) || 'Yosca Moda'), whatsapp: String((cfg && cfg.waEmpresa) || '') } };
  cacheCat.set(uid, { val, vence: Date.now() + 20_000 });
  return val;
}
function catalogoPublico(cat, { busqueda, incluir_agotados } = {}) {
  const q = norm(busqueda);
  const g = new Map();
  for (const v of cat.variantes) {
    const k = norm(v.producto) + '|' + norm(v.modelo);
    if (!g.has(k)) g.set(k, { producto: v.producto, modelo: v.modelo, precio: 0, variantes: [] });
    const x = g.get(k); if (v.precio > 0) x.precio = v.precio;
    if (v.stock > 0 || incluir_agotados) x.variantes.push({ variante_id: v.id, talla: v.talla, color: v.color, disponible: v.stock > 0, cantidad_disponible: Math.min(v.stock, 20) });
  }
  let out = [...g.values()].filter((x) => x.variantes.length);
  if (q) out = out.filter((x) => norm(x.producto + ' ' + x.modelo + ' ' + x.variantes.map((v) => v.talla + ' ' + v.color).join(' ')).includes(q));
  return { tienda: cat.tienda, moneda: 'PEN', productos: out.slice(0, 40) };
}

/* ---------- pedidos ---------- */
function resolverItems(itemsIn, cat) {
  if (!Array.isArray(itemsIn) || !itemsIn.length) throw new ErrorApi(400, 'sin_items', 'Falta la lista de productos del pedido (items).');
  if (itemsIn.length > 20) throw new ErrorApi(400, 'demasiados_items', 'Máximo 20 líneas por pedido.');
  const lineas = new Map(), errores = [];
  const prods = [...new Set(cat.variantes.map((v) => v.producto + (v.modelo ? ' · ' + v.modelo : '')))];
  for (const it of itemsIn) {
    const cant = Math.floor(num(it && it.cantidad)) || 1;
    if (cant < 1 || cant > 50) { errores.push({ codigo: 'cantidad_invalida', mensaje: 'La cantidad por línea debe estar entre 1 y 50.', item: it }); continue; }
    let cand = [];
    if (it && it.variante_id) cand = cat.variantes.filter((v) => v.id === String(it.variante_id));
    else {
      const p = norm(it && it.producto), t = norm(it && it.talla), c = norm(it && it.color), m = norm(it && it.modelo);
      cand = cat.variantes.filter((v) => (!p || norm(v.producto + ' ' + v.modelo).includes(p)) && (!m || norm(v.modelo).includes(m)) && (!t || norm(v.talla) === t) && (!c || norm(v.color) === c || (c.length >= 4 && norm(v.color).startsWith(c))));
      if (cand.length > 1) { const exacto = cand.filter((v) => norm(v.color) === c && (!t || norm(v.talla) === t)); if (exacto.length === 1) cand = exacto; }
    }
    if (!cand.length) { errores.push({ codigo: 'no_encontrado', mensaje: 'No encontré ese producto, talla o color en el catálogo. Usa ver_catalogo y elige un variante_id.', item: it, productos: prods.slice(0, 12) }); continue; }
    if (cand.length > 1) { errores.push({ codigo: 'ambiguo', mensaje: 'Hay varias opciones posibles. Pide al cliente que precise y usa el variante_id.', item: it, opciones: cand.slice(0, 8).map((v) => ({ variante_id: v.id, producto: v.producto, modelo: v.modelo, talla: v.talla, color: v.color })) }); continue; }
    const v = cand[0], prev = lineas.get(v.id), total = (prev ? prev.cantidad : 0) + cant;
    if (total > v.stock) { errores.push({ codigo: 'sin_stock', mensaje: `No alcanza el stock de ${v.producto} ${v.modelo} ${v.talla} ${v.color}: quedan ${v.stock}.`, variante_id: v.id, disponible: v.stock }); continue; }
    lineas.set(v.id, { variante_id: v.id, producto: v.producto, modelo: v.modelo, talla: v.talla, color: v.color, cantidad: total, precio_unit: v.precio, subtotal: r2(v.precio * total) });
  }
  const lista = [...lineas.values()];
  return { lineas: lista, total: r2(lista.reduce((a, l) => a + l.subtotal, 0)), unidades: lista.reduce((a, l) => a + l.cantidad, 0), errores };
}
function validarCliente(c) {
  c = c || {};
  const nombre = limpio(c.nombre, 80);
  let cel = String(c.celular || '').replace(/\D/g, ''); if (cel.length === 11 && cel.startsWith('51')) cel = cel.slice(2);
  const errs = [];
  if (nombre.length < 2) errs.push('nombre');
  if (!/^9\d{8}$/.test(cel)) errs.push('celular (9 dígitos, empieza con 9)');
  const ciudad = limpio(c.ciudad, 60); if (ciudad.length < 2) errs.push('ciudad');
  const dni = String(c.dni || '').replace(/\D/g, ''); if (c.dni && dni.length !== 8) errs.push('dni (8 dígitos)');
  if (errs.length) throw new ErrorApi(400, 'datos_incompletos', 'Faltan o son inválidos estos datos del cliente: ' + errs.join(', ') + '.', { faltan: errs });
  return { nombre, celular: cel, ciudad, dni: dni.length === 8 ? dni : '', direccion: limpio(c.direccion, 140), agencia: limpio(c.agencia, 80), referencia: limpio(c.referencia, 140) };
}
async function crearPedido(k, p, { soloCalcular = false } = {}) {
  const cat = await cargarCatalogo(k.adminUid), r = resolverItems(p && p.items, cat);
  if (soloCalcular) return { ok: !r.errores.length, ...r };
  if (r.errores.length) throw new ErrorApi(422, 'items_invalidos', 'Hay productos que no se pudieron agregar. Corrígelos y vuelve a intentar.', { errores: r.errores });
  if (r.unidades > 200) throw new ErrorApi(400, 'demasiadas_unidades', 'Máximo 200 unidades por pedido.');
  const cliente = validarCliente(p.cliente);
  const bucket = Math.floor(Date.now() / 600_000), firma = r.lineas.map((l) => l.variante_id + ':' + l.cantidad).sort().join(',');
  const id = p.id_externo ? 'x_' + sha(k.id + '|' + limpio(p.id_externo, 80)).slice(0, 24) : 'd_' + sha(k.id + '|' + cliente.celular + '|' + firma + '|' + bucket).slice(0, 24);
  const doc = { estado: 'pendiente', creado: Date.now(), fecha: hoyLima(), origen: k.nombre, clave: k.id, cliente, items: r.lineas, total: r.total, unidades: r.unidades, notas: limpio(p.notas, 300), medio_pago: limpio(p.medio_pago, 30), id_externo: limpio(p.id_externo, 80) };
  let duplicado = false;
  try { await crearDoc(`users/${k.adminUid}/entrantes`, id, doc); }
  catch (e) { if (e.estado === 409) duplicado = true; else throw e; }
  if (!duplicado) await notificar(k.adminUid, { titulo: 'Nuevo pedido de IA', cuerpo: `${cliente.nombre} · S/ ${r.total.toFixed(2)} · ${r.unidades} und. (${k.nombre})`, url: '/?ir=pedidos' });
  return {
    ok: true, pedido_id: id, estado: 'pendiente_de_confirmacion', duplicado, total: r.total, moneda: 'PEN', unidades: r.unidades, items: r.lineas.map((l) => ({ producto: `${l.producto} ${l.modelo}`.trim(), talla: l.talla, color: l.color, cantidad: l.cantidad, subtotal: l.subtotal })),
    mensaje_para_cliente: `¡Listo, ${cliente.nombre.split(' ')[0]}! Recibimos tu pedido por S/ ${r.total.toFixed(2)}. La tienda lo confirmará contigo en breve (te escribirán al ${cliente.celular}).`,
  };
}
async function estadoPedidos(k, celular) {
  exige(k, 'consultar');
  let cel = String(celular || '').replace(/\D/g, ''); if (cel.length === 11 && cel.startsWith('51')) cel = cel.slice(2);
  if (!/^9\d{8}$/.test(cel)) throw new ErrorApi(400, 'celular_invalido', 'El celular debe tener 9 dígitos.');
  const [ord, ent] = await Promise.all([listarDocs(`users/${k.adminUid}/orders`), listarDocs(`users/${k.adminUid}/entrantes`)]);
  const igual = (t) => String(t || '').replace(/\D/g, '').slice(-9) === cel;
  const a = ord.filter((o) => igual(o.telefono)).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha))).slice(0, 3).map((o) => ({ fecha: o.fecha, estado: o.estado, producto: o.producto, total: r2(num(o.precio) * (num(o.cantidad) || 1)) }));
  const b = ent.filter((o) => o.cliente && igual(o.cliente.celular) && o.estado === 'pendiente').slice(0, 3).map((o) => ({ fecha: o.fecha, estado: 'pendiente_de_confirmacion', total: o.total }));
  return { ok: true, pedidos: [...b, ...a] };
}

/* ---------- herramientas MCP ---------- */
const ESQ_ITEM = { type: 'object', properties: { variante_id: { type: 'string', description: 'ID de la variante (talla+color) tomado de ver_catalogo. Es la forma más segura.' }, producto: { type: 'string', description: 'Nombre del producto, si no usas variante_id.' }, modelo: { type: 'string', description: 'Modelo o cuello (ej. V, redondo).' }, talla: { type: 'string' }, color: { type: 'string' }, cantidad: { type: 'integer', minimum: 1, maximum: 50, description: 'Unidades de esa variante.' } }, required: ['cantidad'] };
export const HERRAMIENTAS = [
  { name: 'ver_catalogo', description: 'Muestra los productos de la tienda con sus tallas, colores, precios (S/) y disponibilidad. Úsala SIEMPRE antes de armar un pedido para conocer los variante_id.', inputSchema: { type: 'object', properties: { busqueda: { type: 'string', description: 'Texto opcional para filtrar (ej. "polo negro", "talla M").' }, incluir_agotados: { type: 'boolean' } } }, scope: 'catalogo' },
  { name: 'calcular_pedido', description: 'Valida los productos de un pedido y calcula el total SIN crearlo. Úsala para confirmar con el cliente el resumen y el precio antes de registrar.', inputSchema: { type: 'object', properties: { items: { type: 'array', items: ESQ_ITEM, minItems: 1 } }, required: ['items'] }, scope: 'catalogo' },
  { name: 'crear_pedido', description: 'Registra el pedido del cliente. Queda «pendiente de confirmación» y la tienda lo revisa y acepta (no se cobra ni se descuenta stock aún). Antes de llamarla confirma con el cliente: nombre completo, celular de 9 dígitos, ciudad y los productos con talla, color y cantidad. Pide DNI y agencia de envío si los da.', inputSchema: { type: 'object', properties: { cliente: { type: 'object', properties: { nombre: { type: 'string' }, celular: { type: 'string', description: '9 dígitos, empieza con 9.' }, ciudad: { type: 'string' }, dni: { type: 'string', description: '8 dígitos (opcional).' }, direccion: { type: 'string' }, agencia: { type: 'string', description: 'Agencia de envío (Olva, Shalom…).' }, referencia: { type: 'string' } }, required: ['nombre', 'celular', 'ciudad'] }, items: { type: 'array', items: ESQ_ITEM, minItems: 1 }, notas: { type: 'string' }, medio_pago: { type: 'string', description: 'Yape, Plin, contra entrega…' }, id_externo: { type: 'string', description: 'ID único del chat o conversación, evita pedidos duplicados.' } }, required: ['cliente', 'items'] }, scope: 'pedidos' },
  { name: 'estado_pedido', description: 'Consulta el estado de los últimos pedidos de un cliente por su celular. Requiere permiso «consultar».', inputSchema: { type: 'object', properties: { celular: { type: 'string' } }, required: ['celular'] }, scope: 'consultar' },
];
async function ejecutar(nombre, args, k) {
  const h = HERRAMIENTAS.find((x) => x.name === nombre);
  if (!h) throw new ErrorApi(404, 'herramienta_desconocida', 'No existe la herramienta ' + nombre);
  exige(k, h.scope);
  if (nombre === 'ver_catalogo') return catalogoPublico(await cargarCatalogo(k.adminUid), args || {});
  if (nombre === 'calcular_pedido') return crearPedido(k, args || {}, { soloCalcular: true });
  if (nombre === 'crear_pedido') return crearPedido(k, args || {});
  return estadoPedidos(k, args && args.celular);
}

/* ---------- MCP (JSON-RPC sobre HTTP) ---------- */
async function mcp(cuerpo, k) {
  const una = async (m) => {
    const id = m && m.id;
    const resp = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return err(-32600, 'Solicitud no válida');
    if (id === undefined) return null; // notificación (initialized, cancelled…)
    switch (m.method) {
      case 'initialize': { const pv = m.params && m.params.protocolVersion; return resp({ protocolVersion: PROTOCOLOS.includes(pv) ? pv : PROTOCOLOS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'yosca-pedidos', title: 'Pedidos de la tienda', version: VERSION }, instructions: 'Eres el asistente de pedidos de la tienda. Habla en español, confirma siempre los datos con el cliente (nombre completo, celular, ciudad, productos, talla, color y cantidad) y usa ver_catalogo antes de crear_pedido.' }); }
      case 'ping': return resp({});
      case 'tools/list': return resp({ tools: HERRAMIENTAS.filter((h) => k.scopes.includes(h.scope)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const p = m.params || {};
        try {
          const out = await ejecutar(String(p.name || ''), p.arguments, k);
          return resp({ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false });
        } catch (e) {
          if (e instanceof ErrorApi) return resp({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.codigo, mensaje: e.message, ...e.extra }) }], isError: true });
          throw e;
        }
      }
      default: return err(-32601, 'Método no soportado: ' + m.method);
    }
  };
  if (Array.isArray(cuerpo)) { const r = (await Promise.all(cuerpo.map(una))).filter(Boolean); return r.length ? r : null; }
  return una(cuerpo);
}

/* ---------- OpenAPI (ChatGPT Actions, Gemini, Make, n8n…) ---------- */
export function openapi(origen) {
  const seg = [{ ApiKey: [] }];
  const itemRef = { $ref: '#/components/schemas/Item' };
  return {
    openapi: '3.1.0',
    info: { title: 'API de pedidos de la tienda', version: VERSION, description: 'Consulta el catálogo y deja pedidos de clientes. Los pedidos quedan pendientes de confirmación por la tienda.' },
    servers: [{ url: origen + '/api/v1' }],
    security: seg,
    paths: {
      '/catalogo': { get: { operationId: 'verCatalogo', summary: 'Catálogo con tallas, colores, precios y disponibilidad', parameters: [{ name: 'busqueda', in: 'query', schema: { type: 'string' } }, { name: 'incluir_agotados', in: 'query', schema: { type: 'boolean' } }], responses: { 200: { description: 'Catálogo' } } } },
      '/pedidos/calcular': { post: { operationId: 'calcularPedido', summary: 'Valida los items y calcula el total sin crear el pedido', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: itemRef } } } } } }, responses: { 200: { description: 'Resultado' } } } },
      '/pedidos': {
        post: { operationId: 'crearPedido', summary: 'Crea un pedido pendiente de confirmación', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['cliente', 'items'], properties: { cliente: { type: 'object', required: ['nombre', 'celular', 'ciudad'], properties: { nombre: { type: 'string' }, celular: { type: 'string' }, ciudad: { type: 'string' }, dni: { type: 'string' }, direccion: { type: 'string' }, agencia: { type: 'string' }, referencia: { type: 'string' } } }, items: { type: 'array', items: itemRef }, notas: { type: 'string' }, medio_pago: { type: 'string' }, id_externo: { type: 'string' } } } } } }, responses: { 200: { description: 'Pedido creado' }, 422: { description: 'Items inválidos' } } },
        get: { operationId: 'estadoPedidos', summary: 'Estado de los últimos pedidos de un celular (requiere permiso consultar)', parameters: [{ name: 'celular', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Pedidos' } } },
      },
    },
    components: {
      securitySchemes: { ApiKey: { type: 'http', scheme: 'bearer', description: 'Clave que empieza con yk_ (créala en el panel → Integraciones).' } },
      schemas: { Item: { type: 'object', required: ['cantidad'], properties: { variante_id: { type: 'string' }, producto: { type: 'string' }, modelo: { type: 'string' }, talla: { type: 'string' }, color: { type: 'string' }, cantidad: { type: 'integer', minimum: 1, maximum: 50 } } } },
    },
  };
}

/* ---------- entrada única ---------- */
export async function handle({ method, ruta, query = {}, headers = {}, rawBody = '', ip = '?', origen = '' }) {
  const res = (status, body, extra = {}) => ({ status, body, headers: extra });
  try {
    if (method === 'OPTIONS') return res(204, null);
    ruta = String(ruta || '').replace(/^\/+|\/+$/g, '');
    if (ruta === 'openapi' || ruta === 'openapi.json') return res(200, openapi(origen));
    if (!cuentaServicio()) return res(503, { ok: false, error: { codigo: 'no_configurado', mensaje: 'El servidor no tiene FIREBASE_SERVICE_ACCOUNT.' } });
    if (limite(golpes, 'ip:' + ip, 90)) throw new ErrorApi(429, 'limite', 'Demasiadas solicitudes. Espera un minuto.');
    if (ruta === 'wk-recurso') return res(200, oauth.metadatosRecurso(origen));
    if (ruta === 'wk-servidor' || ruta === 'wk-openid') return res(200, oauth.metadatosServidor(origen));
    if (ruta.startsWith('oauth/')) {
      if (method !== 'POST') return res(405, { error: 'metodo' }, { allow: 'POST, OPTIONS' });
      if (limite(golpes, 'oa:' + ip, 40)) return res(429, { error: 'slow_down', error_description: 'Demasiadas solicitudes.' });
      if (rawBody.length > MAX_BYTES) return res(413, { error: 'invalid_request' });
      let p = {};
      const ct = String((headers['content-type'] || '')).toLowerCase();
      try { p = /^\s*\{/.test(rawBody) || ct.includes('json') ? JSON.parse(rawBody || '{}') : Object.fromEntries(new URLSearchParams(rawBody)); } catch { return res(400, { error: 'invalid_request' }); }
      let r;
      if (ruta === 'oauth/register') r = oauth.registrar(p);
      else if (ruta === 'oauth/token') r = await oauth.token(p);
      else if (ruta === 'oauth/aprobar') r = await oauth.aprobar({ authorization: headers.authorization || '', p });
      else return res(404, { error: 'no_existe' });
      return res(r.estado, r.body);
    }
    let k;
    try { k = await autenticar(claveDe(headers, query)); }
    catch (e) { if (e instanceof ErrorApi && limite(fallos, 'ip:' + ip, 15)) throw new ErrorApi(429, 'limite', 'Demasiados intentos con clave inválida.'); throw e; }
    if (limite(golpes, 'k:' + k.id, 40)) throw new ErrorApi(429, 'limite', 'Esta clave superó su límite por minuto.');
    if (k.huella && Date.now() - k.ultimo > 120_000) { k.ultimo = Date.now(); actualizarDoc('apiKeys/' + k.huella, { ultimoUso: Date.now() }).catch(() => {}); }

    const bodyJson = () => { if (!rawBody) return {}; if (rawBody.length > MAX_BYTES) throw new ErrorApi(413, 'grande', 'Solicitud demasiado grande.'); try { return JSON.parse(rawBody); } catch { throw new ErrorApi(400, 'json', 'El cuerpo no es JSON válido.'); } };
    if (ruta === 'mcp') {
      if (method === 'GET') return res(405, { ok: false, error: { codigo: 'metodo', mensaje: 'Este servidor MCP usa POST (Streamable HTTP sin sesión).' } }, { allow: 'POST, OPTIONS' });
      if (method === 'DELETE') return res(200, {});
      if (method !== 'POST') return res(405, { ok: false });
      const out = await mcp(bodyJson(), k);
      return out === null ? res(202, null) : res(200, out);
    }
    if (ruta === 'v1/catalogo' && method === 'GET') { exige(k, 'catalogo'); return res(200, { ok: true, ...catalogoPublico(await cargarCatalogo(k.adminUid), { busqueda: query.busqueda, incluir_agotados: query.incluir_agotados === 'true' }) }); }
    if (ruta === 'v1/pedidos/calcular' && method === 'POST') { exige(k, 'catalogo'); return res(200, await crearPedido(k, bodyJson(), { soloCalcular: true })); }
    if (ruta === 'v1/pedidos' && method === 'POST') { exige(k, 'pedidos'); return res(200, await crearPedido(k, bodyJson())); }
    if (ruta === 'v1/pedidos' && method === 'GET') return res(200, await estadoPedidos(k, query.celular));
    return res(404, { ok: false, error: { codigo: 'no_existe', mensaje: 'Ruta no encontrada. Rutas: /api/mcp, /api/v1/catalogo, /api/v1/pedidos, /api/openapi.json' } });
  } catch (e) {
    if (e instanceof ErrorApi) return res(e.estado, { ok: false, error: { codigo: e.codigo, mensaje: e.message, ...e.extra } }, e.estado === 401 ? { 'www-authenticate': `Bearer resource_metadata="${origen}/.well-known/oauth-protected-resource"` } : {});
    return res(502, { ok: false, error: { codigo: 'servidor', mensaje: 'No pude completar la solicitud. Inténtalo de nuevo.' } });
  }
}
export const _test = { sha, resolverItems, validarCliente };
