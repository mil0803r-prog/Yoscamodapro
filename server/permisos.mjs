// Permisos por herramienta: el administrador decide qué correos usan cada herramienta nueva
// (Equipo y permisos → «Herramientas nuevas»). Para añadir otra herramienta: sumarla aquí y en HERRAMIENTAS (index.html).
import { leerDoc } from './fs-admin.mjs';

export const HERRAMIENTAS = ['integ', 'ped_ia'];
const EXIGEN_BASE_PROPIA = ['integ'];   // las que guardan datos propios (claves, pedidos entrantes)
const admins = () => String(process.env.ADMIN_EMAILS || process.env.LEER_EMAILS || 'mil0803r@gmail.com').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const cache = new Map();

/** ¿Puede este usuario (ya verificado con Firebase) usar la herramienta? Devuelve true/false. El administrador siempre puede. */
export async function puede(u, herramienta) {
  if (!u || !u.verificado || !u.email || !HERRAMIENTAS.includes(herramienta)) return false;
  if (admins().includes(u.email)) return true;
  const k = u.email + '|' + herramienta, c = cache.get(k);
  if (c && Date.now() < c.vence) return c.ok;
  let ok = false;
  try {
    const f = await leerDoc('acceso/' + u.email);
    // Las herramientas con datos propios (claves, pedidos entrantes) exigen «base propia» para no mezclar datos
    ok = !!(f && f.estado === 'activo' && (f.propio === true || !EXIGEN_BASE_PROPIA.includes(herramienta)) && f.permisos && f.permisos[herramienta] === 'editar');
  } catch { ok = false; }
  cache.set(k, { ok, vence: Date.now() + 20_000 });
  if (cache.size > 500) cache.clear();
  return ok;
}
