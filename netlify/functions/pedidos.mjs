import { handle } from '../../server/pedidos-api.mjs';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-api-key, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-max-age': '86400' };

const rutaDe = (p) => p.startsWith('/.well-known/oauth-protected-resource') ? 'wk-recurso' : p.startsWith('/.well-known/oauth-authorization-server') || p === '/.well-known/openid-configuration' ? 'wk-servidor' : p === '/oauth/register' ? 'oauth/register' : p === '/oauth/token' ? 'oauth/token' : p === '/api/oauth/aprobar' ? 'oauth/aprobar' : p.replace(/^\/api\//, '');

export default async (req, context) => {
  const url = new URL(req.url);
  const rawBody = req.method === 'POST' ? await req.text() : '';
  const headers = Object.fromEntries(req.headers.entries());
  const r = await handle({ method: req.method, ruta: rutaDe(url.pathname), query: Object.fromEntries(url.searchParams), headers, rawBody, ip: (context && context.ip) || '?', origen: url.origin });
  const h = { ...CORS, 'cache-control': 'no-store', ...(r.headers || {}) };
  if (r.body === null || r.body === undefined) return new Response(null, { status: r.status, headers: h });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...h, 'content-type': 'application/json' } });
};

export const config = { path: ['/api/mcp', '/api/v1/*', '/api/openapi.json', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/*', '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/.well-known/oauth-authorization-server/*', '/oauth/register', '/oauth/token', '/api/oauth/aprobar'] };
