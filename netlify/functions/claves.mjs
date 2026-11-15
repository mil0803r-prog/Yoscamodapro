import { handle } from '../../server/claves-api.mjs';

export default async (req) => {
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const r = await handle({ method: req.method, rawBody, authorization: req.headers.get('authorization') || '' });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/claves' };
