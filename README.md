# Yosca Moda Pro

Herramienta de gestión para una marca de ropa: calculadora de costos y precios, pedidos, gastos fijos y variables, proyección y un asistente con IA.

- `index.html` es toda la app (sin instalar nada).
- `copia-original/` es la copia de la app anterior, solo de consulta.

## Inicio de sesión (Google y correo con contraseña) con datos en cualquier dispositivo

Se hace con Firebase (plan gratuito Spark). Mientras `firebase-config.js` tenga `null`, la app funciona sin cuenta y guarda los datos solo en ese navegador.

1. En https://console.firebase.google.com crea un proyecto.
2. **Authentication → Método de acceso:** activa **Correo electrónico/contraseña** y **Google**.
3. **Authentication → Configuración → Dominios autorizados:** agrega el dominio de tu app (por ejemplo `tu-app.vercel.app`, sin `https://`).
4. **Configuración del proyecto → Tus apps → Web (`</>`):** copia el bloque `firebaseConfig` y pégalo en `firebase-config.js` (son datos públicos, no secretos).
5. **Firestore Database → Crear base de datos** (modo producción) y en **Reglas** pega:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
6. Sube el cambio a GitHub; Vercel o Netlify publican solos.

Cada persona ve únicamente sus datos. La primera vez que alguien entra, lo que ya tenía guardado en ese navegador se sube a su cuenta. Al cerrar sesión se borran los datos locales del dispositivo.

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
| `FIREBASE_PROJECT_ID` | Opcional. El `projectId` de tu Firebase, para que el asistente use tu sesión en vez de la contraseña |
| `ASISTENTE_EMAILS` | Opcional. Correos autorizados para usar el asistente, separados por comas. Con sesión iniciada solo entran estos correos y con el correo verificado |
| `GEMINI_MODEL` | Opcional. Por defecto `gemini-3.8-flash`; si no existe, usa `gemini-2.5-flash` |

Vuelve a publicar después de guardarlas.

### 4. Úsalo
Abre tu enlace, toca **Asistente**. Si iniciaste sesión y tu correo está en `ASISTENTE_EMAILS`, funciona directo; si no, escribe la contraseña (`ASISTENTE_CLAVE`) una vez y la app la recuerda en ese dispositivo.

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
