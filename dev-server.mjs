// Servidor local para probar todo junto:  node dev-server.mjs
// Variables: GEMINI_API_KEY, ASISTENTE_CLAVE (y opcional GEMINI_MODEL, PORT)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handle } from './server/asistente-core.mjs';

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
