import { handle } from '../server/pedidos-api.mjs';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-api-key, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-max-age': '86400' };

export default async function handler(req, res) {
  const url = new URL(req.url, 'https://x');
  const query = Object.fromEntries(url.searchParams);
  const ruta = query.ruta || url.pathname.replace(/^\/api\//, '');
  delete query.ruta;
  const form = String(req.headers['content-type'] || '').includes('x-www-form-urlencoded');
  const rawBody = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : form ? new URLSearchParams(req.body || {}).toString() : JSON.stringify(req.body || {})) : '';
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '?';
  const origen = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || '');
  const r = await handle({ method: req.method, ruta, query, headers: req.headers, rawBody, ip, origen });
  for (const [k, v] of Object.entries({ ...CORS, 'cache-control': 'no-store', ...(r.headers || {}) })) res.setHeader(k, v);
  if (r.body === null || r.body === undefined) return res.status(r.status).end();
  res.status(r.status).json(r.body);
}
