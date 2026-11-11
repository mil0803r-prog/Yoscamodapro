import { handle } from '../../server/wa-core.mjs';

export default async (req, context) => {
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const r = await handle({ method: req.method, rawBody, authorization: req.headers.get('authorization') || '', ip: (context && context.ip) || '?' });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/wa' };
