import { handle } from '../server/asistente-core.mjs';

export default async function handler(req, res) {
  const rawBody = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : '';
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '?';
  const r = await handle({ method: req.method, rawBody, clave: String(req.headers['x-asistente-clave'] || ''), ip });
  res.setHeader('cache-control', 'no-store');
  res.status(r.status).json(r.body);
}
