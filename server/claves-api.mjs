// Gestión de las claves de la API/MCP desde el panel. Solo el administrador (con sesión verificada).
// El servidor las guarda con la cuenta de servicio, así que NO hace falta tocar las reglas de Firestore.
import { vapid, suscribir, quitar, notificar } from './push.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { usuarioFirebase } from './asistente-core.mjs';
import { cuentaServicio, listarDocs, crearDoc, actualizarDoc, borrarDoc, leerDoc } from './fs-admin.mjs';

const admins = () => String(process.env.ADMIN_EMAILS || process.env.LEER_EMAILS || 'mil0803r@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const SCOPES = ['catalogo', 'pedidos', 'consultar'];
const golpes = new Map();
const limpio = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export async function handle({ method, rawBody, authorization }) {
  if (method !== 'POST') return { status: 405, body: { error: 'metodo' } };
  if (!cuentaServicio()) return { status: 503, body: { error: 'no_configurado' } };
  const b = /^Bearer\s+(.+)$/i.exec(authorization || '');
  const u = b && (await usuarioFirebase(b[1]));
  if (!u) return { status: 401, body: { error: 'sesion' } };
  if (!u.verificado || !admins().includes(u.email)) return { status: 403, body: { error: 'sin_permiso' } };
  const ahora = Date.now(), l = (golpes.get(u.uid) || []).filter((t) => ahora - t < 60_000); l.push(ahora); golpes.set(u.uid, l);
  if (l.length > 30) return { status: 429, body: { error: 'limite' } };
  let p; try { p = JSON.parse(rawBody || '{}'); } catch { return { status: 400, body: { error: 'json' } }; }
  try {
    if (p.accion === 'listar') {
      const l2 = (await listarDocs('apiKeys')).filter((k) => k.adminUid === u.uid).sort((x, y) => (y.creado || 0) - (x.creado || 0));
      return { status: 200, body: { claves: l2.map((k) => ({ id: k.id, nombre: k.nombre, activa: k.activa !== false, scopes: k.scopes || [], prefijo: k.prefijo || '', creado: k.creado || 0, ultimoUso: k.ultimoUso || 0 })) } };
    }
    if (p.accion === 'crear') {
      const nombre = limpio(p.nombre, 40) || 'Integración';
      const scopes = ['catalogo', ...(Array.isArray(p.scopes) ? p.scopes : []).filter((x) => SCOPES.includes(x) && x !== 'catalogo')];
      const clave = 'yk_' + randomBytes(24).toString('base64url'), id = sha(clave);
      await crearDoc('apiKeys', id, { nombre, activa: true, adminUid: u.uid, scopes: [...new Set(scopes)], creado: Date.now(), ultimoUso: 0, prefijo: clave.slice(0, 7) + '…' + clave.slice(-4) });
      return { status: 200, body: { clave, id, nombre, scopes: [...new Set(scopes)] } };
    }
    if (p.accion === 'revocar_oauth') { await actualizarDoc('apiConfig/oauth', { desde: Date.now() }); return { status: 200, body: { ok: true } }; }
    if (p.accion === 'push_clave') { const v = await vapid(); return { status: 200, body: { publica: v.publica } }; }
    if (p.accion === 'push_suscribir') { const ok = await suscribir(u.uid, p.sub); return ok ? { status: 200, body: { ok: true } } : { status: 400, body: { error: 'suscripcion' } }; }
    if (p.accion === 'push_quitar') { await quitar(String((p.sub && p.sub.endpoint) || '')); return { status: 200, body: { ok: true } }; }
    if (p.accion === 'push_probar') { await notificar(u.uid, { titulo: 'Yosca Moda', cuerpo: 'Los avisos funcionan en este dispositivo.' }); return { status: 200, body: { ok: true } }; }
    const id = String(p.id || '');
    if (!/^[0-9a-f]{64}$/.test(id)) return { status: 400, body: { error: 'id' } };
    const k = await leerDoc('apiKeys/' + id);
    if (!k || k.adminUid !== u.uid) return { status: 404, body: { error: 'no_existe' } };
    if (p.accion === 'activar') { await actualizarDoc('apiKeys/' + id, { activa: p.activa !== false }); return { status: 200, body: { ok: true } }; }
    if (p.accion === 'eliminar') { await borrarDoc('apiKeys/' + id); return { status: 200, body: { ok: true } }; }
    return { status: 400, body: { error: 'accion' } };
  } catch (e) { return { status: 502, body: { error: 'servidor' } }; }
}
