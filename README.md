# Yosca Moda Pro

Herramienta de gestión para una marca de ropa: calculadora de costos y precios, pedidos, gastos fijos y variables, proyección y un asistente con IA.

- `index.html` es toda la app (sin instalar nada).
- `copia-original/` es la copia de la app anterior, solo de consulta.

## Asistente de IA con Gemini (fuera de Claude)

El asistente usa un pequeño servicio propio (`/api/asistente`) que guarda tu clave de Gemini en el servidor. La clave **nunca** va dentro de la página ni del repositorio.

Si la app se abre dentro de Claude, el asistente usa Claude y no necesita nada de esto.

### 1. Crea tu clave de Gemini
En https://aistudio.google.com/apikey crea una clave. Guárdala en privado.

### 2. Publica el proyecto desde GitHub
Funciona igual en Netlify o en Vercel. Importa este repositorio sin comando de build y sin carpeta de salida.
> Las funciones del servidor no corren si arrastras y sueltas la carpeta. Hay que publicar desde GitHub.

### 3. Configura las variables de entorno
En el panel de tu hosting (Netlify: *Site configuration → Environment variables*; Vercel: *Settings → Environment Variables*):

| Variable | Qué es |
|---|---|
| `GEMINI_API_KEY` | Tu clave de Gemini (obligatoria) |
| `ASISTENTE_CLAVE` | Una contraseña que tú inventes. La escribirás una vez en el asistente (obligatoria) |
| `GEMINI_MODEL` | Opcional. Por defecto `gemini-3.8-flash`; si no existe, usa `gemini-2.5-flash` |

Vuelve a publicar después de guardarlas.

### 4. Úsalo
Abre tu enlace, toca **Asistente** y escribe la contraseña (`ASISTENTE_CLAVE`). La app la recuerda en ese dispositivo.

### Seguridad y costos
- Sin la contraseña nadie puede usar el asistente ni gastar tu saldo.
- Hay un límite de 15 preguntas por minuto por conexión.
- A Gemini solo se envían tus datos de negocio (prendas, costos, pedidos y gastos), sin nombres ni teléfonos de clientes.
- El uso de Gemini se cobra o descuenta de tu cuenta de Google AI según tu plan.

### Probarlo en tu computador
```
GEMINI_API_KEY=tu_clave ASISTENTE_CLAVE=tu_contraseña node dev-server.mjs
```
Abre http://localhost:3000
