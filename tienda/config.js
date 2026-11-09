/* =========================================================
   CONEXIÓN CON LA NUBE (Supabase) — se llena UNA sola vez.
   Sigue el paso 5 de GUIA-NUBE.md
   - url:    "Project URL" de Supabase (empieza con https://)
   - clave:  la clave "anon public" (es pública, se puede ver; NO pongas la "service_role")
   - tienda: el nombre corto de la tienda que creaste en el paso 4
   Si url o clave están vacías, la tienda usa el archivo datos.js.
   ========================================================= */
window.YOSCA_NUBE = {
  url: "",
  clave: "",
  tienda: "yosca"
};
