// Recibe los avisos de WhatsApp (etiquetas puestas o quitadas en los chats) que envía Evolution API
// y los guarda en Firestore (waEtq/{teléfono}) para que el panel se actualice solo.
// Variable: FIREBASE_SERVICE_ACCOUNT (el JSON de la cuenta de servicio de Firebase). La clave del aviso sale de WA_KEY.
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

export const claveHook = () => createHmac('sha256', String(process.env.WA_KEY || '')).update('yosca-wa-hook').digest('hex').slice(0, 40);

let cuenta = null, tok = { v: '', exp: 0 };
function cargarCuenta() {
  if (cuenta) return cuenta;
  try { const j = JSON.parse(String(process.env.FIREBASE_SERVICE_ACCOUNT || '')); if (j.client_email && j.private_key && j.project_id) cuenta = j; } catch { /* sin cuenta */ }
  return cuenta;
}
async function accessToken(sa) {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const now = Math.floor(Date.now() / 1000), b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' }), claim = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('token');
  tok = { v: j.access_token, exp: Date.now() + 50 * 60_000 };
  return tok.v;
}
// Busca un dato por nombre en cualquier parte del aviso (cada versión de Evolution lo anida distinto)
function buscar(o, claves, prof = 0) {
  if (!o || typeof o !== 'object' || prof > 6) return undefined;
  for (const k of claves) if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'object') return o[k];
  for (const v of Object.values(o)) { const r = buscar(v, claves, prof + 1); if (r !== undefined) return r; }
  return undefined;
}
export function extraer(body) {
  const lista = Array.isArray(body) ? body : [body];
  const out = [];
  for (const b of lista) {
    const evento = String(buscar(b, ['event']) || '').toLowerCase().replace(/_/g, '.');
    if (evento && !evento.includes('label')) continue;
    const jid = String(buscar(b, ['chatId', 'remoteJid', 'jid', 'chat']) || '');
    const label = String(buscar(b, ['labelId', 'label_id']) || '');
    const tipo = String(buscar(b, ['type', 'action', 'associationType']) || '').toLowerCase();
    if (!jid || !label || jid.endsWith('@lid') || jid.endsWith('@broadcast')) continue;
    const grupo = jid.endsWith('@g.us'), tel = grupo ? jid : jid.split('@')[0].replace(/\D/g, '');
    if (!tel || (!grupo && (tel.length < 8 || tel.length > 15))) continue;
    out.push({ tel, label, quitar: /remove|del|unlabel|quit/.test(tipo) });
  }
  return out;
}
export async function handle({ method, query, rawBody }) {
  if (method !== 'POST') return { status: 405, body: { error: 'metodo' } };
  const k = String(query.k || ''), esperada = claveHook();
  if (!process.env.WA_KEY || k.length !== esperada.length || !timingSafeEqual(Buffer.from(k), Buffer.from(esperada))) return { status: 401, body: { error: 'clave' } };
  if (!rawBody || rawBody.length > 200_000) return { status: 413, body: { error: 'grande' } };
  const sa = cargarCuenta();
  if (!sa) return { status: 503, body: { error: 'sin_cuenta_de_servicio' } };
  let body; try { body = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'json' } }; }
  const cambios = extraer(body);
  const base = `projects/${sa.project_id}/databases/(default)/documents`;
  const writes = [{ update: { name: `${base}/waEtq/_ultimo`, fields: { at: { timestampValue: new Date().toISOString() }, n: { integerValue: String(cambios.length) }, raw: { stringValue: rawBody.slice(0, 1500) } } } }];
  for (const c of cambios.slice(0, 200)) {
    writes.push({ transform: { document: `${base}/waEtq/${encodeURIComponent(c.tel)}`, fieldTransforms: [
      { fieldPath: 'ids', [c.quitar ? 'removeAllFromArray' : 'appendMissingElements']: { values: [{ stringValue: c.label }] } },
      { fieldPath: 'at', setToServerValue: 'REQUEST_TIME' } ] } });
  }
  try {
    const t = await accessToken(sa);
    const r = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ writes }) });
    if (!r.ok) return { status: 502, body: { error: 'firestore', estado: r.status } };
  } catch { return { status: 502, body: { error: 'firestore' } }; }
  return { status: 200, body: { ok: true, cambios: cambios.length } };
}
