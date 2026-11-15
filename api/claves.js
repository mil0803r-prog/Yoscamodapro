import { handle } from '../server/claves-api.mjs';

export default async function handler(req, res) {
  const rawBody = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : '';
  const r = await handle({ method: req.method, rawBody, authorization: String(req.headers.authorization || '') });
  res.setHeader('cache-control', 'no-store');
  res.status(r.status).json(r.body);
}
