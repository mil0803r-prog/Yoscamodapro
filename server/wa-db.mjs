// Lee las etiquetas de cada chat directo de la base de datos de Evolution API (tabla "Chat", columna "labels").
// Así el panel ve SIEMPRE el estado real de WhatsApp (como WhatsApp Web), sin depender de avisos.
// Variable: EVO_DB_URL (la dirección PÚBLICA de la base de datos Postgres de Railway). Solo se hace SELECT.
import pg from 'pg';

const url = () => String(process.env.EVO_DB_URL || '').trim();
export const dbConfigurada = () => /^postgres(ql)?:\/\//i.test(url());

async function consultar(sql, params, ssl) {
  const cl = new pg.Client({ connectionString: url(), ssl: ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 8000, statement_timeout: 8000, query_timeout: 9000 });
  await cl.connect();
  try { return await cl.query(sql, params); } finally { try { await cl.end(); } catch { /* ya cerrada */ } }
}
async function ejecutar(sql, params) {
  try { return await consultar(sql, params, true); }
  catch (e) { if (e && e.code && String(e.code).startsWith('4')) throw e; return await consultar(sql, params, false); } // sin SSL si el servidor no lo admite
}
const aIds = (raw) => {
  let a = raw;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { a = []; } }
  return (Array.isArray(a) ? a : []).map((l) => String((l && typeof l === 'object' ? (l.id || l.labelId) : l) || '')).filter(Boolean);
};
// Devuelve { ok, mapa: Map(jid -> [ids]) } o { ok:false, error }
export async function etiquetasPorChat(instancia) {
  if (!dbConfigurada()) return { ok: false, error: 'sin_db' };
  const base = 'SELECT c."remoteJid" AS jid, c."labels" AS labels FROM "Chat" c JOIN "Instance" i ON i."id" = c."instanceId" WHERE i."name" = $1 AND c."labels" IS NOT NULL';
  try {
    let r;
    try { r = await ejecutar(base + ' ORDER BY c."updatedAt" ASC NULLS FIRST', [instancia]); }
    catch (e) { if (e && e.code === '42703') r = await ejecutar(base, [instancia]); else throw e; }
    const mapa = new Map();
    for (const f of r.rows) { const j = String(f.jid || ''); if (j) mapa.set(j, aIds(f.labels)); } // si hay filas repetidas, la más reciente manda
    return { ok: true, mapa };
  } catch (e) {
    const c = e && e.code ? String(e.code) : '';
    return { ok: false, error: c === '42P01' || c === '42703' ? 'esquema' : c === '28P01' || c === '28000' ? 'clave' : 'conexion' };
  }
}
