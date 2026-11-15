// OAuth 2.1 (código + PKCE) para conectar ChatGPT, Claude y otras IAs con el inicio de sesión de la plataforma.
// Sin base de datos propia: clientes, códigos y tokens son «firmados» (HMAC) con un secreto derivado de la cuenta de servicio.
// Revocar todo: se guarda una fecha en apiConfig/oauth (los tokens emitidos antes dejan de valer).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { usuarioFirebase } from './asistente-core.mjs';
import { cuentaServicio, leerDoc, crearDoc } from './fs-admin.mjs';
import { notificar } from './push.mjs';
import { puede } from './permisos.mjs';

const admins = () => String(process.env.ADMIN_EMAILS || process.env.LEER_EMAILS || 'mil0803r@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const SCOPES = ['catalogo', 'pedidos', 'consultar'];
const b64 = (b) => Buffer.from(b).toString('base64url');
const sha = (s) => createHash('sha256').update(String(s)).digest();

const secreto = () => createHash('sha256').update('yosca-oauth|' + (cuentaServicio() ? cuentaServicio().private_key : '')).digest();
export function firmar(obj) { const p = b64(JSON.stringify(obj)); return p + '.' + b64(createHmac('sha256', secreto()).update(p).digest()); }
export function verificar(str) {
  const [p, f] = String(str || '').split('.');
  if (!p || !f) return null;
  const esp = createHmac('sha256', secreto()).update(p).digest(), got = Buffer.from(f, 'base64url');
  if (got.length !== esp.length || !timingSafeEqual(got, esp)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); return o && (!o.exp || o.exp > Date.now()) ? o : null; } catch { return null; }
}

const usados = new Map(); // códigos ya canjeados (por instancia; el PKCE y los 5 min cubren el resto)
const desdeCache = new Map();
async function revocadoDesde(uid) {
  const c = desdeCache.get(uid);
  if (c && Date.now() < c.vence) return c.v;
  let v = 0; try { const d = await leerDoc('apiConfig/oauth_' + uid); v = Number(d && d.desde) || 0; } catch { /* sin revocación */ }
  desdeCache.set(uid, { v, vence: Date.now() + 30_000 }); if (desdeCache.size > 500) desdeCache.clear();
  return v;
}
/** Valida un access token «ya_…»: devuelve { uid, scopes } o null. */
export async function verificarAcceso(token) {
  if (!/^ya_/.test(token || '')) return null;
  const o = verificar(String(token).slice(3));
  if (!o || o.t !== 'at' || !o.uid) return null;
  if ((o.iat || 0) < (await revocadoDesde(String(o.uid)))) return null;
  if (!(await puede({ email: o.em, verificado: true }, 'integ'))) return null;
  return { uid: String(o.uid), scopes: Array.isArray(o.sc) && o.sc.length ? o.sc : ['catalogo', 'pedidos'], cliente: String(o.cn || '') };
}

const redirectOk = (u) => { try { const x = new URL(u); return (x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname))) && !x.hash; } catch { return false; } };
const limpio = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const err = (estado, codigo, desc) => ({ estado, body: { error: codigo, error_description: desc } });

export function metadatosRecurso(origen) { return { resource: origen + '/api/mcp', authorization_servers: [origen], bearer_methods_supported: ['header'], scopes_supported: SCOPES, resource_name: 'Pedidos de la tienda' }; }
export function metadatosServidor(origen) {
  return { issuer: origen, authorization_endpoint: origen + '/oauth/authorize', token_endpoint: origen + '/oauth/token', registration_endpoint: origen + '/oauth/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: SCOPES };
}

/** Registro dinámico de clientes (RFC 7591): el «client_id» lleva dentro sus redirect_uris, firmado. */
export function registrar(p) {
  const uris = Array.isArray(p && p.redirect_uris) ? p.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 6 || !uris.every(redirectOk)) return err(400, 'invalid_redirect_uri', 'redirect_uris debe tener direcciones https válidas.');
  const nombre = limpio(p.client_name, 60) || 'Asistente de IA';
  const client_id = firmar({ t: 'c', uris, n: nombre, i: Date.now() });
  return { estado: 201, body: { client_id, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: nombre, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' } };
}

/** El usuario (ya con sesión) aprueba: se devuelve la dirección a la que se redirige con el código. */
export async function aprobar({ authorization, p }) {
  const b = /^Bearer\s+(.+)$/i.exec(authorization || '');
  const u = b && (await usuarioFirebase(b[1]));
  if (!u) return err(401, 'sesion', 'Inicia sesión.');
  if (!(await puede(u, 'integ'))) return err(403, 'sin_permiso', 'Esta cuenta no tiene permiso para conectar una IA.');
  const c = verificar(p.client_id);
  if (!c || c.t !== 'c') return err(400, 'invalid_client', 'Cliente no reconocido.');
  if (!c.uris.includes(String(p.redirect_uri || ''))) return err(400, 'invalid_redirect_uri', 'La dirección de retorno no coincide con la registrada.');
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(p.code_challenge || ''))) return err(400, 'invalid_request', 'Falta PKCE (S256).');
  const pedidos = String(p.scope || '').split(/[\s,]+/).filter((x) => SCOPES.includes(x));
  const sc = [...new Set(['catalogo', 'pedidos', ...pedidos.filter((x) => x === 'consultar')])];
  const code = firmar({ t: 'code', uid: u.uid, em: u.email, cid: sha(p.client_id).toString('hex').slice(0, 16), ru: p.redirect_uri, ch: p.code_challenge, sc, cn: c.n, exp: Date.now() + 5 * 60_000, n: randomBytes(8).toString('hex') });
  const url = new URL(p.redirect_uri); url.searchParams.set('code', code); if (p.state) url.searchParams.set('state', String(p.state).slice(0, 500));
  // Aviso dentro de la plataforma: queda registrado y llega como notificación
  try { await crearDoc(`users/${u.uid}/conexiones`, 'c_' + Date.now().toString(36) + randomBytes(3).toString('hex'), { cliente: c.n, creado: Date.now(), tipo: 'oauth' }); } catch { /* opcional */ }
  await notificar(u.uid, { titulo: 'IA conectada', cuerpo: `${c.n} ahora tiene acceso a tu catálogo y puede dejar pedidos.`, url: '/?ir=integ' }, { espera: 2500 });
  return { estado: 200, body: { redirect: url.toString(), cliente: c.n } };
}

/** Intercambio de código o de refresh token por un access token. */
export async function token(p) {
  const emitir = (uid, sc, cn, cid, em) => {
    const iat = Date.now();
    return { estado: 200, body: { access_token: 'ya_' + firmar({ t: 'at', uid, em, sc, cn, iat, exp: iat + 3600_000 }), token_type: 'Bearer', expires_in: 3600, refresh_token: 'yr_' + firmar({ t: 'rt', uid, em, sc, cn, cid, iat, exp: iat + 60 * 864e5 }), scope: sc.join(' ') } };
  };
  if (p.grant_type === 'authorization_code') {
    const c = verificar(p.code);
    if (!c || c.t !== 'code') return err(400, 'invalid_grant', 'Código inválido o vencido.');
    if (c.cid !== sha(p.client_id).toString('hex').slice(0, 16) || c.ru !== p.redirect_uri) return err(400, 'invalid_grant', 'El código no corresponde a este cliente.');
    if (b64(sha(String(p.code_verifier || ''))) !== c.ch) return err(400, 'invalid_grant', 'PKCE no coincide.');
    if (usados.has(c.n)) return err(400, 'invalid_grant', 'El código ya fue usado.');
    usados.set(c.n, c.exp); for (const [k, v] of usados) if (v < Date.now()) usados.delete(k);
    return emitir(c.uid, c.sc, c.cn, c.cid, c.em);
  }
  if (p.grant_type === 'refresh_token') {
    const r = verificar(String(p.refresh_token || '').replace(/^yr_/, ''));
    if (!r || r.t !== 'rt') return err(400, 'invalid_grant', 'Refresh token inválido o vencido.');
    if ((r.iat || 0) < (await revocadoDesde(String(r.uid)))) return err(400, 'invalid_grant', 'El acceso fue revocado. Vuelve a conectar.');
    if (!(await puede({ email: r.em, verificado: true }, 'integ'))) return err(400, 'invalid_grant', 'Esta cuenta ya no tiene permiso.');
    return emitir(r.uid, r.sc, r.cn, r.cid, r.em);
  }
  return err(400, 'unsupported_grant_type', 'grant_type no soportado.');
}
