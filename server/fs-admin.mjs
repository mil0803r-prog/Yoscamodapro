// Acceso al Firestore del proyecto con la cuenta de servicio (FIREBASE_SERVICE_ACCOUNT). Solo se usa desde el servidor.
import { createSign } from 'node:crypto';

let cuenta = null, tok = { v: '', exp: 0 };
export function cuentaServicio() {
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

export const aFs = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, aFs(x)])) } };
};
export const deFs = (f) => {
  if (!f || typeof f !== 'object') return null;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return f.doubleValue;
  if ('booleanValue' in f) return f.booleanValue;
  if ('nullValue' in f) return null;
  if ('timestampValue' in f) return Date.parse(f.timestampValue) || 0;
  if ('arrayValue' in f) return ((f.arrayValue && f.arrayValue.values) || []).map(deFs);
  if ('mapValue' in f) return Object.fromEntries(Object.entries((f.mapValue && f.mapValue.fields) || {}).map(([k, x]) => [k, deFs(x)]));
  return null;
};
const docDe = (d) => (d && d.fields ? Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, deFs(v)])) : {});

async function llamar(metodo, ruta, cuerpo) {
  const sa = cuentaServicio();
  if (!sa) throw Object.assign(new Error('sin_cuenta'), { codigo: 'sin_cuenta' });
  const t = await accessToken(sa);
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/${ruta}`, { method: metodo, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('firestore'), { codigo: 'firestore', estado: r.status });
  return j;
}
const enc = (ruta) => ruta.split('/').map(encodeURIComponent).join('/');
export async function leerDoc(ruta) { const d = await llamar('GET', enc(ruta)); return d ? docDe(d) : null; }
export async function listarDocs(coleccion, max = 600) {
  const out = []; let pagina = '';
  do {
    const d = await llamar('GET', enc(coleccion) + `?pageSize=300${pagina ? '&pageToken=' + encodeURIComponent(pagina) : ''}`);
    if (!d) break;
    for (const x of d.documents || []) out.push({ id: x.name.split('/').pop(), ...docDe(x) });
    pagina = d.nextPageToken || '';
  } while (pagina && out.length < max);
  return out;
}
export async function crearDoc(coleccion, id, datos) {
  const d = await llamar('POST', enc(coleccion) + `?documentId=${encodeURIComponent(id)}`, { fields: aFs(datos).mapValue.fields });
  return d;
}
export async function actualizarDoc(ruta, datos) {
  const campos = Object.keys(datos);
  const mask = campos.map((c) => 'updateMask.fieldPaths=' + encodeURIComponent(c)).join('&');
  return llamar('PATCH', enc(ruta) + '?' + mask, { fields: aFs(datos).mapValue.fields });
}
export async function borrarDoc(ruta) { await llamar('DELETE', enc(ruta)); }
