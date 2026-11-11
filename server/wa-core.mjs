// Puente seguro entre la app y tu servidor de WhatsApp (Evolution API en Railway).
// La clave del servidor (WA_KEY) vive solo aquí: nunca llega al navegador.
// Variables: WA_URL, WA_KEY, WA_INSTANCE (por defecto "yosca"), WA_EMAILS (correos con permiso; por defecto el del dueño).
import { usuarioFirebase } from './asistente-core.mjs';
import { claveHook } from './wa-hook.mjs';

const LIMITE_POR_MINUTO = 90;
const MAX_BYTES = 20_000;
const golpes = new Map();

const cfg = () => ({
  url: String(process.env.WA_URL || '').trim().replace(/\/+$/, ''),
  key: String(process.env.WA_KEY || '').trim(),
  inst: String(process.env.WA_INSTANCE || 'yosca').trim() || 'yosca',
  correos: String(process.env.WA_EMAILS || 'mil0803r@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
});
const digitos = (s) => String(s || '').replace(/\D/g, '');
const jidValido = (s) => /^[0-9]{8,15}@s\.whatsapp\.net$|^[0-9-]{10,40}@g\.us$/.test(String(s || ''));

function superaLimite(quien) {
  const ahora = Date.now();
  const l = (golpes.get(quien) || []).filter((t) => ahora - t < 60_000);
  l.push(ahora); golpes.set(quien, l);
  return l.length > LIMITE_POR_MINUTO;
}

async function evo(c, ruta, metodo = 'GET', cuerpo) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(c.url + ruta, {
      method: metodo,
      headers: { apikey: c.key, 'content-type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: ctl.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch { j = { raw: txt.slice(0, 300) }; }
    if (!r.ok) { const e = new Error('servidor'); e.estado = r.status; e.j = j; throw e; }
    return j;
  } finally { clearTimeout(to); }
}

const estadoTexto = (j) => {
  const s = String((j && ((j.instance && j.instance.state) || j.state)) || '').toLowerCase();
  return s === 'open' ? 'conectado' : s === 'connecting' ? 'conectando' : s === 'close' || s === 'closed' ? 'desconectado' : s || 'desconocido';
};
const textoDe = (m) => {
  if (!m) return '';
  const x = m.message || m;
  return x.conversation || (x.extendedTextMessage && x.extendedTextMessage.text) || (x.imageMessage && (x.imageMessage.caption || '📷 Foto')) || (x.videoMessage && (x.videoMessage.caption || '🎥 Video')) || (x.audioMessage && '🎤 Audio') || (x.documentMessage && ('📄 ' + (x.documentMessage.fileName || 'Documento'))) || (x.stickerMessage && 'Sticker') || (x.reactionMessage && '') || '';
};
const etiquetasDe = (raw) => {
  let a = raw;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = []; } }
  return (Array.isArray(a) ? a : []).map((l) => String((l && typeof l === 'object' ? (l.id || l.labelId) : l) || '')).filter(Boolean).slice(0, 20);
};
const ts = (v) => { const n = Number(v && v.low !== undefined ? v.low : v) || 0; return n > 1e12 ? n : n * 1000; };
const tsISO = (v) => { if (!v) return 0; if (typeof v === 'string' && /\D/.test(v)) { const d = Date.parse(v); return Number.isFinite(d) ? d : 0; } return ts(v); };

// Lee acceso/{correo} con el propio token de la persona: las reglas de Firestore deciden (solo puede leer el suyo).
async function nivelDeAcceso(correo, token) {
  const pid = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  if (!pid || !correo) return '';
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(pid)}/databases/(default)/documents/acceso/${encodeURIComponent(correo)}`, { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) return '';
    const f = (await r.json()).fields || {};
    if (!f.estado || f.estado.stringValue !== 'activo') return '';
    const n = (((f.permisos || {}).mapValue || {}).fields || {}).wa;
    const v = n && n.stringValue;
    return v === 'editar' || v === 'ver' ? v : '';
  } catch { return ''; }
}

export async function handle({ method, rawBody, authorization, ip, verificar = usuarioFirebase }) {
  const c = cfg();
  const b = /^Bearer\s+(.+)$/i.exec(authorization || '');
  if (!b) return { status: 401, body: { error: 'sesion' } };
  const u = await verificar(b[1]);
  if (!u) return { status: 401, body: { error: 'sesion' } };
  if (!u.verificado) return { status: 403, body: { error: 'sin_permiso' } };
  const correo = String(u.email || '').toLowerCase();
  let nivelWa = c.correos.includes(correo) ? 'admin' : '';
  if (!nivelWa) nivelWa = await nivelDeAcceso(correo, b[1]); // miembro aprobado por el administrador ('ver' | 'editar')
  if (!nivelWa) return { status: 403, body: { error: 'sin_permiso' } };
  if (superaLimite('u:' + u.uid)) return { status: 429, body: { error: 'limite' } };
  const configurado = Boolean(c.url && c.key);
  if (method === 'GET') return { status: 200, body: { disponible: configurado, instancia: c.inst } };
  if (method !== 'POST') return { status: 405, body: { error: 'metodo' } };
  if (!configurado) return { status: 503, body: { error: 'no_configurado' } };
  if (!rawBody || rawBody.length > MAX_BYTES) return { status: 413, body: { error: 'grande' } };
  let p; try { p = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'json' } }; }
  const I = encodeURIComponent(c.inst);
  const soloAdmin = ['conectar', 'desvincular', 'webhook'].includes(p.accion), escribe = p.accion === 'enviar' || p.accion === 'etiquetar';
  if ((soloAdmin && nivelWa !== 'admin') || (escribe && nivelWa === 'ver')) return { status: 403, body: { error: 'sin_permiso' } };
  try {
    switch (p.accion) {
      case 'estado': {
        try { return { status: 200, body: { estado: estadoTexto(await evo(c, '/instance/connectionState/' + I)) } }; }
        catch (e) { if (e.estado === 404) return { status: 200, body: { estado: 'sin_instancia' } }; throw e; }
      }
      case 'conectar': {
        let est = 'sin_instancia';
        try { est = estadoTexto(await evo(c, '/instance/connectionState/' + I)); } catch (e) { if (e.estado !== 404) throw e; }
        if (est === 'conectado') return { status: 200, body: { estado: 'conectado' } };
        if (est === 'sin_instancia') await evo(c, '/instance/create', 'POST', { instanceName: c.inst, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
        const q = await evo(c, '/instance/connect/' + I);
        let qr = (q && (q.base64 || (q.qrcode && q.qrcode.base64))) || '';
        if (qr && !/^data:image/.test(qr)) qr = 'data:image/png;base64,' + qr;
        return { status: 200, body: { estado: 'conectando', qr, codigo: (q && (q.pairingCode || '')) || '' } };
      }
      case 'desvincular': {
        try { await evo(c, '/instance/logout/' + I, 'DELETE'); } catch (e) { if (e.estado !== 404 && e.estado !== 400) throw e; }
        return { status: 200, body: { estado: 'desconectado' } };
      }
      case 'chats': {
        const j = await evo(c, '/chat/findChats/' + I, 'POST', {});
        const arr = Array.isArray(j) ? j : (j && (j.chats || j.records)) || [];
        // Agenda de contactos: nombres y fotos como en el WhatsApp original
        const ag = new Map();
        try {
          const cj = await evo(c, '/chat/findContacts/' + I, 'POST', {});
          for (const k of (Array.isArray(cj) ? cj : (cj && (cj.contacts || cj.records)) || [])) {
            const id = String(k.remoteJid || k.id || '');
            if (id) ag.set(id, k);
          }
        } catch (e) { /* si falla la agenda, se siguen mostrando los chats */ }
        const conEtq = arr.some((x) => x && Object.prototype.hasOwnProperty.call(x, 'labels'));
        const salida = [];
        for (const x of arr) {
          let jid = String(x.remoteJid || x.id || '');
          if (jid.endsWith('@lid')) {
            const alt = String(x.remoteJidAlt || (x.lastMessage && x.lastMessage.key && x.lastMessage.key.remoteJidAlt) || '');
            if (/^[0-9]{8,15}@s\.whatsapp\.net$/.test(alt)) jid = alt;
          }
          if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
          const grupo = jid.endsWith('@g.us');
          const lm = x.lastMessage || (x.messages && x.messages[0]) || null;
          salida.push({
            jid, grupo,
            tel: grupo ? jid : digitos(jid.split('@')[0]),
            lid: jid.endsWith('@lid'),
            nombre: String((ag.get(jid) || {}).pushName || (ag.get(jid) || {}).name || x.name || x.pushName || (x.contact && x.contact.pushName) || '').slice(0, 60),
            foto: (() => { const f = (ag.get(jid) || {}).profilePicUrl || x.profilePicUrl || ''; return /^https:\/\//.test(f) ? f : ''; })(),
            ultimo: String(textoDe(lm) || '').slice(0, 140),
            fecha: ts(lm && (lm.messageTimestamp || lm.timestamp)) || tsISO(x.updatedAt || x.conversationTimestamp),
            etiquetas: etiquetasDe(x.labels), conEtq,
            noLeidos: Number(x.unreadMessages || x.unreadCount || 0) || 0,
          });
        }
        salida.sort((a, z) => z.fecha - a.fecha);
        return { status: 200, body: { chats: salida.slice(0, 300) } };
      }
      case 'webhook': {
        // Le pide a Evolution que avise a esta app cada vez que se pone o quita una etiqueta en un chat
        let o; try { o = new URL(String(p.origen || '')); } catch { return { status: 400, body: { error: 'origen' } }; }
        if (o.protocol !== 'https:') return { status: 400, body: { error: 'origen' } };
        const url = `${o.origin}/api/wa-hook?k=${claveHook()}`, events = ['LABELS_ASSOCIATION', 'LABELS_EDIT'];
        try { await evo(c, '/webhook/set/' + I, 'POST', { webhook: { enabled: true, url, webhookByEvents: false, byEvents: false, webhookBase64: false, base64: false, events } }); }
        catch (e) { if (e.estado !== 400 && e.estado !== 422) throw e; await evo(c, '/webhook/set/' + I, 'POST', { enabled: true, url, webhookByEvents: false, webhookBase64: false, events }); }
        return { status: 200, body: { ok: true, cuenta: Boolean(String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim()) } };
      }
      case 'etiquetas': {
        let j = [], fallo = 0;
        try { j = await evo(c, '/label/findLabels/' + I, 'POST', {}); } catch (e) { if (!e.estado) throw e; fallo = e.estado; }
        const arr = Array.isArray(j) ? j : (j && (j.labels || j.records)) || [];
        return { status: 200, body: { fallo, etiquetas: arr.map((l) => ({ id: String(l.id || l.labelId || ''), nombre: String(l.name || l.nombre || '').slice(0, 40), color: Number(l.color) || 0 })).filter((l) => l.id && l.nombre).slice(0, 60) } };
      }
      case 'etiquetar': {
        const jid = String(p.jid || ''), lid = String(p.labelId || '');
        if (!jidValido(jid) || !/^[A-Za-z0-9_.-]{1,40}$/.test(lid)) return { status: 400, body: { error: 'datos' } };
        await evo(c, '/label/handleLabel/' + I, 'POST', { number: jid.endsWith('@g.us') ? jid : jid.split('@')[0], labelId: lid, action: p.quitar ? 'remove' : 'add' });
        return { status: 200, body: { ok: true } };
      }
      case 'mensajes': {
        const jid = String(p.jid || '');
        if (!jidValido(jid)) return { status: 400, body: { error: 'jid' } };
        const j = await evo(c, '/chat/findMessages/' + I, 'POST', { where: { key: { remoteJid: jid } }, limit: 60, offset: 60, page: 1 });
        const arr = Array.isArray(j) ? j : (j && j.messages && (j.messages.records || j.messages)) || (j && j.records) || [];
        const ms = arr.map((m) => ({ id: String((m.key && m.key.id) || m.id || ''), mio: !!(m.key && m.key.fromMe), texto: String(textoDe(m) || '').slice(0, 1500), fecha: ts(m.messageTimestamp || m.timestamp), de: String(m.pushName || '').slice(0, 40), est: Number(m.status === 'READ' || m.status === 'PLAYED' ? 3 : m.status === 'DELIVERY_ACK' ? 2 : m.status === 'SERVER_ACK' ? 1 : 0) || 0 })).filter((m) => m.texto).sort((a, z) => a.fecha - z.fecha).slice(-50);
        return { status: 200, body: { mensajes: ms } };
      }
      case 'enviar': {
        const jid = String(p.jid || ''), texto = String(p.texto || '').trim();
        const num = jidValido(jid) ? (jid.endsWith('@g.us') ? jid : jid.split('@')[0]) : digitos(p.tel);
        if (!(jidValido(jid) || (num.length >= 8 && num.length <= 15))) return { status: 400, body: { error: 'numero' } };
        if (!texto || texto.length > 4000) return { status: 400, body: { error: 'texto' } };
        await evo(c, '/message/sendText/' + I, 'POST', { number: num, text: texto });
        return { status: 200, body: { ok: true } };
      }
      default: return { status: 400, body: { error: 'accion' } };
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return { status: 504, body: { error: 'tiempo' } };
    const st = e && e.estado;
    return { status: 502, body: { error: 'servidor', detalle: st ? 'El servidor de WhatsApp respondió ' + st : 'No pude comunicarme con el servidor de WhatsApp' } };
  }
}
