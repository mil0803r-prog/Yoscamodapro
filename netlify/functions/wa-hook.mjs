import { handle } from '../../server/wa-hook.mjs';

export default async (req) => {
  const query = Object.fromEntries(new URL(req.url).searchParams);
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const r = await handle({ method: req.method, query, rawBody });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/wa-hook' };
