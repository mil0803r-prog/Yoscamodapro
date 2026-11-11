import { handle } from '../server/wa-hook.mjs';

export default async function handler(req, res) {
  const rawBody = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})) : '';
  const r = await handle({ method: req.method, query: req.query || {}, rawBody });
  res.setHeader('cache-control', 'no-store');
  res.status(r.status).json(r.body);
}
