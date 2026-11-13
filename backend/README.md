# API de PetSuite

Este servidor Node 24 expone en `/api/v1` el mismo contrato que `src/mock/server.ts` (rutas, validaciones, mensajes y forma de las respuestas). Con él, un QR con token opaco se abre desde otro teléfono, el visitante deja un aviso, el tutor lo ve en su bandeja y reemplazar o desactivar la medalla invalida el código anterior.

## Origen de los datos

| `.env` | Datos |
| --- | --- |
| Con `DATABASE_URL` | PostgreSQL en Supabase, mediante las rutas de `backend/api/`. Ver `backend/db/README.md` para configurar la base. |
| Sin `DATABASE_URL` | El mock del navegador, con el estado guardado en `data/petsuite.json`. |

`npm run api:start` lee `.env` si existe y muestra al iniciar qué datos usa.

## Cómo está hecho el API sobre PostgreSQL

- Cada solicitud corre en una transacción: si la ruta falla, no queda nada a medias.
- Las sesiones se guardan en la tabla `sesiones` como SHA-256 del token, con 30 días de vigencia. Las claves se verifican con bcrypt.
- Las reglas de negocio reutilizan lo compartido con el frontend: validaciones Zod de `src/shared/validators.ts`, planes de `src/modules/plans/plans.ts` y permisos de `src/shared/permissions.ts`.
- **Paridad con el mock.** `backend/api/paridad.test.mjs` corre los mismos guiones contra el mock y contra una base PGlite (PostgreSQL en memoria) con los mismos datos, y exige respuestas idénticas.
  - Una prueba de cobertura falla si alguna ruta queda sin guion.
  - Si cambias una regla, cámbiala en `src/mock` y en `backend/api`. La prueba indica el paso exacto que difiere.

Pruebas: `npm test` ejecuta las del mock, las del servidor HTTP (con archivo y con PGlite) y las de paridad. No necesita Supabase ni Docker.

## Probar en la misma computadora

Desde la raíz del proyecto, en una terminal:

```powershell
npm run api:start
```

En otra terminal configura el frontend antes de iniciar Vite:

```powershell
$env:VITE_API_URL = 'http://127.0.0.1:3000/api/v1'
npm run dev
```

Para abrirlo desde otro teléfono o desde GitHub Pages, el servidor debe estar publicado en una dirección alcanzable por ambos dispositivos. La compilación del frontend debe usar `VITE_API_URL=https://TU_API/api/v1` y el backend debe permitir el origen del sitio con `PETSUITE_CORS_ORIGINS`. GitHub Pages requiere que la API use HTTPS.

Para probarlo dentro de una red privada, configura en la terminal del servidor `HOST=0.0.0.0`, `PETSUITE_ALLOW_DEMO_API=1` y `PETSUITE_CORS_ORIGINS` con el origen exacto del frontend. `PORT` cambia el puerto (predeterminado: `3000`). `PETSUITE_DATA_FILE` cambia el archivo de datos (predeterminado: `data/petsuite.json`); conserva ese archivo en un volumen persistente y ejecuta **una sola instancia** del servidor.

Por ejemplo, si la computadora tiene la IP `192.168.1.10`, en la terminal del API:

```powershell
$env:HOST = '0.0.0.0'
$env:PETSUITE_ALLOW_DEMO_API = '1'
$env:PETSUITE_CORS_ORIGINS = 'http://192.168.1.10:5173'
npm run api:start
```

En la terminal del frontend:

```powershell
$env:VITE_API_URL = 'http://192.168.1.10:3000/api/v1'
npm run dev -- --host 0.0.0.0
```

Abre `http://192.168.1.10:5173` en ambos dispositivos. La URL del API debe usar la IP de la computadora, nunca `127.0.0.1` en el teléfono.

El servidor reutiliza las cuentas y contraseñas conocidas de la demostración. `PETSUITE_ALLOW_DEMO_API=1` habilita explícitamente su acceso desde la red; esta versión sirve para probar el flujo compartido, no para alojar cuentas reales. El archivo `data/` queda fuera de Git.

## Versión real, sin cuentas demo

Las cuentas reales confirman su correo antes de ingresar. Recuperan la contraseña con un enlace, y quienes crea una Pyme o un asesor reciben una invitación para crear la suya; nunca se envían claves por correo.

Los comandos `npm run db:*` leen `.env`, que apunta a la base de la demo. Las conexiones de la base real van en `.env.production.local`, que Git ignora, y sus comandos se ejecutan indicando ese archivo:

```powershell
node --env-file=.env.production.local backend/db/migrate.mjs
```

1. **Base propia.** Usa un proyecto de Supabase distinto del de la demo y aplica solo las migraciones, que dejan las comunas y los planes. **No ejecutes `db:seed` en esa base**: carga las cuentas demo con la clave `petsuite123`.
2. **Correo.** Crea una cuenta en [Resend](https://resend.com) y verifica tu dominio. Sin dominio verificado, Resend solo envía a tu propio correo. Define en el entorno del API:
   - `RESEND_API_KEY`: la clave de Resend.
   - `MAIL_FROM`: el remitente, por ejemplo `PetSuite <no-responder@tudominio.cl>`.
   - `APP_URL`: la dirección de la app que abren los enlaces, con barra final.
3. **Administrador y asesores.** No tienen registro público. Crea cada cuenta con `backend/db/crear-admin.mjs`, y agrega `--asesor` para un asesor:

   ```powershell
   node --env-file=.env.production.local backend/db/crear-admin.mjs tu@correo.cl Tu nombre
   node --env-file=.env.production.local backend/db/crear-admin.mjs --asesor asesora@correo.cl Su nombre
   ```

   El enlace para crear la contraseña aparece en la terminal y vence en 7 días. El de un asesor se le entrega solo a esa persona. Define antes `APP_URL` en ese archivo, o el enlace apuntará a `localhost`.

### Publicar en Vercel

El frontend y el API se publican juntos en un mismo proyecto de Vercel, así que comparten dirección y no hace falta configurar CORS. `vercel.json` ejecuta `npm run build:vercel`, que compila la app con `VITE_API_URL=/api/v1` y genera `.vercel/output`: los archivos del frontend y una función con todo el API, en São Paulo (`gru1`), la región de la base.

1. En Vercel, importa este repositorio. No cambies los ajustes de compilación.
2. En **Settings → Environment Variables**, agrega estas variables **solo para Production**, para que las vistas previas de los PR no usen la base real:
   - `DATABASE_URL`: la cadena del Transaction pooler (puerto 6543).
   - `RESEND_API_KEY` y `MAIL_FROM`.
3. Publica y comprueba `https://<proyecto>.vercel.app/healthz` y `https://<proyecto>.vercel.app/api/v1/comunas`.

`APP_URL` es opcional: si falta, se usa el dominio de producción del proyecto, y cambia solo al agregar un dominio propio. Cada fusión en `main` publica una versión nueva. GitHub Pages sigue siendo la demo con el mock.

Con proveedor configurado, la bandeja de correos que ven el asesor y el administrador guarda cada mensaje sin el enlace de acceso. Si Resend falla al enviar un enlace, la solicitud responde 502 y no queda una cuenta a medias.

Con un dominio propio, fija `APP_URL` con ese dominio y redirige `<proyecto>.vercel.app` hacia él en **Settings → Domains**. El API acepta solicitudes desde `APP_URL`, el dominio de producción del proyecto y la vista previa en curso. Si hace falta otro origen, agrégalo en `PETSUITE_CORS_ORIGINS`.

### Datos de demostración en la versión real

Para presentar PetSuite en www.petsuite.space sin crear cuentas a mano, `backend/db/demo-presentacion.mjs` carga los datos de la demo (los mismos de GitHub Pages) junto a los reales, y después los quita.

```bash
# 1. Simulación: muestra qué cargaría, sin escribir nada
node --env-file=.env.production.local backend/db/demo-presentacion.mjs --clave "una-clave-larga-2026"
# 2. Cargar
node --env-file=.env.production.local backend/db/demo-presentacion.mjs --clave "una-clave-larga-2026" --aplicar
# 3. Después de la presentación: quitar todo lo cargado (primero sin --aplicar para revisar)
node --env-file=.env.production.local backend/db/demo-presentacion.mjs --quitar --aplicar
```

- Todas las cuentas terminan en `@demo.petsuite.space` y usan la clave que indicas (10 caracteres o más). El API no les envía correos reales: quedan en la bandeja.
- Cuentas: `tutor@` (Luna con su medalla QR), `tutor2@`, `veterinaria@` (Oro), `clinico@`, `tienda@` (Plata), `jefe@`, `peluqueria@` (bajó a Gratis), `ong@` (Patitas del Sur), `ong2@` y `nuevo@`, un negocio en verificación sin documentos para mostrar la subida y la revisión.
- No crea administradores ni asesores, porque tendrían acceso a los datos reales. La revisión de documentos y pagos se hace con la cuenta real del administrador.
- Los negocios y las ONG llevan «(demo)» en el nombre, porque se ven en Explorar. Quítalos al terminar.
- `--quitar` borra las cuentas del dominio de demostración y todo lo que depende de ellas (también lo que hicieron durante la presentación), siguiendo las claves foráneas. Nunca toca otras cuentas.

### Pagos con Mercado Pago

Los planes se pagan con Mercado Pago (Checkout Pro) cuando el API tiene `MP_ACCESS_TOKEN`. Sin esa variable, la app solo ofrece transferencia.

1. Crea una cuenta en Mercado Pago y entra a [Mercado Pago Developers](https://www.mercadopago.cl/developers/panel/app) → **Tus integraciones → Crear aplicación** (producto: Checkout Pro).
2. En la aplicación, copia el **Access Token de prueba** (`TEST-…`) desde **Credenciales de prueba**.
3. En Vercel agrega `MP_ACCESS_TOKEN` solo para **Production** y publica de nuevo (las variables llegan solo a despliegues nuevos).
4. Prueba con un **usuario comprador de prueba** y las **tarjetas de prueba** de Mercado Pago (Developers → Cuentas de prueba). Con un token `TEST-` el API abre el checkout de prueba (`sandbox_init_point`).
5. Para cobrar de verdad, cambia `MP_ACCESS_TOKEN` por el Access Token de producción.

Cómo funciona: el API crea una preferencia con el monto del plan en pesos y `external_reference` = id del pago en PetSuite. La preferencia vence en 3 días. Mercado Pago devuelve a la Pyme a `APP_URL?pago=mercadopago` y avisa a `APP_URL/api/v1/pagos/mercadopago/webhook` (solo si `APP_URL` es https). En los dos casos el API vuelve a consultar el pago a Mercado Pago con su token, y solo activa el plan si está aprobado, por el monto exacto y en CLP. Así, un aviso falso no puede activar nada. El asesor no confirma estos pagos a mano. Un pago sin completar se reemplaza si la Pyme pide otro plan o medio, salvo que ya se haya pagado: en ese caso se confirma.

### Avisos, límites y monitoreo

- **Aviso al tutor.** Cada mensaje enviado desde la ficha pública de un QR le llega al tutor por correo, con el mensaje, el contacto y la ubicación que dejó quien escribió. La copia de la bandeja omite esos datos. Si el correo falla, el mensaje igual queda guardado y el tutor lo ve en la ficha.
- **Límites de solicitudes** (`src/shared/limites.ts`, iguales en el mock):
  - 5 contraseñas incorrectas por cuenta y cliente cada 15 minutos, y 30 por cliente;
  - 10 correos de registro, reenvío o recuperación por cliente cada hora;
  - 5 mensajes por medalla y cliente cada hora, y 30 por medalla al día.

  Al superarlos, el API responde 429. El cliente es la huella SHA-256 de la IP, y la tabla `limites_solicitudes` guarda solo huellas.
- **Monitoreo.** `/healthz` hace una consulta a la base y responde 503 si no contesta. El workflow `Salud` lo consulta dos veces al día, avisa en Discord si falla y, con eso, evita que Supabase pause la base del plan gratuito. Define la variable del repositorio `SALUD_URL` (por ejemplo `https://petsuite.space`). Sin ella, usa `https://mockap-petsuite.vercel.app`. GitHub desactiva los workflows programados tras 60 días sin actividad en el repositorio.

**Aplica cada migración en la base real antes de fusionar en `main`**, porque la fusión publica de inmediato. Si la migración 006 todavía no está aplicada, el API sigue guardando los mensajes y permitiendo el ingreso, pero sin límites ni avisos por correo, y lo anota en el registro de Vercel.

Antes de abrir la versión real al público falta verificar el certificado TLS de Supabase en lugar de `sslmode=no-verify`.

Verificación local: `npm test`.
