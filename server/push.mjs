// Avisos push (Web Push / VAPID) para el administrador cuando llega un pedido de una IA.
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { leerDoc, crearDoc, listarDocs, borrarDoc } from './fs-admin.mjs';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
let vcache = null;
export async function vapid() {
  if (vcache) return vcache;
  let d = await leerDoc('apiConfig/vapid').catch(() => null);
  if (!d || !d.publica || !d.privada) {
    const k = webpush.generateVAPIDKeys();
    try { await crearDoc('apiConfig', 'vapid', { publica: k.publicKey, privada: k.privateKey }); } catch { /* otra instancia ganó */ }
    d = await leerDoc('apiConfig/vapid');
  }
  return (vcache = { publica: String(d.publica), privada: String(d.privada) });
}
const subOk = (s) => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 600 && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
export async function suscribir(uid, sub) {
  if (!subOk(sub)) return false;
  const id = sha(sub.endpoint);
  try { await borrarDoc('pushSubs/' + id); } catch { /* no existía */ }
  await crearDoc('pushSubs', id, { uid, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, creado: Date.now() });
  return true;
}
export async function quitar(endpoint) { try { await borrarDoc('pushSubs/' + sha(endpoint)); } catch { /* nada */ } }

/** Envía un aviso a todos los dispositivos del administrador. Nunca lanza error. */
export async function notificar(uid, payload, { espera = 3500 } = {}) {
  try {
    const trabajo = (async () => {
      const v = await vapid();
      const subs = (await listarDocs('pushSubs')).filter((d) => d.uid === uid && subOk(d.sub));
      const opts = { vapidDetails: { subject: process.env.VAPID_SUBJECT || 'mailto:' + String(process.env.ADMIN_EMAILS || 'mil0803r@gmail.com').split(',')[0].trim(), publicKey: v.publica, privateKey: v.privada }, TTL: 3600, urgency: 'high' };
      await Promise.all(subs.map((d) => webpush.sendNotification(d.sub, JSON.stringify(payload), opts).catch((e) => { if (e && (e.statusCode === 404 || e.statusCode === 410)) return borrarDoc('pushSubs/' + d.id).catch(() => {}); })));
    })();
    await Promise.race([trabajo, new Promise((r) => setTimeout(r, espera))]);
  } catch { /* el aviso es opcional */ }
}
