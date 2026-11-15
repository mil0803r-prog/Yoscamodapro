// Lee una captura de chat o una foto con Gemini y devuelve los datos del cliente (nombre, celular, ciudad…).
// Usa la misma clave del asistente (GEMINI_API_KEY). La imagen no se guarda: solo pasa por aquí hacia Gemini.
import { usuarioFirebase } from './asistente-core.mjs';
import { puede } from './permisos.mjs';

const MODELO_PRINCIPAL = 'gemini-3.8-flash';
const MODELO_RESPALDO = 'gemini-2.5-flash';
const MAX_BYTES = 3_000_000;
const LIMITE_POR_MINUTO = 10;
const golpes = new Map();
const base = () => process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const permitidos = () => String(process.env.LEER_EMAILS || 'mil0803r@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

function superaLimite(quien) {
  const ahora = Date.now();
  const l = (golpes.get(quien) || []).filter((t) => ahora - t < 60_000);
  l.push(ahora); golpes.set(quien, l);
  return l.length > LIMITE_POR_MINUTO;
}

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    nombre: { type: 'STRING' }, celular: { type: 'STRING' }, ciudad: { type: 'STRING' }, dni: { type: 'STRING' },
    direccion: { type: 'STRING' }, agencia: { type: 'STRING' }, referencia: { type: 'STRING' },
    producto: { type: 'STRING' }, talla: { type: 'STRING' }, color: { type: 'STRING' }, cantidad: { type: 'INTEGER' },
  },
};
const ESQUEMA_PAGO = {
  type: 'OBJECT',
  properties: {
    esComprobante: { type: 'BOOLEAN' }, monto: { type: 'NUMBER' }, pagador: { type: 'STRING' }, destinatario: { type: 'STRING' },
    fecha: { type: 'STRING' }, operacion: { type: 'STRING' }, medio: { type: 'STRING' },
  },
};
const limpia = (v, n = 120) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

export async function handle({ method, rawBody, authorization, ip }) {
  const hayClave = Boolean(process.env.GEMINI_API_KEY), hayFirebase = Boolean(process.env.FIREBASE_PROJECT_ID);
  if (method === 'GET') return { status: 200, body: { disponible: hayClave && hayFirebase } };
  if (method !== 'POST') return { status: 405, body: { error: 'metodo' } };
  if (!hayClave || !hayFirebase) return { status: 503, body: { error: 'no_configurado' } };
  const b = /^Bearer\s+(.+)$/i.exec(authorization || '');
  if (!b) return { status: 401, body: { error: 'sesion' } };
  const u = await usuarioFirebase(b[1]);
  if (!u) return { status: 401, body: { error: 'sesion' } };
  if (!u.verificado || !(permitidos().includes(u.email) || (await puede(u, 'ped_ia')))) return { status: 403, body: { error: 'sin_permiso' } };
  if (superaLimite('u:' + u.uid)) return { status: 429, body: { error: 'limite' } };
  if (!rawBody || rawBody.length > MAX_BYTES * 1.4) return { status: 413, body: { error: 'grande' } };
  let p; try { p = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'json' } }; }
  const mime = String(p.mime || ''), img = String(p.imagen || '');
  if (!MIMES.includes(mime) || !/^[A-Za-z0-9+/=]+$/.test(img) || img.length < 100 || img.length > MAX_BYTES) return { status: 400, body: { error: 'imagen' } };
  const lista = (a) => (Array.isArray(a) ? a : []).slice(0, 40).map((x) => limpia(x, 40)).filter(Boolean);
  const colores = lista(p.colores), productos = lista(p.productos);
  const pago = p.tipo === 'pago';
  const instrucciones = pago ? [
    'Lees la captura de un comprobante de pago (Yape, Plin o transferencia bancaria de Perú).',
    'esComprobante: true solo si la imagen es de verdad un comprobante de pago; si no, false y deja el resto vacío.',
    'monto: el monto pagado en soles como número (ej. 90.5). pagador: la persona que envió el dinero (el nombre tal como aparece). destinatario: quien lo recibió.',
    'fecha: en formato AAAA-MM-DD si se ve la fecha. operacion: el número o código de operación. medio: Yape, Plin, Transferencia u Otro.',
    'No inventes datos: si algo no se ve, déjalo vacío.',
  ].join('\n') : [
    'Eres un asistente que lee capturas de chats de WhatsApp o fotos de notas con los datos de un cliente de una tienda de ropa en Perú.',
    'Extrae SOLO lo que se ve escrito en la imagen. Si un dato no aparece, déjalo vacío. No inventes nada.',
    'celular: número peruano de 9 dígitos sin espacios (si trae +51, quítalo). dni: 8 dígitos.',
    'agencia: empresa de envío (Olva, Shalom, Marvisur, etc.) y la sede si aparece. cantidad: número de prendas pedidas.',
    'Si el cliente pide varios colores, ponlos todos en "color" separados por coma. Si pide varias tallas, igual en "talla".',
    colores.length ? 'Colores que existen en la tienda (usa estos nombres cuando coincidan): ' + colores.join(', ') + '.' : '',
    productos.length ? 'Productos de la tienda: ' + productos.join(', ') + '.' : '',
  ].filter(Boolean).join('\n');
  const payload = {
    contents: [{ role: 'user', parts: [{ text: instrucciones }, { inlineData: { mimeType: mime, data: img } }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 700, responseMimeType: 'application/json', responseSchema: pago ? ESQUEMA_PAGO : ESQUEMA },
  };
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 50_000);
  try {
    let res;
    for (const m of [...new Set([process.env.GEMINI_MODEL || MODELO_PRINCIPAL, MODELO_RESPALDO])]) {
      res = await fetch(`${base()}/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(payload), signal: ctl.signal });
      if (res.ok || res.status !== 404) break;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => ''); let det = ''; try { det = String(JSON.parse(txt).error.message || ''); } catch { det = txt; }
      det = det.replace(/\s+/g, ' ').slice(0, 250);
      return { status: res.status === 429 ? 429 : 502, body: { error: res.status === 429 ? 'cuota' : 'gemini', detalle: det } };
    }
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    const texto = cand && cand.content && cand.content.parts ? cand.content.parts.filter((x) => typeof x.text === 'string').map((x) => x.text).join('') : '';
    if (!texto) return { status: 502, body: { error: 'bloqueado' } };
    let j; try { j = JSON.parse(texto); } catch { return { status: 502, body: { error: 'formato' } }; }
    if (pago) {
      const m = Number(String(j.monto == null ? '' : j.monto).replace(',', '.'));
      return { status: 200, body: { pago: {
        esComprobante: j.esComprobante !== false && Number.isFinite(m) && m > 0, monto: Number.isFinite(m) && m > 0 && m < 1_000_000 ? Math.round(m * 100) / 100 : 0,
        pagador: limpia(j.pagador, 60), destinatario: limpia(j.destinatario, 60), fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(j.fecha || '')) ? String(j.fecha) : '',
        operacion: limpia(j.operacion, 40), medio: limpia(j.medio, 20),
      } } };
    }
    const cel = limpia(j.celular, 30).replace(/[^\d+]/g, '').replace(/^\+?51(?=9\d{8}$)/, '');
    const dni = limpia(j.dni, 20).replace(/\D/g, '');
    return { status: 200, body: { datos: {
      nombre: limpia(j.nombre, 60), celular: cel, ciudad: limpia(j.ciudad, 40), dni: dni.length === 8 ? dni : '',
      direccion: limpia(j.direccion, 120), agencia: limpia(j.agencia, 60), referencia: limpia(j.referencia, 120),
      producto: limpia(j.producto, 60), talla: limpia(j.talla, 30), color: limpia(j.color, 60), cantidad: Math.max(0, Math.min(999, parseInt(j.cantidad) || 0)),
    } } };
  } catch (e) {
    return { status: 502, body: { error: e && e.name === 'AbortError' ? 'tiempo' : 'red' } };
  } finally { clearTimeout(to); }
}
