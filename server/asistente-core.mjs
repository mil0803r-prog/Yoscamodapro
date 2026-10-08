// Servicio del asistente: recibe la pregunta desde la app, llama a Gemini con la clave
// guardada en el servidor y devuelve la respuesta. La clave nunca viaja al navegador.
import { createHash, timingSafeEqual } from 'node:crypto';

const MODELO_PRINCIPAL = 'gemini-3.8-flash';
const MODELO_RESPALDO = 'gemini-2.5-flash';
const LIMITE_POR_MINUTO = 15;
const MAX_BYTES = 350_000;
const golpes = new Map();

const base = () => process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
const sha = (s) => createHash('sha256').update(String(s)).digest();
const claveOk = (a, b) => timingSafeEqual(sha(a), sha(b));

function superaLimite(ip) {
  const ahora = Date.now();
  const lista = (golpes.get(ip) || []).filter((t) => ahora - t < 60_000);
  lista.push(ahora);
  golpes.set(ip, lista);
  if (golpes.size > 500) for (const [k, v] of golpes) if (!v.some((t) => ahora - t < 60_000)) golpes.delete(k);
  return lista.length > LIMITE_POR_MINUTO;
}

// Gemini espera los tipos del esquema en mayúsculas (OBJECT, STRING...).
function esquemaGemini(s) {
  if (Array.isArray(s)) return s.map(esquemaGemini);
  if (s && typeof s === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'type' && typeof v === 'string') o[k] = v.toUpperCase();
      else if (k === 'additionalProperties' || k === '$schema') continue;
      else o[k] = esquemaGemini(v);
    }
    return o;
  }
  return s;
}

async function llamar(modelo, payload, signal) {
  return fetch(`${base()}/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function handle({ method, rawBody, clave, ip }) {
  const disponible = Boolean(process.env.GEMINI_API_KEY && process.env.ASISTENTE_CLAVE);
  if (method === 'GET') return { status: 200, body: { disponible } };
  if (method !== 'POST') return { status: 405, body: { error: 'metodo' } };
  if (!disponible) return { status: 503, body: { error: 'no_configurado' } };
  if (!claveOk(clave || '', process.env.ASISTENTE_CLAVE)) return { status: 401, body: { error: 'clave' } };
  if (superaLimite(ip || '?')) return { status: 429, body: { error: 'limite' } };
  if (!rawBody || rawBody.length > MAX_BYTES) return { status: 413, body: { error: 'grande' } };

  let b;
  try { b = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'json' } }; }
  const contents = Array.isArray(b.contents) ? b.contents : null;
  if (!contents || !contents.length || contents.length > 80 || typeof b.system !== 'string')
    return { status: 400, body: { error: 'datos' } };
  if (!contents.every((c) => c && (c.role === 'user' || c.role === 'model') && Array.isArray(c.parts)))
    return { status: 400, body: { error: 'datos' } };
  const decls = (Array.isArray(b.tools) ? b.tools : []).slice(0, 10)
    .filter((t) => t && /^[A-Za-z0-9_-]{1,64}$/.test(t.name || ''))
    .map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 1000), parameters: esquemaGemini(t.parameters || { type: 'object', properties: {} }) }));

  const payload = {
    systemInstruction: { parts: [{ text: b.system }] },
    contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
  };
  if (decls.length) payload.tools = [{ functionDeclarations: decls }];

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 55_000);
  try {
    const modelos = [...new Set([process.env.GEMINI_MODEL || MODELO_PRINCIPAL, MODELO_RESPALDO])];
    let res;
    for (const m of modelos) {
      res = await llamar(m, payload, control.signal);
      if (res.ok) break;
      if (res.status !== 404) break; // solo se prueba el modelo de respaldo si el modelo no existe
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      let detalle = '';
      try { detalle = String(JSON.parse(txt).error.message || ''); } catch { detalle = txt; }
      detalle = detalle.replace(/\s+/g, ' ').slice(0, 300); // mensaje de Gemini, no contiene tu clave
      if (res.status === 429) return { status: 429, body: { error: 'cuota', detalle } };
      if ((res.status === 400 || res.status === 403) && /api key|API_KEY|permission/i.test(txt)) return { status: 502, body: { error: 'clave_gemini', detalle } };
      return { status: 502, body: { error: 'gemini', estado: res.status, detalle } };
    }
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    if (!cand) return { status: 502, body: { error: 'bloqueado' } };
    const content = { role: 'model', parts: (cand.content && cand.content.parts) || [] };
    const functionCalls = content.parts.filter((p) => p.functionCall)
      .map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args || {} }));
    const text = content.parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    return { status: 200, body: { content, functionCalls, text, truncated: cand.finishReason === 'MAX_TOKENS' } };
  } catch (e) {
    return { status: 502, body: { error: e && e.name === 'AbortError' ? 'tiempo' : 'red', detalle: String((e && e.message) || '').slice(0, 200) } };
  } finally {
    clearTimeout(timer);
  }
}
