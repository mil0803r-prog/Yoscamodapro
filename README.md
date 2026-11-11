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

### Acceso privado: tú apruebas a cada correo (administrador: mil0803r@gmail.com)

Con esto la app deja de ser abierta: solo entra quien tú apruebes, y cada persona ve solo las secciones que le des (**Sin acceso / Solo ver / Ver y editar**).

1. En Firebase → **Firestore Database → Reglas**, borra lo que hay y pega **todo** el contenido del archivo `firestore.rules` de este repositorio. Toca **Publicar**.
2. Entra con `mil0803r@gmail.com` (verificado). Aparece la sección **Equipo**.
3. La persona crea su cuenta (o entra con Google), verifica su correo y toca **Solicitar acceso**. También puedes darle acceso tú escribiendo su correo en **Equipo → Dar acceso a un correo**.
4. En **Equipo** tocas **Aprobar…**, eliges permisos por sección (hay atajos: *Solo mirar*, *Vendedor*, *Todo editar*) y **Guardar**. Puedes cambiar permisos, suspender o quitar a alguien cuando quieras.

Las personas aprobadas trabajan sobre los datos del administrador (los mismos pedidos, inventario, etc.). Las reglas de Firestore hacen cumplir los permisos en el servidor, no solo en la pantalla. Tienda, Equipo y los respaldos son solo del administrador. En WhatsApp, quien tenga permiso lo usa sin estar en `WA_EMAILS` (se lee su permiso de Firestore; requiere `FIREBASE_PROJECT_ID`), pero conectar o desvincular el número es solo del administrador.

### Etiquetas como WhatsApp Web (recomendado: un solo paso)

Evolution guarda qué etiquetas tiene cada chat en su base de datos Postgres (tabla `Chat`, columna `labels`), pero su API no las entrega. La app las lee de ahí (solo `SELECT`) cada pocos segundos, así que ve siempre el estado real de WhatsApp, incluidas las etiquetas que los chats ya tenían:

1. Railway → tu proyecto → servicio **Postgres → Variables** → copia `DATABASE_PUBLIC_URL`.
2. Vercel → Environment Variables → crea `EVO_DB_URL` con ese valor (*Sensitive*, sin Development) y **Redeploy**.

Lo que cambies en el panel se aplica en WhatsApp Business por la API (`/label/handleLabel`), y lo que cambies en WhatsApp llega al panel en segundos. La sección siguiente (avisos/webhook) es una alternativa si no quieres exponer la base de datos.

### Etiquetas de WhatsApp Business sincronizadas en los dos sentidos

Evolution API **no entrega** qué etiquetas tiene cada chat, así que la app usa los avisos (webhook) de WhatsApp:

1. Firebase → Configuración del proyecto → **Cuentas de servicio → Generar nueva clave privada** (se descarga un `.json`).
2. En Vercel crea la variable `FIREBASE_SERVICE_ACCOUNT` con **todo** el contenido de ese `.json` (márcala *Sensitive*, sin Development) y haz **Redeploy**.
3. Publica de nuevo `firestore.rules` (incluye la colección `waEtq`).
4. En la app: **WhatsApp → Tableros → Activar sincronización desde WhatsApp**. Esto le indica a Evolution que avise a `/api/wa-hook` (protegido con una clave derivada de `WA_KEY`).

Desde ese momento, cada etiqueta que pongas o quites en WhatsApp aparece en el panel al instante, y lo que cambies en el panel se aplica en WhatsApp. Los avisos solo cuentan cambios nuevos: para traer las etiquetas que los chats ya tenían, desvincula y vuelve a escanear el QR una vez (o cambia esas etiquetas).

Respaldos: la app guarda sola una copia al día (últimas 14) en tu cuenta, en `users/{uid}/backups`, y se pueden restaurar o descargar desde Ajustes.

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
| `ASISTENTE_EMAILS` | Opcional. Si lo dejas vacío, cualquier cuenta con sesión iniciada puede usar el asistente. Si pones correos separados por comas, solo entran esos (con correo verificado) |
| `GEMINI_MODEL` | Opcional. Por defecto `gemini-3.8-flash`; si no existe, usa `gemini-2.5-flash` |

Vuelve a publicar después de guardarlas.

### 4. Úsalo
Abre tu enlace, toca **Asistente**. Si iniciaste sesión (y tu correo está en `ASISTENTE_EMAILS`, si lo usas), funciona directo; si no, escribe la contraseña (`ASISTENTE_CLAVE`) una vez y la app la recuerda en ese dispositivo.

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


## Inventario
Sección **Inventario**: prendas terminadas y materiales con stock, mínimo (alerta de stock bajo), entradas, salidas, conteo físico, historial y valor del inventario. En Pedidos puedes elegir qué producto descontar: al pasar a Enviado o Entregado se descuenta solo, y si el pedido se devuelve o cancela el stock regresa. Se guarda en `users/{uid}/inventory` y entra en los respaldos.

## Tienda con tu propio dominio
En el panel, la sección **Tienda** (solo con el correo del dueño) tiene cuatro pestañas: **Editor**, **Dominio**, **Nube** y **Ayuda**.
- La tienda vive en la carpeta `tienda/`. Para que tu dominio muestre **solo la tienda**, crea un segundo proyecto en Vercel con *Root Directory* = `tienda` y agrégale el dominio. Su `tienda/vercel.json` ya trae cabeceras de seguridad y no sirve el editor.
- Registros DNS: dominio principal → `A @ 76.76.21.21` (y `CNAME www cname.vercel-dns.com`); subdominio → `CNAME nombre cname.vercel-dns.com`.
- La pestaña Dominio verifica el DNS (vía dns.google) y que la tienda responda con https.
- Para que los cambios del editor se vean en el dominio sin subir archivos, conecta Supabase en la pestaña Nube y copia el `config.js` generado a `tienda/config.js`.

## WhatsApp conectado con QR (Evolution API)
La sección **WhatsApp** del panel puede conectarse a tu WhatsApp Business escaneando un QR. Usa un servidor tuyo con **Evolution API** en Railway; el panel habla con él a través de `/api/wa` (Vercel o Netlify), así la clave nunca llega al navegador.

Variables en Vercel (Settings → Environment Variables):
| Variable | Qué es |
|---|---|
| `WA_URL` | Dirección pública del servidor en Railway, sin `/` al final |
| `WA_KEY` | La clave `AUTHENTICATION_API_KEY` del servidor (márcala como Sensitive) |
| `WA_INSTANCE` | Nombre de la instancia (por defecto `yosca`) |
| `WA_EMAILS` | Opcional: correos con permiso, separados por coma (por defecto `mil0803r@gmail.com`) |
| `FIREBASE_PROJECT_ID` | Ya existe: se usa para verificar la sesión |

Después de guardar las variables, haz **Redeploy**. Luego en el panel: WhatsApp → **Conectar con QR**.
Esta conexión no es la oficial de Meta: úsala sin envíos masivos para cuidar tu número.
