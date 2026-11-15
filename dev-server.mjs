// Servidor local para probar todo junto:  node dev-server.mjs
// Variables: GEMINI_API_KEY, ASISTENTE_CLAVE (y opcional GEMINI_MODEL, PORT)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from './server/asistente-core.mjs';
import { handle as handleWa } from './server/wa-core.mjs';
import { handle as handleHook } from './server/wa-hook.mjs';
import { handle as handleImg } from './server/leer-imagen.mjs';
import { handle as handlePed } from './server/pedidos-api.mjs';

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const raiz = process.cwd();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/asistente') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle({ method: req.method, rawBody: Buffer.concat(chunks).toString('utf8'), clave: req.headers['x-asistente-clave'] || '', authorization: req.headers.authorization || '', ip: req.socket.remoteAddress });
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }
  if (url.pathname === '/api/mcp' || url.pathname === '/api/openapi.json' || url.pathname.startsWith('/api/v1/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handlePed({ method: req.method, ruta: url.pathname.replace(/^\/api\//, ''), query: Object.fromEntries(url.searchParams), headers: req.headers, rawBody: Buffer.concat(chunks).toString('utf8'), ip: req.socket.remoteAddress, origen: 'http://' + req.headers.host });
    res.writeHead(r.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...(r.headers || {}) });
    return res.end(r.body === null || r.body === undefined ? undefined : JSON.stringify(r.body));
  }
  if (url.pathname === '/api/leer-imagen') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handleImg({ method: req.method, rawBody: Buffer.concat(chunks).toString('utf8'), authorization: req.headers.authorization || '', ip: req.socket.remoteAddress });
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }
  if (url.pathname === '/api/wa-hook') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handleHook({ method: req.method, query: Object.fromEntries(url.searchParams), rawBody: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }
  if (url.pathname === '/api/wa') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handleWa({ method: req.method, rawBody: Buffer.concat(chunks).toString('utf8'), authorization: req.headers.authorization || '', ip: req.socket.remoteAddress });
    res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }
  let ruta = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (ruta.endsWith('/') || ruta === '') ruta = join(ruta, 'index.html');
  try {
    const datos = await readFile(join(raiz, ruta));
    res.writeHead(200, { 'content-type': tipos[extname(ruta)] || 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404); res.end('No encontrado');
  }
}).listen(process.env.PORT || 3000, () => console.log('Listo en http://localhost:' + (process.env.PORT || 3000)));
