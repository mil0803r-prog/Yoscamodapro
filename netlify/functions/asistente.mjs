import { handle } from '../../server/asistente-core.mjs';

export default async (req, context) => {
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const r = await handle({
    method: req.method,
    rawBody,
    clave: req.headers.get('x-asistente-clave') || '',
    ip: (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || '?',
  });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};

export const config = { path: '/api/asistente' };
