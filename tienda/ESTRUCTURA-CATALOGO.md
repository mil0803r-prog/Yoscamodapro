# Yosca Moda · Estructura de la página Catálogo

Ruta propuesta: `tienda/catalogo.html` (URL limpia `/catalogo`). Usa los mismos
`datos.js`, colores y tipografías de la tienda; no duplica información.

## 1. Mapa de la página (de arriba hacia abajo)

```
┌──────────────────────────────────────────────┐
│ Cinta de anuncio (anuncio.frases)            │
├──────────────────────────────────────────────┤
│ Cabecera: logo · Inicio · Catálogo · Packs · │
│           Tallas · Ayuda · 🛒 carrito (n)    │
├──────────────────────────────────────────────┤
│ 1. Encabezado del catálogo                   │
│    migas: Inicio / Catálogo                  │
│    título "Nuestros básicos" + subtítulo     │
│    contador: "16 polos"                      │
├──────────────────────────────────────────────┤
│ 2. Barra de herramientas (fija al hacer      │
│    scroll)                                   │
│    [Todos][Cuello redondo][Cuello V]         │
│    Color ▾ · Talla ▾ · Precio ▾ · Orden ▾    │
│    chips de filtros activos + "Limpiar"      │
├──────────────────────────────────────────────┤
│ 3. Grilla de productos                       │
│    móvil 2 col · tablet 3 · escritorio 4     │
│    tarjeta: foto, insignia, nombre,          │
│    puntos de color, precio (+ precio antes), │
│    botón "Agregar" rápido                    │
│    (estados: cargando · sin resultados)      │
├──────────────────────────────────────────────┤
│ 4. Banda de packs (solo 3 tarjetas)          │
│    "Llevas más, pagas menos" → /#packs       │
├──────────────────────────────────────────────┤
│ 5. Ayuda rápida                              │
│    guía de tallas (enlace) · envíos · pagos  │
├──────────────────────────────────────────────┤
│ 6. Pie: marca, contacto, redes, pagos        │
└──────────────────────────────────────────────┘
 Flotantes: WhatsApp · carrito lateral · modal de producto
```

## 2. Bloques y de dónde sale cada dato

| Bloque | Campo en `datos.js` |
|---|---|
| Anuncio | `anuncio.frases` |
| Título y subtítulo | `secciones.tienda` |
| Filtro categoría | `categorias[]` (`id`, `nombre`) |
| Filtro talla | `tallas[]` |
| Filtro color | `productos[].color` + `hex` (únicos) |
| Filtro precio | mínimo y máximo de `productos[].precio` |
| Tarjeta | `nombre`, `foto`, `precio`, `antes`, `insignia`, `hex`, `activo` |
| Modal | tarjeta + `descripcion` (si vacía, `descripcionGeneral`), `stock` |
| Packs | `packs[]` con `activo` |
| Ayuda | `guiaTallas`, `textos.notaEnvio`, `textos.pagos` |
| Pie | `textos.*`, `contacto.*` |

Regla de visibilidad: solo se muestran productos con `activo: true`. Si
`stock[talla]` existe y es 0, esa talla aparece deshabilitada (si `stock` está
vacío, se asume disponible).

## 3. Comportamiento de filtros y orden

- Categoría: una sola a la vez (pestañas). Color y talla: selección múltiple.
- Precio: rango (todos valen S/ 29.90 hoy, así que el control se oculta si
  mínimo = máximo y reaparece cuando haya variedad).
- Orden: Destacados (por defecto: insignias primero), Precio ↑, Precio ↓, Nombre A–Z.
- El estado vive en la URL (`/catalogo?cat=v&color=Negro&talla=M&orden=precio-asc`)
  para poder compartir un enlace filtrado por WhatsApp.
- "Sin resultados": mensaje + botón "Limpiar filtros" + enlace a WhatsApp.

## 4. Flujo de compra

1. Tarjeta → botón "Agregar": si el polo tiene varias tallas abre el modal
   para elegir talla; si no, lo agrega directo.
2. Modal: foto, color, selector de talla, cantidad, "Agregar al carrito".
3. Carrito lateral → "Enviar pedido por WhatsApp" (mensaje armado con
   `contacto.saludo` + líneas del pedido + `contacto.cierrePedido`).
4. El carrito se guarda en el navegador y lo comparten `/` y `/catalogo`.
5. Sugerencia automática de pack: con 2, 3 o 6 polos en el carrito, aviso
   "Con el Pack Trío pagas S/ 79".

## 5. Archivos a crear o tocar

- `tienda/catalogo.html` (nuevo): estructura anterior.
- Mover a `tienda/tienda.js` y `tienda/tienda.css` lo común (carrito, modal,
  cabecera, pie) hoy embebido en `tienda/index.html`, para no copiarlo.
- `tienda/index.html`: la grilla se reduce a "Destacados" (8 productos) con
  botón "Ver todo el catálogo" → `/catalogo`.
- `tienda/vercel.json`: ya tiene `cleanUrls`; no necesita cambios.
- `tienda/editor.html`: sin cambios (el catálogo lee los mismos datos).

## 6. Calidad mínima

- Móvil primero (la compra llega por WhatsApp desde el celular).
- Fotos con `loading="lazy"` y `width/height` para evitar saltos.
- Botones y filtros accesibles por teclado, contraste AA sobre crema.
- Título y descripción propios para Google (`Catálogo · Yosca Moda`).

## 7. Pendientes de decisión

- ¿El catálogo reemplaza la grilla de la portada o convive con ella (recomendado: convive).
- Las respuestas de preguntas frecuentes aún tienen `[AGENCIA]`, `[__]`: completar antes de publicar.
- Falta `descripcion` por producto y `stock` por talla.
- Las fotos `foto-04, 08–16` que citan los datos no están en `tienda/img/`
  (solo existen 01, 02, 03, 05, 06, 07): hay que subirlas o esas tarjetas saldrán sin imagen.
