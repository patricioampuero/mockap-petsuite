# PetSuite — Bitácora de Cambios

Este archivo registra cada cambio o agregado realizado en el proyecto a partir del 16 de septiembre de 2026.

## Principio rector del producto

PetSuite es un marketplace de servicios Pet-Care. Cualquier persona, sin crear una cuenta, busca veterinarias, tiendas, peluquerías y otros servicios de su comuna, los compara en un mapa y llega a ellos.

Su núcleo es **Explorar**: la landing con su buscador y la página de resultados con lista y mapa. Ahí llegan todas las visitas, y la mayoría no creará una cuenta. Por eso:

- Explorar funciona completo sin sesión.
- Es transparente: el orden de los resultados es igual para todos y lo pagado se marca como «Patrocinado».
- El sello «Validado por PetSuite» dice exactamente qué se revisó.

Crear una cuenta es opcional y suma funciones:

- Ficha Única de Salud con QR de emergencia: quien encuentra una mascota ve sus alergias y condiciones y avisa al tutor sin ver sus datos privados.
- Historial médico y registros firmados por las veterinarias.
- Consultas a los negocios.
- Muro comunal para extravíos, encuentros, alertas y eventos.
- Adopción y apoyo a las ONG.

Los negocios tienen perfil público, catálogo, sucursales, equipo, publicidad y métricas según su plan. PetSuite valida, administra y modera la plataforma.

En resumen: PetSuite conecta tutores, mascotas, negocios Pet-Care y comunidad en un solo lugar. La puerta de entrada es Explorar; la Ficha con QR es la razón para quedarse.

Hasta el 2026-10-29 el núcleo era la Ficha Única con QR. Ese día, tras la reunión con el profesor, el usuario decidió que el núcleo pasa a ser Explorar.

Este principio debe considerarse antes de cualquier decisión de arquitectura, frontend, diseño visual, datos, validaciones o nuevas funcionalidades.

## Regla de trabajo

Estas reglas resumen errores que ya ocurrieron. Léelas antes de cada tarea.

### Ramas y sincronización

- Cada tarea o cambio se trabaja siempre en una rama nueva creada desde `origin/main`; nunca se modifica `main` directamente.
- Todas las ramas usan el formato `<nombredeusuario>/<cambio-branch>`, por ejemplo `arman/fe-12-abierto-ahora-branch`. `cambio-branch` es el texto descriptivo completo del nombre de la rama; no se añade `-branch` automáticamente al final de otro nombre. El nombredeusuario identifica a quien trabaja y la regla aplica a todas las personas del equipo.
- Antes de cada tarea, confirma que el árbol de trabajo esté limpio, actualiza `main` desde `origin/main` (Pull), revisa ramas sin fusionar (`git branch -a --no-merged main`) y crea una rama nueva con ese formato. Si aparece trabajo en una rama anterior que no está integrado, avisa al usuario antes de seguir.
- Publica la rama, abre un Pull Request y fusiónalo en `main` antes de empezar otra tarea.
  - Motivo: en octubre de 2026 el equipo trabajó una semana en `main` mientras la base de datos estaba en `benja-base-datos`, y hubo que unir ambas líneas a mano.
- No cambies de rama con cambios sin commit. GitHub Desktop los guarda en un stash que después se olvida; así quedaron fuera las instrucciones de acceso a la base. Termina y fusiona la tarea actual antes de crear la rama de la siguiente.

### Estructura del código

- `src/shared/`: núcleo común (`api`, `validators`, `permissions`, `media`, `feedback`, `accessibility`, `share`, `errors`, `legal`, `cuentas`, `profile-cover`, `metric`).
- `src/styles/`: hojas de estilo.
- `src/modules/<área>/`: una carpeta por área (landing, tutor, community, directory, business, clinical, ong, plans, promotions, advisor, admin, privacy, auth).
- `src/mock/`: API simulada en el navegador.
- `backend/api/` y `backend/db/`: API sobre PostgreSQL y migraciones.
- Todo archivo nuevo va en la carpeta de su módulo, nunca suelto en `src/`.
- No subas scripts personales ni archivos con rutas de tu computador (por ejemplo `C:/Users/...`). Déjalos fuera del repositorio.

### API: mock y base de datos

- Toda ruta o regla nueva o modificada se implementa a la vez en `src/mock/` y en `backend/api/`, con un paso en el guion de `backend/api/paridad.test.mjs`. La prueba de cobertura falla si una ruta queda sin guion.
- Una tarea «solo frontend» no toca `src/mock/` ni `backend/`. Si necesita un dato nuevo, se anota como dependencia.
- Las respuestas públicas (QR, adopciones, ONG) son lista blanca: nunca datos del tutor, medicamentos, historial ni ids internos. Un id interno solo se devuelve al dueño del recurso.
- La estructura de la base cambia solo con migraciones nuevas en `backend/db/migrations/`, nunca desde el panel de Supabase.
- La base es compartida: `npm run db:seed -- --reset` borra los datos de todo el equipo. No lo uses sin avisar.
- `.env` nunca se sube al repositorio ni se pega en el chat.

### Frontend

- Los enlaces usan `import.meta.env.BASE_URL` o rutas relativas (`./`), nunca `/`: en GitHub Pages la app vive en `/mockap-petsuite/`.
- La sesión está en `sessionStorage`; borrarlo cierra la sesión. Los datos del mock están en `localStorage` (`petsuite-mock-db-vN`); si cambia el modelo, sube la versión de la clave.
- Si cambias `public/sw.js`, sube la versión del caché.
- Para carga, vacío, error y permiso insuficiente usa los componentes de `src/shared/feedback.tsx`.
- El Inicio de cada rol abre con `ProfileCover` (`src/shared/profile-cover.tsx`) y los indicadores usan `Metric` (`src/shared/metric.tsx`). Las cifras de la portada salen siempre de datos reales; no se inventan seguidores, valoraciones ni notificaciones.
- Los estilos visuales nuevos van en `src/styles/design-pro.css` (se carga al final) y usan solo los tokens de `design.css`, para que funcionen con los seis temas y el modo oscuro.
- El menú de cada rol se define en `roleMenus` (`src/App.tsx`), con secciones desplegables. Una vista nueva va dentro de la sección que le corresponde; una sección con una sola opción visible se muestra suelta. En escritorio el menú se contrae a íconos. Hasta 800 px es un panel que se abre con ☰ desde la barra superior, así que ya no hay barra inferior.
- Sin sesión, la raíz es la landing. El ingreso está en `#ingresar` y el registro en `#registro`; no enlaces a `./` para ir al ingreso.
- Las páginas públicas (landing, `#explorar`, `#local/<id>`) usan `PublicHeader` y `PublicFooter` (`src/modules/landing/public-layout.tsx`). La búsqueda de Explorar está en `src/modules/directory/explore-search.ts`: el plan solo decide el bloque «Patrocinado», nunca el orden normal.

### Cuentas reales

PetSuite dejó de ser solo una demostración. La demo, con el mock y la clave `petsuite123`, sigue en GitHub Pages; la versión real usa otra base.

- La base real no tiene cuentas demo: nunca ejecutes `npm run db:seed` en ella. El administrador y los asesores se crean con `backend/db/crear-admin.mjs` (`npm run db:crear-admin` y `npm run db:crear-asesor`).
- `.env` apunta a la base de la demo y `npm run db:*` lo lee. La base real está en `.env.production.local`, que Git ignora, y sus comandos se ejecutan con `node --env-file=.env.production.local backend/db/<script>.mjs`.
- La versión real se publica en Vercel: frontend y API en un mismo proyecto, con `npm run build:vercel`. Las variables de la base van solo en el entorno Production, para que las vistas previas de los PR no la toquen. La atención HTTP está en `backend/http.mjs`, compartida por el servidor local y la función.
- Ninguna clave viaja por correo. Las cuentas que crea una Pyme o un asesor reciben una invitación para crear la suya.
- Los enlaces de confirmación, recuperación e invitación sirven una sola vez, vencen y se guardan como SHA-256. Al enviarlos con `enviarCorreo`, pasa el enlace como `privado`: con Resend configurado, la bandeja guarda el correo sin él.
- Reenviar la confirmación y recuperar la contraseña responden lo mismo exista o no la cuenta.
- Los textos, plazos y mensajes de las cuentas están en `src/shared/cuentas.ts`, compartido por el mock, el API y el frontend.
- Los botones de cuentas de prueba y «Datos de demostración» solo aparecen en la demo (`modoDemo`, sin `VITE_API_URL`).

### Verificación antes de terminar

- Ejecuta `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `npm test` y `git diff --check`.
- `npm test` enumera los archivos de prueba en `package.json`: cada prueba nueva se agrega ahí o no se ejecuta.
- Si cambias la interfaz, revísala en el navegador a 390 px y a 1366 px, en modo claro y oscuro. Si no la revisaste, dilo en la entrada.

### Bitácora

Antes de finalizar cualquier cambio, agrega una entrada con:

- Fecha.
- Archivos modificados o agregados.
- Cambio realizado.
- Motivo.
- Verificación ejecutada.

Cada entrada va al final del archivo, bajo el encabezado `## AAAA-MM-DD` de su día; no repitas ese encabezado ni dupliques entradas. Las rutas citadas son las vigentes al momento del cambio.

## 2026-09-16

### Estado inicial de seguimiento

- Archivos principales existentes: `src/App.tsx`, `src/styles.css`, `src/types.ts`, `src/validators.ts`.
- Funcionalidades existentes: autenticación demo, tutor, mascotas, QR, directorio, muro comunal, configuración, roles demo, paneles Pyme/clínico/admin y PWA básica.
- Verificación de referencia: `npm run build` ejecutado correctamente.

### Solicitud incorporada

- Se establece `Agents.md` como bitácora obligatoria para cambios y agregados futuros.

## 2026-09-16

### Separación de roles clínico y Pyme

- Archivos modificados: `src/App.tsx`.
- Cambio realizado: se diferenciaron las etiquetas de rol del perfil para tutor, administrador de Pyme, personal clínico veterinario y administrador de plataforma. Se mantuvieron separados los flujos y dashboards clínicos y comerciales.
- Motivo: evitar confundir al personal veterinario con las funciones administrativas de una Pyme.
- Verificación ejecutada: `npm run build` ejecutado correctamente.

## 2026-09-16

### Pymes como tiendas de productos y pedidos

- Archivos modificados: `src/App.tsx`, `src/types.ts`, `src/styles.css`.
- Cambio realizado: se orientó el Directorio a tiendas de productos para mascotas, se agregaron productos mock de alimentos, accesorios, higiene y salud, carrito de compra, solicitud de pedido con retiro o despacho y bandeja Pyme para actualizar estados del pedido.
- Motivo: representar correctamente el modelo comercial de PetSuite como distribución y venta de productos para mascotas.
- Verificación ejecutada: `npm run build` ejecutado correctamente.

## 2026-09-16

### Principio rector del producto agregado

- Archivos modificados: `Agents.md`.
- Cambio realizado: se agregó como principio principal la definición de PetSuite, su núcleo basado en la Ficha Única de Salud con QR de emergencia y sus módulos complementarios.
- Motivo: asegurar que toda decisión futura mantenga el propósito central del producto.
- Verificación ejecutada: revisión del contenido actualizado de `Agents.md`.

## 2026-09-16

### Administración de usuarios mejorada

- Archivos modificados: `src/App.tsx`, `src/styles.css`.
- Cambio realizado: se agregó buscador de usuarios, pestañas por estado, lista administrativa visual, suspensión personalizada o permanente mediante tarjeta de confirmación y reactivación de cuentas.
- Motivo: mejorar el control administrativo de usuarios y hacer más clara la moderación de cuentas reportadas o activas.
- Verificación ejecutada: `npm run build` ejecutado correctamente.

## 2026-09-23

### Identidad de suite y jerarquía visual

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `package.json`, `package-lock.json`, `Agents.md`.
- Cambio realizado: se sustituyó la identidad clínica de la cuenta Pyme por una tienda con catálogo de productos; se ajustó el acceso y la portada para destacar el QR de emergencia, las mascotas y la comunidad. Se incorporaron iconos Lucide a la navegación y vistas principales, separadores estructurales y enlaces funcionales desde Inicio.
- Motivo: representar PetSuite como plataforma de herramientas para mascotas, sin confundir el rol comercial con el clínico, y mejorar la legibilidad de las vistas sin usar caracteres decorativos como iconos.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

### Revisión de composición y legibilidad de las cinco vistas de tutor

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `Agents.md`.
- Cambio realizado: se sustituyó el fondo rosado general por una paleta neutra con paneles contrastados, navegación oscura fija, encabezados y textos más legibles. Inicio y mascotas ahora agrupan sus fichas en paneles; directorio separa resultados y mapa; comunidad aprovecha el ancho en columnas y configuración tiene navegación y formulario en superficies independientes. Se ajustó la presentación móvil y el modo oscuro, y se cambiaron los tonos coral y ámbar de bajo contraste.
- Motivo: corregir la falta de jerarquía, separación, contraste y densidad que impedía leer y distinguir las herramientas de PetSuite.
- Verificación ejecutada: `npm run build`, `git diff --check` y cálculo de contraste de los pares de texto principales (mínimo medido: 5,29:1).

### Paleta coherente en modo oscuro

- Archivos modificados: `src/styles.css`, `Agents.md`.
- Cambio realizado: se unificaron encabezado, tarjetas, campos y opciones de apariencia con las superficies azul verdosas del modo oscuro; el color elegido se conserva en botones y selecciones, con una versión aclarada para textos y contornos.
- Motivo: eliminar los fondos marrones heredados y evitar que el texto del acento desaparezca sobre superficies oscuras.
- Verificación ejecutada: `npm run build`, `git diff --check` y cálculo de contraste de los diez acentos aclarados sobre el panel oscuro (mínimo: 5,02:1).

### Acceso a cerrar sesión desde Perfil

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `Agents.md`.
- Cambio realizado: se presenta la acción de cerrar sesión al visualizar Perfil y se oculta de Privacidad, manteniendo su posición bajo el formulario en pantallas grandes y pequeñas.
- Motivo: agrupar la salida de la cuenta junto a los datos de perfil y reservar Privacidad para opciones de visibilidad.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

### Paletas visibles y persistentes en Apariencia

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `AGENTS.md`.
- Cambio realizado: se agregó la paleta Original azul verdosa como opción predeterminada, se corrigió la prioridad de los colores elegidos y se aplicó cada paleta a fondos, navegación y paneles destacados en claro y oscuro. La previsualización se restaura al salir sin guardar y conserva la selección al confirmar.
- Motivo: hacer que el cambio de paleta sea perceptible y que la configuración guardada se mantenga al navegar.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

### Corrección del color Original

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `Agents.md`.
- Cambio realizado: la opción Original y su muestra pasan a rojo brillante; fondos, textos, navegación y paneles destacados acompañan el rojo en claro y oscuro en lugar de mantener la identidad verde anterior.
- Motivo: respetar el color original indicado por el usuario y diferenciarlo de Carmesí.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

### Bandeja de usuarios reportados

- Archivos modificados: `src/App.tsx`, `src/styles.css`, `Agents.md`.
- Cambio realizado: la vista de moderación de usuarios incluye resumen de pendientes, buscador, filas con identidad, rol y estado separados, acciones alineadas y un estado vacío diferenciado. Se conectó la confirmación de suspensión de esta bandeja a la actualización persistente de la cuenta.
- Motivo: hacer que la revisión de reportes tenga la jerarquía y claridad de las demás vistas administrativas y que sus acciones sean operativas.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

### Revisión contextual de reportes y medidas

- Archivos modificados o agregados: `src/App.tsx`, `src/moderation.ts`, `src/validators.ts`, `src/styles.css`, `Agents.md`.
- Cambio realizado: Resolver y Suspender abren modales con el motivo, el perfil o publicación afectada y mensajes de denunciantes. Se agregaron cierre, advertencia o solicitud de información; chat privado mock persistente; suspensión por días o baneo permanente; mensaje obligatorio validado con Zod, registro local de decisiones y conexión de reportes del muro con la bandeja.
- Motivo: dar contexto a cada decisión de moderación y permitir comunicar y registrar las medidas sin perder los reportes pendientes.
- Verificación ejecutada: `npm run build` y `git diff --check` correctamente.

## 2026-09-24

### Ficha única de salud y QR público portable

- Archivos modificados o agregados: `src/App.tsx`, `src/types.ts`, `src/validators.ts`, `src/publicQr.ts`, `src/publicQr.test.mjs`, `src/styles.css`, `public/sw.js`, `Agents.md`.
- Cambio realizado: las mascotas permiten editar datos básicos, alergias, condiciones, medicamentos y notas de emergencia; se agregó un historial privado de vacunas, atenciones y tratamientos. El tutor controla si puede generar el QR, previsualizar y compartir la ficha, descargar PNG e imprimirlo. El enlace QR lleva exclusivamente una instantánea validada de campos públicos, por lo que la ficha abre sin cuenta ni `localStorage` del tutor en otro dispositivo; enlaces inválidos no exponen la ficha privada. El formulario de contacto queda identificado como demo local, con sus mensajes visibles solo en el navegador donde se guardaron. Se renovó el caché PWA para no servir la aplicación antigua al abrir un QR.
- Motivo: completar el núcleo de salud y seguridad del producto sin confundir una simulación local con un sistema de contacto o revocación remota.
- Verificación ejecutada: `node --test src/publicQr.test.mjs` (3 pruebas), `npm run build` y `git diff --check` correctamente.

### Publicación del mockup en GitHub Pages

- Fecha: 2026-09-24.
- Archivos modificados o agregados: `.github/workflows/pages.yml`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/publicQr.ts`, `src/publicQr.test.mjs`, `public/manifest.webmanifest`, `public/sw.js`, `tsconfig.app.json`, `Agents.md`.
- Cambio realizado: se configuró la verificación de PR y el despliegue automático de `main` a GitHub Pages; se adaptaron recursos, PWA y enlaces QR a la subruta `/mockap-petsuite/`.
- Motivo: publicar el mockup sin romper la ficha pública de emergencia ni las rutas de la aplicación.
- Verificación ejecutada: `node --test src/publicQr.test.mjs` (4 pruebas), `npm run build -- --base=/mockap-petsuite/`, inspección de `dist/index.html` y `git diff --check` correctamente.

### Avisos de cambios y fallos de Pages en Discord

- Fecha: 2026-09-24.
- Archivos modificados o agregados: `.github/workflows/discord-notifications.yml`, `.github/scripts/notify-discord.mjs`, `Agents.md`.
- Cambio realizado: se agregaron avisos en Markdown sin embeds al grupo configurado mediante `DISCORD_TOKEN` (secret) y `DISCORD_CHANNEL` (variable) cuando hay pushes a `main` o falla una publicación de Pages en `main`; las menciones quedan desactivadas.
- Motivo: informar cambios y errores de despliegue en la conversación indicada sin incluir credenciales en el repositorio.
- Verificación ejecutada: `node --check .github/scripts/notify-discord.mjs` y `git diff --check` correctamente.

## 2026-09-27

### Frontend igual al prototipo, con capa de datos simulada sin base de datos

- Fecha: 2026-09-27.
- Archivos modificados o agregados: `src/api.ts`, `src/mock/db.ts`, `src/mock/server.ts` (nuevos); `src/App.tsx`, `src/Login.tsx`, `src/tutor.tsx`, `src/community.tsx`, `src/directory.tsx`, `src/business.tsx`, `src/clinical.tsx`, `src/admin.tsx`, `src/adoption.tsx`, `src/media.tsx`, `src/validators.ts`, `src/styles.css`, `src/design.css`, `src/design-pages.css`, `src/design-polish.css`, `src/main.tsx` (copiados del prototipo de `Escritorio/mockap-petsuite` y adaptados); `public/img/*` con `CREDITOS.md`, `public/icon.svg`, `public/icon-192.png`, `public/icon-512.png`, `public/manifest.webmanifest`, `public/sw.js`, `index.html`, `package.json`, `package-lock.json`, `.github/workflows/pages.yml`, `Agents.md`. Eliminados: `src/types.ts`, `src/moderation.ts`, `src/publicQr.ts`, `src/publicQr.test.mjs`.
- Cambio realizado: se reemplazó el frontend por el del prototipo (roles tutor, Pyme, clínico, ONG y admin; Ficha Única con QR de token opaco; directorio con Leaflet y catálogo referencial; muro por comuna; adopción pública; moderación y verificación). `api()` conserva la firma del cliente HTTP, pero delega en `mock/server.ts`, que implementa las rutas y reglas del API (RBAC, control de versión de la ficha con 409, lista blanca del QR, límites de plan, adopción con traspaso de la ficha), con latencia de 150 a 350 ms y persistencia en `localStorage` (`petsuite-mock-db-v1`). El estado se relee en cada llamada para que las pestañas no se pisen. Se agregó «Restablecer datos de demostración» en Configuración > Privacidad. Se eliminaron el carrito, los pedidos, la ficha incrustada en la URL del QR y la paleta roja anterior, según lo acordado con el usuario. Fotos, íconos y enlaces QR respetan la base de GitHub Pages (`import.meta.env.BASE_URL`). Además, la lista de mascotas del tutor se recarga al cambiar de vista y la barra lateral angosta (≤800 px) ya no desborda el texto.
- Motivo: dejar el frontend igual al prototipo de referencia mientras no hay servidor, de modo que conectar el API real solo requiera cambiar `src/api.ts`.
- Limitaciones declaradas: sin servidor, un QR solo se abre en el navegador donde se creó (en otro teléfono muestra «Medalla no válida»); no se incrustan datos en la URL para conservar la desactivación de medallas. No hay correo, notificaciones push ni carga de fotos, y el catálogo de adopción no es indexable. Las contraseñas demo se guardan sin cifrar en `localStorage`.
- Verificación ejecutada: `npx tsc -b` y `npm run build` con la base de Pages, correctos. Recorrido con Playwright (Chromium) contra `vite`: 8 de 8 flujos correctos y sin errores de consola (QR y aviso al tutor, reemplazo de medalla, acceso de escritura y registro clínico visto por el tutor, directorio sin carrito y métricas de la Pyme, publicación, reporte y ocultamiento, adopción de Canela traspasada a Diego con Óctuple, aprobación de Rescate Nuevo, tema y modo oscuro persistentes). Revisión visual a 390 px sin desplazamiento horizontal. `git diff --check` no se ejecutó porque `git` no está en el PATH de esta terminal.

## 2026-09-29

### Más funciones para clínicas, Pymes y muro comunal

- Fecha: 2026-09-29.
- Archivos modificados: `src/api.ts`, `src/mock/db.ts`, `src/mock/server.ts`, `src/App.tsx`, `src/business.tsx`, `src/clinical.tsx`, `src/tutor.tsx`, `src/community.tsx`, `src/directory.tsx`, `src/adoption.tsx`, `src/admin.tsx`, `src/design-polish.css`, `AGENTS.md`.
- Cambio realizado:
  - Clínicas: buscador y filtros de pacientes (con alertas, con registro, acceso por vencer). Los registros se crean con `POST /mascotas/:id/registros` y quedan firmados por la clínica. La clínica puede editar o anular solo los suyos: anular no borra, deja el registro tachado con el motivo. Las vacunas admiten próxima dosis. Nueva vista «Perfil de la clínica». El tutor ve quién hizo cada registro, no puede editar los clínicos y el servidor rechaza con 403 cualquier intento de alterarlos o firmar como clínica.
  - Pymes: edición completa de ítems con categoría, marca «sin stock» y oferta con precio y fechas (debe ser menor al precio referencial), además de filtro por categoría. Nueva vista «Perfil del negocio» (descripción, servicios destacados, contacto, horario de lunes a domingo y coordenadas; nombre, RUT y rubro siguen bajo verificación). Métricas comparadas con los 30 días anteriores y contacto por canal. Renovación o cambio de plan con referencia de transferencia: el nuevo periodo empieza al terminar el vigente y el administrador lo confirma o rechaza desde «Pymes y suscripciones». El directorio muestra servicios, ofertas vigentes con precio tachado, el filtro «Con ofertas» y la marca de sin stock.
  - Muro comunal: nuevos tipos «Alerta de salud», «Evento o campaña» (con fecha obligatoria) y «Adopción» (solo ONG verificadas, desde «Mis animales» > «Difundir en el muro», con acceso a Adopciones). Los extravíos llevan la foto de la mascota elegida y un sector sin dirección exacta, y se marcan como encontrados. Lo urgente (extravíos activos y alertas de la última semana) aparece primero. El autor edita y elimina sus publicaciones y comentarios. Se pueden reportar comentarios, que se moderan igual que las publicaciones. Hay buscador, orden por recientes o más apoyadas y publicaciones guardadas.
  - Accesibilidad y diseño: los botones del menú tienen nombre accesible aun cuando solo se ve el ícono (≤800 px). El buscador del directorio usa un ícono Lucide en lugar de un carácter. Los modales altos se desplazan en vez de quedar cortados, y el encabezado del muro se adapta a 390 px.
  - Datos de demostración: la clave de `localStorage` pasa a `petsuite-mock-db-v2` porque el modelo cambió; los datos v1 se descartan. El seed agrega categorías, una oferta vigente, servicios por negocio y publicaciones de cada tipo nuevo.
- Motivo: completar las herramientas de trabajo de clínicas y Pymes, y hacer del muro un canal útil para extravíos y alertas, respetando la privacidad del tutor, la trazabilidad de la Ficha Única y la ausencia de pagos dentro de la app.
- Verificación ejecutada: `npx tsc -b` y `npm run build` con la base de Pages, correctos. Recorrido con Playwright (Chromium): 14 de 14 flujos correctos, sin errores de consola (los 9 anteriores más: registro clínico editado, anulado y bloqueado para el tutor; oferta, sin stock y perfil reflejados en el directorio; cambio de plan confirmado por el administrador; extravío con foto, sector, edición, comentarios, encontrada, guardadas y búsqueda; comentario reportado y ocultado; animal difundido por la ONG). Revisión visual en escritorio y a 390 px sin desplazamiento horizontal. `git diff --check` no se ejecutó porque `git` no está en el PATH de esta terminal.
## 2026-09-28

### Perfil Pyme y consultas desde el directorio

- Fecha: 2026-09-28.
- Archivos modificados o agregados: `src/App.tsx`, `src/Login.tsx`, `src/api.ts`, `src/business.tsx`, `src/business-profile.tsx`, `src/business-contacts.tsx`, `src/business.test.mjs`, `src/clinical.tsx`, `src/community.tsx`, `src/directory.tsx`, `src/design-polish.css`, `src/mock/db.ts`, `src/mock/server.ts`, `src/tutor.tsx`, `src/validators.ts`, `.env.example`, `Agents.md`.
- Cambio realizado: la Pyme puede editar nombre, comuna, dirección, teléfono, WhatsApp, horarios, descripción y coordenadas mediante un mapa, además de elegir una portada de las imágenes demo. La ficha pública del directorio usa los datos editados. El tutor puede enviar consultas desde el directorio y revisar respuestas en «Mis consultas»; la Pyme dispone de una bandeja para leerlas y responder. Los contactos se persisten por usuario y negocio en el mock y se migran los datos demo antiguos. El catálogo permite editar ítems y confirma su eliminación. Se integraron esquemas Zod para los nuevos formularios y otros formularios principales. `src/api.ts` acepta opcionalmente `VITE_API_URL` para usar un API HTTP compartido sin alterar las pantallas; sin configurarlo sigue usando el mock.
- Motivo: completar las pantallas Pyme P3, P5 y P8 y preparar la siguiente integración del QR entre dispositivos manteniendo la identidad visual vigente.
- Verificación ejecutada: `node --test src/business.test.mjs` (3 pruebas de permisos, perfil, consultas y migración), `npm run build`, `npm run build -- --base=/mockap-petsuite/` y `git diff --check` correctamente. No se verificó el flujo visual en navegador en esta sesión.

### API HTTP compartida para probar QR entre dispositivos

- Fecha: 2026-09-28.
- Archivos modificados o agregados: `backend/server.mjs`, `backend/server.test.mjs`, `backend/README.md`, `package.json`, `.gitignore`, `.env.example`, `Agents.md`.
- Cambio realizado: se añadió un servidor Node 24 para las rutas `/api/v1` del mock, con datos persistidos en un archivo compartido fuera de Git, escritura atómica, límite de tamaño del cuerpo, control de origen CORS y acceso de red a las cuentas demo solo cuando se habilita expresamente. El frontend puede usarlo con `VITE_API_URL`; QR, avisos y desactivación de medallas funcionan desde clientes HTTP distintos cuando ambos alcanzan el mismo servidor.
- Motivo: permitir pruebas del flujo crítico QR y contacto entre dispositivos sin modificar el diseño ni incrustar información médica en la URL, manteniendo explícito que esta API comparte credenciales demo y no constituye autenticación de producción.
- Verificación ejecutada: `node --test backend/server.test.mjs` (lectura anónima del QR, contacto, revocación, CORS y persistencia al reiniciar), `node --check backend/server.mjs`, `npm run build -- --base=/mockap-petsuite/` y `git diff --check` correctamente.

### Suspensión administrativa con revisión de denuncias

- Fecha: 2026-09-28.
- Archivos modificados o agregados: `src/admin.tsx`, `src/admin-suspension.tsx`, `src/admin-suspension.test.mjs`, `src/design-polish.css`, `src/mock/db.ts`, `src/mock/server.ts`, `src/validators.ts`, `Agents.md`.
- Cambio realizado: Suspender desde Usuarios u Ocultar y suspender desde Moderación abre una tarjeta compartida con los antecedentes de las denuncias de las publicaciones del usuario, incluidos contenido, motivo, denunciante, fecha y estado. El administrador puede elegir motivos rápidos, suspensión temporal de 1 a 3650 días o permanente, redactar un mensaje obligatorio y confirmar expresamente la medida. El mock guarda el tipo, razón, mensaje y vencimiento; revoca sesiones, reactiva las suspensiones temporales al vencer y permite reactivar manualmente las permanentes. Desde Moderación oculta y resuelve la publicación denunciada en la misma operación. «Ver denuncias» ofrece acceso independiente al historial desde Usuarios.
- Motivo: facilitar decisiones informadas y registradas, sin suspender directamente desde la lista ni perder el contexto de los reportes.
- Verificación ejecutada: `node --test src/admin-suspension.test.mjs src/business.test.mjs backend/server.test.mjs` (6 pruebas), `npm run build -- --base=/mockap-petsuite/` y `git diff --check` correctamente. Sin revisión visual en navegador en esta sesión.

## 2026-10-12

### Reparación del merge de benja-1 con main

- Fecha: 2026-10-12.
- Archivos modificados: `src/App.tsx`, `src/admin.tsx`, `src/api.ts`, `src/business.tsx`, `src/business-profile.tsx`, `src/clinical.tsx`, `src/community.tsx`, `src/design-polish.css`, `src/directory.tsx`, `src/mock/db.ts`, `src/mock/server.ts`, `src/tutor.tsx`, `src/validators.ts`, `src/business.test.mjs`, `src/admin-suspension.test.mjs`, `backend/server.mjs`.
- Cambio realizado: el merge `d91b94b` dejó el proyecto sin compilar (55 errores TS). Se rehízo desde `fc428b8` + `8ff8940`, conservando lo del 29 de septiembre (ofertas, categorías, autoría clínica, muro completo) y lo del 28 (contactos, portada y mapa del perfil, suspensión, API HTTP). Hay un solo perfil de negocio (`business-profile.tsx`), que ahora incluye servicios destacados. Las pruebas importan `STORAGE_KEY` en vez de fijar la clave, y `backend/server.mjs` acepta cualquier versión `petsuite-mock-db-vN` (antes ignoraba la v2 y no persistía).
- Motivo: el código heredado no compilaba ni persistía en el API HTTP.
- Verificación ejecutada: `npx tsc -b` sin errores y las 6 pruebas existentes correctas.

### Modelo de negocio: suscripciones, multitenant, asesor, CMS de ONG, publicidad, convenios, Orcob y Ley 21.719

- Fecha: 2026-10-12.
- Archivos agregados: `src/plans.ts`, `src/permissions.ts`, `src/plans-ui.tsx`, `src/team.tsx`, `src/promotions.tsx`, `src/ong-profile.tsx`, `src/advisor.tsx`, `src/privacy.tsx`, `src/design-suite.css`, `src/mock/suite.ts`, `src/mock/orcob.ts`, `src/business-rules.test.mjs`, `docs/modelo-de-negocio.md`.
- Archivos modificados: `src/App.tsx`, `src/Login.tsx`, `src/api.ts`, `src/business.tsx`, `src/business-profile.tsx`, `src/clinical.tsx`, `src/admin.tsx`, `src/adoption.tsx`, `src/directory.tsx`, `src/tutor.tsx`, `src/community.tsx`, `src/validators.ts`, `src/main.tsx`, `src/mock/db.ts`, `src/mock/server.ts`, `public/sw.js` (caché v5), `AGENTS.md`.
- Cambio realizado:
  - Planes Gratis ($0), Bronce ($10.000), Plata ($15.000) y Oro ($25.000) con límites de ítems, locales, equipo, ofertas, banners y convenios, más portada, perfil por sucursal, prioridad en el buscador, nivel de métricas y soporte. El mock aplica los límites con 422 e indica qué plan los permite. Hay comparativa en el alta, en Suscripción y en la página pública `#planes`, y medidores de uso en el Inicio de la Pyme. Tras el vencimiento hay 5 días de gracia y luego se baja a Gratis sin borrar datos.
  - Multitenant: sucursales por Pyme (pines en el mapa, búsqueda y perfil propio desde Plata) y equipo con roles internos (jefe de local y personal clínico) y permisos por módulo. Las credenciales temporales llegan por correo. Las veterinarias pasan a ser Pymes; el clínico es personal de la veterinaria y accede a las fichas por membresía.
  - Rol asesor: verifica Pymes y ONG, confirma pagos, crea cuentas con correo de bienvenida y aprueba banners, perfiles de ONG y convenios. Gestiona la cobranza.
  - Publicidad sin imágenes, con aprobación del asesor, en el inicio, el directorio y el muro, con impresiones y clics.
  - Convenios Pyme–ONG con código de cupón (la ONG acepta y el asesor aprueba), registro de canjes en caja, meta mensual (100 por defecto) con premio de alimentos y métricas de impacto para la ONG.
  - CMS de ONG: misión, necesidades, donaciones, voluntariado, emblema y color. Se publica solo tras la aprobación del asesor. Perfil público en `#ong/<id>` y listado en Adopciones.
  - Orcob (Organización de Cobranzas Orcob Ltda.): adaptador mock con código de recaudación, aviso de pago simulado y derivación de deudas con más de 30 días de mora, enviando solo datos mínimos de la empresa.
  - Ley 21.719: consentimientos separados y versionados en el registro, retiro inmediato de los opcionales, descarga JSON (acceso y portabilidad), solicitudes ARSOPOL con plazo de 30 días, panel de privacidad del administrador y anonimización al aceptar una supresión. Bandeja de correos simulada en Configuración.
  - Datos demo v3 (`petsuite-mock-db-v3`) con cuentas nuevas: veterinaria, peluquería morosa, jefe de local y asesor.
- Motivo: aplicar los cambios de la reunión de octubre: remarcar el modelo de suscripción, definir roles y reglas de negocio, empresas con varias sucursales, gestión por asesores y cumplimiento de la nueva ley de datos, manteniendo como núcleo la Ficha Única y el QR.
- Limitaciones declaradas: los límites por plan son una propuesta (el equipo solo fijó los precios). Orcob y el correo son simulados. Las claves temporales viajan en texto en el correo demo; en producción se usaría un enlace de activación de un solo uso. El cumplimiento de la Ley 21.719 debe validarlo una asesoría legal.
- Verificación ejecutada: `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto. `node --test src/admin-suspension.test.mjs src/business.test.mjs src/business-rules.test.mjs backend/server.test.mjs`: 13 de 13 pruebas (7 nuevas de reglas de negocio). Recorrido con Playwright (Chromium) por las 9 cuentas demo y todas sus vistas a 1366 px y 390 px, más `#planes`, `#adopciones` y `#ong/<id>`: sin errores de consola ni desplazamiento horizontal. `git diff --check` correcto.

## 2026-10-17

### Archivos ordenados en carpetas por módulo

- Fecha: 2026-10-17.
- Archivos movidos (con `git mv`, sin cambios de contenido salvo las rutas de importación):
  - `src/shared/`: `api.ts`, `validators.ts`, `permissions.ts`, `media.tsx`.
  - `src/styles/`: `styles.css`, `design.css`, `design-pages.css`, `design-polish.css`, `design-suite.css`.
  - `src/modules/auth/`: `Login.tsx`.
  - `src/modules/tutor/`: `tutor.tsx`.
  - `src/modules/community/`: `community.tsx`.
  - `src/modules/directory/`: `directory.tsx`.
  - `src/modules/business/`: `business.tsx`, `business-profile.tsx`, `business-contacts.tsx`, `team.tsx`, `business.test.mjs`, `business-rules.test.mjs`.
  - `src/modules/plans/`: `plans.ts`, `plans-ui.tsx`.
  - `src/modules/promotions/`: `promotions.tsx`.
  - `src/modules/clinical/`: `clinical.tsx`.
  - `src/modules/ong/`: `adoption.tsx`, `ong-profile.tsx`.
  - `src/modules/advisor/`: `advisor.tsx`.
  - `src/modules/admin/`: `admin.tsx`, `admin-suspension.tsx`, `admin-suspension.test.mjs`.
  - `src/modules/privacy/`: `privacy.tsx`.
  - Sin mover: `src/main.tsx`, `src/App.tsx` y `src/mock/*`.
- Archivos modificados: importaciones de todos los anteriores, `src/main.tsx`, `src/App.tsx`, `src/mock/db.ts`, `src/mock/server.ts`, `src/mock/suite.ts`, `backend/server.mjs`; rutas citadas en `docs/modelo-de-negocio.md`; `AGENTS.md`.
- Cambio realizado: el código de `src/` deja de estar en una sola carpeta y se agrupa en núcleo compartido, estilos, mock y un módulo por área funcional. No cambia el comportamiento.
- Motivo: facilitar la navegación del proyecto y ubicar cada funcionalidad por módulo.
- Verificación ejecutada: `tsc -b` sin errores, `node --test src/modules/admin/admin-suspension.test.mjs src/modules/business/business.test.mjs src/modules/business/business-rules.test.mjs backend/server.test.mjs` (13 de 13) y `vite build --base=/mockap-petsuite/` correcto. Sin revisión visual en navegador en esta sesión.

### Base de datos PostgreSQL: paso 1, esquema y migraciones

- Fecha: 2026-10-17.
- Archivos agregados: `backend/db/migrations/001_esquema_inicial.sql`, `backend/db/migrations/002_datos_referencia.sql`, `backend/db/migrate.mjs`, `backend/db/pool.mjs`, `backend/db/README.md`.
- Archivos modificados: `package.json` y `package-lock.json` (dependencia `pg` y script `db:migrate`), `.env.example` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`), `AGENTS.md`.
- Cambio realizado:
  - Esquema PostgreSQL de 35 tablas que traduce el modelo de `src/mock/db.ts`, con claves foráneas, restricciones CHECK e índices para el directorio, el muro y la moderación. La Ficha Única va en JSONB.
  - Datos de referencia (comunas y planes).
  - Ejecutor de migraciones con transacción por archivo, checksum y bloqueo contra ejecuciones simultáneas.
  - El API y el frontend todavía usan el mock: la conexión de las rutas a la base es un paso posterior.
- Motivo: comenzar la base de datos real que reemplazará al mock, como paso previo al despliegue en Vercel, conservando la Ficha Única y el QR como núcleo.
- Verificación ejecutada: migraciones aplicadas en PGlite (Postgres en WebAssembly, instalado fuera del proyecto). La segunda ejecución no aplica nada. Se rechazan 11 casos inválidos: correo repetido, rol desconocido, dos medallas activas, oferta mayor o incompleta, permiso desconocido, plan inexistente, evento sin fecha, reporte sin objeto, mes inválido y suspensión sin días. El borrado de una mascota elimina sus medallas y desvincula sus publicaciones.

### Base de datos en Supabase: RLS y datos de demostración (paso 2)

- Fecha: 2026-10-17.
- Archivos agregados: `backend/db/migrations/003_rls_supabase.sql`, `backend/db/seed.mjs`.
- Archivos modificados: `backend/db/migrate.mjs` (aviso de tablas sin RLS), `backend/db/pool.mjs`, `backend/db/README.md`, `.env.example`, `package.json` y `package-lock.json` (dependencia `bcryptjs` y script `db:seed`), `AGENTS.md`.
- Cambio realizado:
  - La base se aloja en Supabase (proyecto `pet-suite-dat`, plan gratuito), creado desde el Marketplace de Vercel en vez de Neon. Se aplicaron las migraciones 001 a 003 desde `.env` local, que no se sube a Git.
  - La migración 003 activa RLS sin políticas en todas las tablas: cierra la API REST pública de Supabase, mientras el backend sigue accediendo como dueño de las tablas. `db:migrate` avisa si alguna tabla queda sin RLS.
  - `npm run db:seed` carga en la base el mismo seed del mock (`src/mock/db.ts`), con claves bcrypt. Consentimientos, ofertas, premios, banners y reportes se traducen a sus columnas y tablas. Se niega a cargar sobre una base con usuarios salvo con `--reset`, que vacía todo menos comunas, planes y migraciones.
  - Las conexiones usan `sslmode=no-verify` porque Supabase firma su certificado con una CA propia. Queda pendiente verificar ese certificado en el paso del API.
- Motivo: tener en la base real las mismas cuentas y datos de la demostración, sin exponer la base por la API pública de Supabase.
- Verificación ejecutada:
  - En PGlite: las 3 migraciones, sin tablas sin RLS; el seed, el rechazo de la recarga sin `--reset` y la recarga con `--reset` con los mismos conteos; además, la clave bcrypt, la ficha de Luna con su medalla activa, la oferta, el banner de la ONG, el premio y los consentimientos.
  - En Supabase (PostgreSQL 17.11): migración 003 aplicada y 0 tablas sin RLS. Seed con 11 usuarios, 44 consentimientos, 3 Pymes, 6 animales, 5 publicaciones, 162 canjes y demás colecciones. Las 11 cuentas validan `petsuite123` contra su hash. La API REST con la clave pública devuelve 0 filas en `comunas`, `planes` y `usuarios`.

### API sobre PostgreSQL con el mismo contrato que el mock (paso 3)

- Fecha: 2026-10-17.
- Archivos agregados:
  - Rutas: `backend/api/index.ts`, `core.ts`, `db.ts`, `auth.ts`, `negocio.ts`, `cuentas.ts`, `ficha.ts`, `pymes.ts`, `muro.ts`, `adopcion.ts`, `admin.ts`, `equipo.ts`, `promocion.ts`, `asesoria.ts`, `privacidad.ts`.
  - Pruebas: `backend/api/pglite.ts`, `backend/api/paridad.test.mjs`, `backend/api/servidor.test.mjs`.
  - Otros: `tsconfig.backend.json`, `src/shared/errors.ts`, `src/shared/legal.ts`.
- Archivos modificados:
  - Backend: `backend/server.mjs`, `backend/server.test.mjs`, `backend/db/seed.mjs`.
  - Mock: `src/mock/db.ts`, `src/mock/server.ts`, `src/mock/suite.ts`.
  - Otros: `src/shared/api.ts`, `tsconfig.json`, `package.json` y `package-lock.json` (`@types/pg` y `@electric-sql/pglite` como dependencias de desarrollo; scripts `test` y `api:start`), `backend/README.md`, `AGENTS.md`.
- Cambio realizado:
  - Las ~115 rutas del mock se reescribieron sobre PostgreSQL en `backend/api/`, por módulos: cuentas, Ficha Única y QR, Pymes, muro, adopción y ONG, administración, sucursales y equipo, publicidad y convenios, asesoría y cobranza, y privacidad.
  - Cada solicitud corre en una transacción. Las sesiones se guardan como SHA-256 del token con 30 días de vigencia, y las claves se verifican con bcrypt (también cuando el correo no existe, para no revelar qué cuentas hay).
  - Las validaciones Zod, los planes y los permisos se reutilizan desde `src/`. Las respuestas tienen la misma forma que en el mock, así el frontend solo cambia `VITE_API_URL`.
  - `backend/server.mjs` usa PostgreSQL cuando hay `DATABASE_URL` y el mock con archivo cuando no. `npm run api:start` lee `.env`.
  - `tsc -b` revisa también el backend (`tsconfig.backend.json`).
  - Ajustes en el mock para que mock y base coincidan:
    - `now()` es estrictamente creciente y el seed usa horas consecutivas, para que el orden de los empates sea el mismo en ambos.
    - El alta de Pymes y los banners validan que la comuna exista (antes el mock aceptaba una inexistente).
    - `ApiError` y `VERSION_PRIVACIDAD` pasan a módulos compartidos.
- Motivo: que los datos se lean y escriban en la base real manteniendo el contrato del API, como paso previo al despliegue en Vercel.
- Verificación ejecutada:
  - `tsc -b` sin errores y `vite build --base=/mockap-petsuite/` correcto.
  - `npm test`: 21 de 21 pruebas. Son las 13 anteriores más:
    - 6 guiones de paridad, en los que mock y PGlite responden igual en código HTTP y contenido (casos válidos y rechazos 400, 401, 403, 404, 409 y 422);
    - una prueba de cobertura que confirma que cada ruta tiene guion;
    - el servidor HTTP con PostgreSQL: QR entre clientes, CORS, sesión persistente tras reiniciar y token nunca guardado en claro.
  - Contra Supabase:
    - inicio de sesión de las 11 cuentas demo y 25 vistas de todos los roles;
    - flujo del QR completo (aviso, reemplazo de medalla e invalidación del token anterior);
    - el QR público tarda unos 320 ms desde Chile.
  - Luego `npm run db:seed -- --reset` dejó la demo limpia.
  - `git diff --check` correcto.
- Limitaciones declaradas:
  - Los integrantes del equipo no tienen acceso a la cuenta de Vercel de la base. `backend/db/README.md` indica que deben pedir las líneas de conexión por privado y explica que la base es compartida. Quienes tengan acceso al panel de Supabase como Developer pueden ver y consultar las tablas, pero igual necesitan esas líneas, porque el panel no muestra la contraseña. No deben cambiar la estructura desde el panel ni la contraseña de la base.
  - El frontend publicado en GitHub Pages sigue usando el mock hasta desplegar el API y configurar `VITE_API_URL`.
  - La conexión usa `sslmode=no-verify` hasta incorporar el certificado de Supabase.
  - El plan gratuito de Supabase se pausa tras una semana sin uso.

## 2026-10-19

### FE-01 · Ficha pública de emergencia

- Fecha: 2026-10-19.
- Archivos modificados o agregados: `src/tutor.tsx`, `src/design-pages.css`, `docs/capturas/fe-01/README.md` y sus capturas, `AGENTS.md`.
- Cambio realizado: la ficha pública prioriza foto, nombre, alertas, alergias y condiciones antes del formulario; conserva visible un botón de contacto que lleva al campo del mensaje sin romper la ruta QR. Se separaron carga, medalla inválida, medalla desactivada (cuando el API responda 410), error de red con reintento y aviso enviado; se ajustaron áreas táctiles, asociación de errores, reflujo al ampliar y privacidad de la presentación.
- Motivo: permitir a quien encuentra una mascota consultar inmediatamente la información crítica y avisar al tutor desde cualquier tamaño de pantalla, sin exponer datos privados.
- Dependencia para la próxima semana: el contrato actual devuelve 404 tanto para tokens inexistentes como desactivados. Para mostrar el estado distinguible de medalla desactivada hace falta 410 en el mock y el API real; hoy 404 muestra «no existe o ya no está activo». No se modificaron `src/mock/` ni `backend/`.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13) y `git diff --check`, correctos. Revisión con Chromium y respuestas simuladas en navegador para los seis estados en 390 y 1366 px, claro y oscuro; sin errores de consola ni desbordamiento horizontal, contraste de textos críticos ≥4,5:1 y reflujo a 195 px (espacio disponible al 200 % de zoom en 390 px). Capturas en `docs/capturas/fe-01/`.

### FE-02 · Descarga e impresión del QR

- Fecha: 2026-10-19.
- Archivos modificados o agregados: `src/tutor.tsx`, `src/styles.css`, `docs/capturas/fe-02/README.md` y capturas/PDF, `AGENTS.md`.
- Cambio realizado: el PNG se genera a 1200 × 1200 píxeles y se descarga con un nombre seguro derivado del nombre de la mascota. La impresión se separa en una vista exclusiva de una medalla de 60 × 70 mm sobre A4; muestra solo nombre, QR de 46 mm y texto «Escanéame si me encuentras», en blanco y negro.
- Motivo: ofrecer un archivo legible y una impresión a tamaño medalla sin incluir la interfaz del tutor ni datos médicos o privados en el papel.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` y `git diff --check`. Chromium: descarga PNG, hoja A4 y revisión visual a 390 y 1366 px en claro y oscuro; capturas y PDF en `docs/capturas/fe-02/`. El escaneo físico con dos teléfonos requiere validación manual; un QR del mock local no se comparte entre navegadores sin API compartida.

### FE-03 · Primer uso del tutor

- Fecha: 2026-10-19.
- Archivos modificados o agregados: `src/tutor.tsx`, `src/design-pages.css`, `docs/capturas/fe-03/README.md` y capturas, `AGENTS.md`.
- Cambio realizado: Inicio de una cuenta sin mascotas guía en tres pasos (registro, datos críticos y QR); cada mascota muestra un porcentaje calculado con identidad, alergias, condiciones y medalla activa, y sus tarjetas incluyen un botón que abre directamente el siguiente campo pendiente. Tras crear una mascota se abre su ficha y se puede llegar al QR sin ayuda externa.
- Motivo: dar una ruta clara hacia la ficha pública de emergencia sin agregar datos ni rutas al API.
- Dependencia futura: los arreglos vacíos de alergias y condiciones no distinguen «sin revisar» de «ninguna conocida». Una marca de revisión explícita necesitaría actualizar el mock y el API real en conjunto.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` y `git diff --check`. Recorrido con Chromium de cuenta nueva a medalla QR y tarjeta demo que abre el campo pendiente, a 390 y 1366 px en modo claro y oscuro; capturas en `docs/capturas/fe-03/`.

### FE-04 · Estados compartidos en vistas por rol

- Fecha: 2026-10-19.
- Archivos modificados o agregados: `src/feedback.tsx`, `src/feedback.css`, `src/main.tsx`, `src/media.tsx`, `src/tutor.tsx`, `src/directory.tsx`, `src/community.tsx`, `src/adoption.tsx`, `src/business.tsx`, `src/business-profile.tsx`, `src/business-contacts.tsx`, `src/clinical.tsx`, `src/team.tsx`, `src/promotions.tsx`, `src/ong-profile.tsx`, `src/admin.tsx`, `src/advisor.tsx`, `src/privacy.tsx`, `docs/capturas/fe-04/README.md` y capturas, `AGENTS.md`.
- Cambio realizado: componentes compartidos para esqueleto, estado vacío con acción contextual, error con reintento y permiso insuficiente. Se aplicaron a tutor, directorio y muro; Pyme, clínica y sus módulos; ONG, adopciones públicas, asesor y administración. Se evitó mostrar listas vacías o métricas en cero mientras cargan; se desactivaron animaciones del mapa que emitían errores al salir del directorio durante una transición.
- Motivo: distinguir falta de datos de fallas de conexión y dar una acción clara para recuperarse en cada rol.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs`, `git diff --check`. Chromium a 390 y 1366 px, claro y oscuro: estados vacíos, carga, recuperación de error HTTP simulado y permiso clínico insuficiente; sin errores de consola ni desbordamiento horizontal. Capturas en `docs/capturas/fe-04/`. La ficha pública QR corresponde a FE-01 y está en la misma rama consolidada.

### FE-05 · Revisión responsive y de paletas de las vistas de octubre

- Fecha: 2026-10-19.
- Archivos modificados o agregados: `src/design-suite.css`, `docs/capturas/fe-05/README.md` y 102 capturas, `AGENTS.md`.
- Cambio realizado: se revisaron las 17 vistas de planes, sucursales, equipo, promociones, convenios, perfil de ONG, asesor, privacidad y correos. Se corrigió el contraste de etiquetas de estado en oscuro, el reflujo de las tablas administrativas, los banners de aprobaciones en móvil y el encabezado público de planes.
- Motivo: evitar texto ilegible y composición comprimida en las vistas nuevas, conservando los temas y el modo oscuro.
- Verificación ejecutada: revisión con Chromium a 390 y 1366 px en claro y oscuro (Original), y a 768 y 1024 px en oscuro (Original, Océano y Lavanda); sin desbordamiento horizontal ni errores de JavaScript. Etiquetas de estado renderizadas verificadas con contraste ≥4,5:1. Capturas y lista de vistas en `docs/capturas/fe-05/README.md`. `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` y `git diff --check` ejecutados correctamente.

### Consolidación FE-01 a FE-05 en una rama

- Fecha: 2026-10-19.
- Archivos modificados: `src/tutor.tsx`, `Agents.md`, `docs/capturas/fe-04/README.md`.
- Cambio realizado: se integraron en `fe-01-a-fe-05-frontend` los cinco cambios de frontend sobre `main`. Se conservaron conjuntamente la guía y las acciones de primer uso, la ficha pública, la impresión QR y los estados de recuperación; la bitácora reúne sus cinco entradas.
- Motivo: preparar una sola rama para revisión e integración sin perder funcionalidades ni capturas de las tareas.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13), `git diff --check main...HEAD` y recorrido integrado con Chromium a 390 px claro y 1366 px oscuro (tutor, salud, PNG, impresión, QR público, contacto, estados vacíos y salida del mapa), además de registro de cuenta nueva hasta medalla QR y panel de privacidad a 768 px oscuro/Océano. Sin errores de JavaScript ni desplazamiento horizontal.

## 2026-10-20

### Desplazamiento dentro de la ficha del directorio

- Fecha: 2026-10-20.
- Archivos modificados: `src/directory.tsx`, `src/design-polish.css`, `Agents.md`.
- Cambio realizado: se quitó la X de la ficha de negocio del directorio; la tarjeta ahora contiene su propio desplazamiento y el fondo queda fijo. Se conserva «Seguir explorando», Escape y el clic fuera de la tarjeta para cerrarla.
- Motivo: evitar la barra de desplazamiento externa y el control superpuesto a la portada al abrir un negocio desde la lista o el mapa.
- Verificación ejecutada: Chromium a 628 × 470 en claro, 390 × 844 en oscuro y 1366 × 768 en claro: desplazamiento interno de la tarjeta, fondo fijo, cierre con Escape y botón, sin errores de JavaScript. `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13) y `git diff --check` correctos.

## 2026-10-21

### Un solo botón de aviso en la ficha pública

- Fecha: 2026-10-21.
- Archivos modificados: `src/tutor.tsx`, `src/design-pages.css`, `Agents.md`.
- Cambio realizado: se eliminó el botón fijo «Contactar al tutor» y el espacio reservado para su barra; «Avisar al tutor» permanece como única acción para enviar el formulario.
- Motivo: evitar dos botones de contacto simultáneos al llegar al final de la ficha pública.
- Verificación ejecutada: `npm run build -- --base=/mockap-petsuite/` y `git diff --check` correctos. Chromium a 390 y 1366 px, en claro y oscuro: un solo botón de aviso, envío correcto, sin errores de JavaScript ni desbordamiento horizontal.

## 2026-10-23

### Scroll integrado en la ficha del directorio

- Fecha: 2026-10-23.
- Archivos modificados: `src/directory.tsx`, `src/design-polish.css`, `AGENTS.md`.
- Cambio realizado: se separó el marco visual de la ficha de negocio de su contenido desplazable mediante un contenedor interno; el fondo y el marco mantienen el overflow oculto, y el desplazamiento queda únicamente dentro de la tarjeta, incluyendo el comportamiento en viewport móvil.
- Motivo: evitar que la barra de desplazamiento de la ficha parezca externa o se superponga al fondo al seleccionar una ubicación.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13) y `git diff --check` correctamente.

### Corrección de color en la navegación lateral

- Fecha: 2026-10-23.
- Archivos modificados: `src/styles.css`, `AGENTS.md`.
- Cambio realizado: se reemplazó el texto rosado heredado de la barra lateral por texto blanco; el elemento activo conserva texto oscuro sobre su fondo seleccionado y su icono usa el color cálido amarillo/naranja de la marca. También se aclaró el texto secundario del perfil.
- Motivo: recuperar la jerarquía visual original de la navegación y evitar que los temas tiñan las etiquetas de rojo o rosado sin intención.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/` y `git diff --check` correctamente.

### FE-10 · Próximas vacunas en el Inicio del tutor

- Fecha: 2026-10-23.
- Archivos modificados: `src/tutor.tsx`, `src/design-polish.css`, `AGENTS.md`.
- Cambio realizado: se agregó al Inicio del tutor el bloque «Próximas vacunas», derivado de las dosis registradas en las Fichas Únicas. Muestra mascota, vacuna, fecha y días restantes; ordena primero las vencidas, limita las próximas a 30 días, ofrece estado vacío y abre la ficha de la mascota al seleccionar una fila.
- Motivo: hacer visibles las próximas dosis sin obligar al tutor a revisar individualmente el historial médico.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13) y `git diff --check` correctamente.

## 2026-10-24

### FE-11 · Cartel de mascota perdida

- Fecha: 2026-10-24.
- Archivos modificados: `src/community.tsx`, `src/design-polish.css`, `src/styles.css`, `AGENTS.md`.
- Cambio realizado: las publicaciones propias de extravío incluyen «Generar cartel». El cartel A4 vertical presenta «SE BUSCA», foto, nombre, sector, fecha y señas; incorpora el QR opaco de la medalla activa para abrir la ficha pública. Si la medalla está desactivada, se muestra «Activa la medalla para incluir el QR». La impresión no contiene teléfono, correo ni dirección del tutor. La relación entre publicación y mascota elegida se conserva en el frontend, sin cambiar el API.
- Motivo: permitir difundir una búsqueda en papel con la información necesaria y una vía segura para contactar al tutor mediante la Ficha Única.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/*.test.mjs backend/*.test.mjs` (13/13) y `git diff --check` correctamente. No se ejecutó revisión visual en navegador en esa sesión.

### FE-12 · «Abierto ahora» y «Cómo llegar» en el directorio

- Fecha: 2026-10-24.
- Archivos modificados o agregados: `src/directory.tsx`, `src/directory-hours.ts`, `src/directory-hours.test.mjs`, `src/design-polish.css`, `AGENTS.md`.
- Cambio realizado: se calcula el estado de apertura con la hora local de Chile usando el horario semanal del negocio y sus sucursales. Se agregó el filtro «Abierto ahora» sobre resultados cargados, el estado en resultados y fichas, y enlaces a Google Maps para la casa matriz y sucursales con coordenadas válidas.
- Motivo: permitir identificar negocios abiertos en la hora local de Chile y abrir rutas hasta la casa matriz o una sucursal georreferenciada.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `node --test src/directory-hours.test.mjs` (6/6), `node --test src/*.test.mjs backend/*.test.mjs` (19/19) y `git diff --check` correctamente.

## 2026-10-26

### Integración de la base de datos y de FE-01 a FE-12 en `main`

- Fecha: 2026-10-26.
- Archivos modificados o agregados:
  - Desde `benja-base-datos`: `backend/api/`, `backend/db/`, `src/shared/`, `src/styles/`, `src/modules/`, `src/mock/*`, `backend/server.mjs`, `backend/server.test.mjs`, `backend/README.md`, `tsconfig.json`, `tsconfig.backend.json`, `package.json`, `package-lock.json`, `.env.example` y `docs/modelo-de-negocio.md`.
  - Importaciones resueltas: `src/main.tsx` y los 16 módulos con conflicto.
  - Movidos con `git mv`: `src/feedback.tsx` y `src/accessibility.ts` a `src/shared/`; `src/feedback.css` y `src/accessibility.css` a `src/styles/`; `src/directory-hours.ts` y `src/directory-hours.test.mjs` a `src/modules/directory/`.
  - También: `package.json` (script `test`), `backend/db/README.md` y `Agents.md`.
- Cambio realizado:
  - La rama `benja-base-datos` (base PostgreSQL, API con paridad y carpetas por módulo, del 17 de octubre) no estaba en `main`, y FE-01 a FE-12 se hicieron sobre la estructura anterior. Se unieron ambas líneas en `main`.
  - Los conflictos eran solo de importaciones: se conservaron los componentes de `main` con las rutas nuevas. Los archivos nuevos de esta semana se ubicaron en la estructura por módulos y `npm test` incluye la prueba de horarios.
  - Se incorporaron las instrucciones de acceso a la base para el equipo, que habían quedado sin commit en un stash de GitHub Desktop.
  - La bitácora quedó en orden cronológico y sin la entrada duplicada de FE-11.
  - El commit `56193cb` («avances del F-06») agregó `useModalFocus` y `accessibility.css` sin entrada propia; ahora están en `src/shared/accessibility.ts` y `src/styles/accessibility.css`.
- Motivo: dejar en `main` la última versión de todo el proyecto sin perder trabajo de ninguna rama.
- Verificación ejecutada:
  - Los 32 archivos movidos son idénticos a su versión en `main`, salvo las importaciones. Las ramas `fe-01` a `fe-05` no tienen líneas que falten en `main`, salvo las que se reescribieron después al consolidar.
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 27 de 27 (las 21 de la base de datos y la paridad, más las 6 de horarios).
  - Recorrido con Chromium sobre la build de Pages: las 9 cuentas demo y sus 72 vistas a 1366 px, las 6 del tutor a 390 px y la ficha pública del QR. Sin errores de JavaScript ni desbordamiento horizontal.
  - `git diff --check` correcto.
  - Las rutas citadas en entradas anteriores (`src/tutor.tsx`, `src/*.test.mjs`) corresponden a la estructura previa.

### Medalla desactivada, botón «Compartir» y cartel sin `sessionStorage`

- Fecha: 2026-10-26.
- Rama: `mejoras-qr-y-compartir`, creada a pedido del usuario.
- Archivos agregados: `src/shared/share.tsx`.
- Archivos modificados:
  - Mock y API: `src/mock/server.ts`, `backend/api/ficha.ts` y `backend/api/muro.ts`.
  - Pruebas: `backend/server.test.mjs`, `backend/api/servidor.test.mjs` y `backend/api/paridad.test.mjs`.
  - Interfaz: `src/modules/tutor/tutor.tsx`, `src/modules/community/community.tsx`, `src/modules/ong/adoption.tsx`, `src/modules/ong/ong-profile.tsx`, `src/modules/plans/plans-ui.tsx` y `src/styles/design-suite.css`.
  - Bitácora: `Agents.md`.
- Cambio realizado:
  - QR: una medalla reemplazada o desactivada responde 410 «Medalla desactivada», tanto en el mock como en el API con PostgreSQL. Un token inexistente sigue respondiendo 404.
  - La ficha pública explica que el tutor reemplazó o desactivó la medalla y orienta a quien encontró la mascota: llevarla a una veterinaria para revisar si tiene microchip o avisar en el muro. Así se cierra la dependencia que dejó FE-01.
  - FE-13: nuevo botón reutilizable `ShareButton`. En el teléfono abre el menú del sistema para compartir; en escritorio copia el enlace y muestra «Enlace copiado».
    - Está en `#adopciones` (también dentro de la app), `#ong/<id>` y `#planes`.
    - En el cartel de extravío comparte el enlace de la ficha pública de la medalla.
    - Los enlaces se arman con `import.meta.env.BASE_URL`.
  - Cartel (FE-11): el muro devuelve `mascota_id` solo al autor y solo mientras la mascota siga siendo suya. El cartel ya no guarda la relación en `sessionStorage` ni deduce la mascota por nombre y foto, lo que podía elegir otra si la mascota había sido traspasada.
  - Corrección: en la página pública de adopciones, «Ingresar a PetSuite» apuntaba a `/`, que en GitHub Pages lleva fuera de `/mockap-petsuite/`.
- Motivo: completar los pendientes de FE-01, FE-11 y FE-13 alrededor del QR de emergencia, sin exponer ids internos a otros vecinos.
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 27 de 27. La paridad compara el aviso enviado a una medalla reemplazada y comprueba que el autor recibe `mascota_id` y otro vecino, `null`.
  - Recorrido con Chromium sobre la build de Pages:
    - Extravío publicado con Luna; el cartel elige su mascota y su QR sin selector, y copia el enlace con la base de Pages.
    - Medalla desactivada y token inexistente muestran mensajes distintos.
    - «Compartir» en las tres páginas públicas, a 1366 px (copia el enlace) y a 390 px (menú del teléfono).
    - Recorrido general por las 9 cuentas demo.
    - Sin errores de JavaScript ni desplazamiento horizontal.
  - `git diff --check` correcto.

### Reglas de trabajo para evitar errores repetidos

- Fecha: 2026-10-26.
- Archivos modificados: `Agents.md`.
- Cambio realizado: la sección «Regla de trabajo» se reorganizó en ramas y sincronización, estructura del código, API (mock y base de datos), frontend, verificación y bitácora. Cada regla viene de un error ya ocurrido:
  - una rama sin fusionar durante una semana;
  - un stash olvidado;
  - scripts personales subidos al repositorio;
  - un enlace a `/` que fallaba en GitHub Pages;
  - una prueba que no estaba en `npm test`;
  - una entrada duplicada en la bitácora.
  - La regla «nunca crear otra rama» pasa a «solo si el usuario lo pide, y se fusiona antes de la siguiente tarea», porque el usuario pidió la rama `mejoras-qr-y-compartir`.
- Motivo: que cualquier persona o agente del equipo evite repetir estos errores.
- Verificación ejecutada: revisión del texto y `git diff --check` correcto. No cambia código.

### Cuentas reales: confirmación de correo, recuperación de contraseña e invitaciones

- Fecha: 2026-10-26.
- Rama: `usuarios-reales`, creada sobre `mejoras-qr-y-compartir` a pedido del usuario.
- Archivos agregados: `src/shared/cuentas.ts`, `src/modules/auth/AccountLinks.tsx`, `backend/db/migrations/004_cuentas_reales.sql`, `backend/db/crear-admin.mjs` y `backend/api/cuentas.test.mjs`.
- Archivos modificados:
  - Mock: `src/mock/db.ts`, `src/mock/server.ts` y `src/mock/suite.ts`.
  - API: `backend/api/auth.ts`, `backend/api/cuentas.ts`, `backend/api/equipo.ts`, `backend/api/asesoria.ts`, `backend/api/privacidad.ts` y `backend/db/seed.mjs`.
  - Pruebas: `backend/api/paridad.test.mjs` y `src/modules/business/business-rules.test.mjs`.
  - Frontend: `src/App.tsx`, `src/modules/auth/Login.tsx`, `src/shared/api.ts`, `src/shared/validators.ts`, `src/modules/advisor/advisor.tsx`, `src/modules/business/team.tsx` y `src/styles/design-suite.css`.
  - Otros: `package.json`, `.env.example`, `backend/README.md` y `Agents.md`.
- Cambio realizado:
  - El registro deja la cuenta pendiente y envía un enlace de confirmación que vence en 24 horas. Sin confirmar no se puede ingresar: con la clave correcta, el ingreso responde 403 y la pantalla ofrece reenviar el enlace. El enlace confirma el correo e inicia la sesión.
  - «¿Olvidaste tu contraseña?» envía un enlace que vence en 1 hora. La contraseña nueva cierra todas las sesiones y también confirma el correo.
  - Las cuentas creadas por una Pyme (equipo) o por el asesor reciben una invitación para crear su contraseña, que vence en 7 días, en lugar de una clave temporal en texto.
  - Reenviar y recuperar responden lo mismo exista o no la cuenta, y envían como máximo un correo por minuto a cada cuenta. Cada enlace sirve una vez y emitir uno nuevo anula el anterior.
  - Correo real con Resend (`RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`): la bandeja guarda una copia sin el enlace, y si el envío falla, la solicitud responde 502 y se deshace.
  - Migración 004: columna `correo_verificado_en`, en la que las cuentas existentes quedan confirmadas; tabla `tokens_cuenta` con RLS y nuevos tipos de correo.
  - Mock: los datos de demostración pasan a `petsuite-mock-db-v4`, así que se descarta lo guardado en la v3. Las cuentas demo nacen confirmadas.
  - `npm run db:crear-admin -- correo nombre` crea el primer administrador en una base sin datos demo e imprime su invitación.
  - La descarga de datos personales incluye la fecha de confirmación del correo.
  - Sin `VITE_API_URL` (demo) siguen las cuentas de prueba, y un aviso permite abrir el enlace del correo simulado. Con `VITE_API_URL` (versión real) desaparecen las cuentas de prueba y «Datos de demostración».
- Motivo: el usuario indicó que PetSuite deja de ser una prueba y que cada cuenta debe validarse confirmando su correo, sin cuentas de prueba en la versión real.
- Pendiente para la versión real:
  - Desplegar el API y crear la base nueva en Supabase.
  - Configurar Resend con un dominio propio.
  - Verificar el certificado TLS de Supabase y evitar la pausa del plan gratuito.
  - Limitar los intentos de inicio de sesión.
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 29 de 29.
    - La paridad recorre registro, ingreso sin confirmar, reenvío, enlace inválido, reutilizado y válido, recuperación, contraseña nueva con cierre de sesiones e invitación de equipo.
    - La prueba de cobertura incluye las 4 rutas nuevas.
    - Se agregaron 2 pruebas: Resend simulado (copia sin enlace y 502 que deshace el registro) y primer administrador.
  - Recorrido con Chromium:
    - Demo a 1366 px y 390 px: registro, pendiente, reenvío y confirmación; recuperación con contraseñas que no coinciden, contraseña nueva, clave anterior rechazada e ingreso; enlace inválido.
    - Build con `VITE_API_URL` contra `backend/server.mjs`: sin cuentas de prueba, sin atajo al correo simulado, enlace a `APP_URL` y Configuración sin «Datos de demostración».
    - Recorrido general por las 9 cuentas demo, sin errores de JavaScript ni desplazamiento horizontal.
  - `git diff --check` correcto.

### Ramas fusionadas en `main` y scripts personales eliminados

- Fecha: 2026-10-26.
- Archivos eliminados: `fe06-audit-local.mjs` y `fe06-keyboard-local.mjs`.
- Archivos modificados: `Agents.md`.
- Cambio realizado:
  - `mejoras-qr-y-compartir` y `usuarios-reales` se fusionaron en `main`, en ese orden y sin conflictos, porque `main` ya era ancestro de ambas. Con eso se cumple la regla de fusionar una rama antes de la tarea siguiente.
  - Se quitaron de la raíz los dos scripts de auditoría del commit `56193cb` («avances del F-06»). Usaban rutas del computador de un integrante (`C:/Users/arman/...`) y no corrían en otro equipo. Siguen disponibles en el historial de Git.
- Motivo: dejar `main` con la última versión del proyecto y sin archivos personales, como piden las reglas de trabajo.
- Pendiente: borrar en GitHub (pestaña **Branches**) las ramas ya incluidas en `main`: `aaaaa`, `benja-1`, `benja-2`, `benja-base-datos`, `fe-01-a-fe-05-frontend`, las cinco `fe-0x` individuales, `mejoras-qr-y-compartir` y `usuarios-reales`. Desde esta terminal no hay credenciales para hacerlo.
- Verificación ejecutada: `npx tsc -b`, `npm run build -- --base=/mockap-petsuite/`, `npm test` y `git diff --check`.

### Formato obligatorio de ramas por usuario

- Fecha: 2026-10-26.
- Archivos modificados: `AGENTS.md`.
- Cambio realizado: cada tarea debe usar una rama creada desde `origin/main`, nombrada `<nombredeusuario>/<cambio-branch>`, donde `cambio-branch` es el texto descriptivo completo. Esta convención aplica a todos los usuarios del equipo. Por solicitud expresa del usuario, esta actualización de las instrucciones se hizo directamente en `main`.
- Motivo: identificar claramente quién trabaja en cada rama y qué cambio contiene, manteniendo una rama separada por tarea.
- Verificación ejecutada: revisión del texto y `git diff --check`.

## 2026-10-27

### Rediseño profesional de todos los módulos

- Fecha: 2026-10-27.
- Rama: `patricioampuero/rediseno-profesional-frontend`.
- Archivos agregados: `src/shared/profile-cover.tsx`, `src/shared/metric.tsx`, `src/styles/design-pro.css` y `docs/capturas/rediseno/` (13 capturas de antes y después, modo oscuro y móvil, con su `README.md`).
- Archivos modificados: `src/App.tsx`, `src/main.tsx`, `src/shared/media.tsx`, `src/modules/tutor/tutor.tsx`, `src/modules/community/community.tsx`, `src/modules/business/business.tsx`, `src/modules/ong/adoption.tsx`, `src/modules/clinical/clinical.tsx`, `src/modules/admin/admin.tsx`, `src/modules/auth/Login.tsx` y `Agents.md`.
- Cambio realizado:
  - Portada de perfil (`ProfileCover`) en el Inicio de los siete roles: fondo de portada, avatar, insignias, acciones y cifras reales de la cuenta.
    - Tutor: mascotas, medallas QR activas y vacunas próximas.
    - Pyme y veterinaria: foto de su rubro, plan, verificación, ítems, locales, equipo y ofertas.
    - ONG: foto de portada, verificación, comuna y acceso a su perfil público.
    - Clínica: fichas vigentes, con alertas y por vencer.
    - Asesor y administración: usuarios, Pymes verificadas, animales en adopción y pendientes de revisión.
  - Métricas con ícono y tono por tipo (`Metric`), en lugar de las tres copias locales que había.
  - Muro comunal como feed social:
    - Recuadro «¿Qué está pasando con tu mascota?» con accesos directos por tipo.
    - Publicaciones con encabezado de autor, pastilla de tipo y botones «Apoyar», «Comentar» y «Guardar».
    - Columna lateral con alertas activas, próximos eventos y tu actividad, calculada con las publicaciones ya cargadas.
  - Marco: barra superior con la sección actual y la cuenta, tarjeta de perfil en el menú y «Cerrar sesión» al pie del menú. En teléfonos (≤600 px) el menú pasa a ser una barra inferior deslizable, y los filtros se deslizan en una sola fila.
  - Hoja `design-pro.css`:
    - Encabezados de página en tarjeta con acento.
    - Superficies con sombras suaves, pestañas en píldora y buscador redondeado.
    - Tarjetas del directorio, de mascotas y de ONG con efecto al pasar el cursor.
    - Modales con fondo difuminado.
    - Todo usa los tokens de tema y funciona en claro y en oscuro.
  - Ingreso: tres tarjetas reales del producto sobre la imagen (QR de emergencia, directorio y comunidad). Los botones de cuentas demo ya no quedan circulares.
  - Corrección: el logo usaba un id fijo para su degradado. Si el primer logo quedaba oculto, como el del menú en el teléfono, los demás perdían el fondo; ahora cada logo tiene su propio id.
- Motivo: el usuario pidió que cada módulo y rol se vea profesional y llamativo, como una red social profesional.
- Verificación ejecutada:
  - `npx tsc -b` sin errores, `npm run build -- --base=/mockap-petsuite/` correcto y `npm test` 29 de 29.
  - Capturas con Chromium de las 59 vistas de 7 roles (más ingreso, adopciones, planes y ficha pública del QR) a 1366 px en claro y oscuro, y a 390 px en claro y oscuro.
  - Recorrido general por las 9 cuentas demo, flujos de QR, cartel y «Compartir», y flujos de cuentas reales con API HTTP: sin errores de JavaScript ni desplazamiento horizontal.
  - `git diff --check` correcto.

## 2026-10-29

### Landing, Explorar y perfil público del local (solo frontend)

- Fecha: 2026-10-29.
- Rama: `patricioampuero/landing-explorar-frontend`.
- Archivos agregados:
  - `src/modules/landing/landing.tsx` y `src/modules/landing/public-layout.tsx`.
  - `src/modules/directory/explore.tsx`, `src/modules/directory/public-business.tsx`, `src/modules/directory/explore-search.ts` y `src/modules/directory/explore-search.test.mjs`.
- Archivos modificados: `src/App.tsx`, `src/modules/auth/Login.tsx`, `src/modules/directory/directory.tsx`, `src/modules/ong/ong-profile.tsx`, `src/modules/ong/adoption.tsx`, `src/modules/plans/plans-ui.tsx`, `src/shared/permissions.ts`, `src/styles/design-pro.css`, `package.json` y `AGENTS.md`.
- Cambio realizado:
  - Principio rector: el núcleo pasa a ser Explorar, y la Ficha con QR queda como la razón para crear una cuenta.
  - Landing pública en la raíz para quien no tiene sesión. Tomó como referencia a Airbnb y Booking:
    - Carrusel de tres diapositivas con la foto a la derecha. Avanza solo, se pausa al pasar el cursor y tiene botón de pausa. Con movimiento reducido no avanza.
    - Buscador en píldora («¿Qué necesita tu mascota?», comuna y botón) encima del banner; en el teléfono queda debajo.
    - Cinco categorías como accesos directos.
    - Publicidad de inicio y negocios patrocinados (planes Plata y Oro, marcados).
    - «Cómo funciona», organizaciones para apoyar, cinta de negocios y ONG con pausa, «Quiénes somos» y llamados para tutores y negocios.
    - Todas las cifras salen de `GET /pymes`, `GET /ongs` y `GET /banners`.
  - Explorar (`#explorar?q=&comuna=&rubro=&ofertas=1`), sin cuenta:
    - Lista de tarjetas con foto arriba y mapa fijo al costado.
    - Pines en píldora con el número del resultado y borde dorado (Oro), plateado (Plata) o neutro.
    - Resumen al pasar el cursor por el pin, y el pin se resalta al pasar por la tarjeta.
    - Filtro «Abierto ahora».
    - En el teléfono, botón flotante Lista/Mapa. Las páginas públicas no tienen la barra inferior del menú, así que no tapa nada.
    - La dirección guarda la búsqueda para compartirla.
  - Búsqueda transparente (`explore-search.ts`):
    - Sin tildes ni mayúsculas, con sinónimos (baño/lavado, vacuna/vacunación, peluquería/estética…) y palabras incompletas.
    - El orden normal es por coincidencia y nombre; el plan no lo cambia.
    - Hasta 2 negocios de Plata u Oro que coinciden se muestran aparte como «Patrocinado».
    - El directorio dentro de la app usa la misma búsqueda.
  - Perfil público del local (`#local/<id>`):
    - Título, sello «Validado por PetSuite» con su explicación, estado de apertura, foto grande, servicios, cupones, catálogo, sucursales y mapa con el nombre de cada local.
    - Tarjeta fija con el horario y los botones «Cómo llegar», llamar y WhatsApp.
    - Escribir al negocio pide ingresar; con sesión aparece el formulario de consulta.
    - Cada visita y clic cuenta en las métricas del negocio, con los eventos que ya existían.
    - «Volver a Explorar» conserva la búsqueda.
  - Catálogo, sucursales y formulario de consulta pasaron a componentes compartidos entre el directorio y el perfil público.
  - Ingreso:
    - `#ingresar` y `#registro` abren el formulario; al cerrar sesión se vuelve a la landing.
    - Los enlaces de confirmación y contraseña llevan a `#ingresar`.
    - Planes y Adopciones enlazan a `#ingresar`.
  - Perfil público de la ONG:
    - Primero los animales que buscan hogar.
    - Después «Cómo ayudar», que suma el contacto y pliega los datos bancarios.
    - Al final el impacto y los cupones.
    - Los textos largos cargan recortados con «Leer más».
  - Sello: «Validado por PetSuite» con texto que dice qué se revisó (nombre, RUT y rubro) y que no evalúa la calidad.
  - El rol `pyme` se muestra como «Administrador del local».
- Motivo: en la reunión del 29 de octubre, el profesor indicó que el módulo principal es Explorar (un marketplace de servicios Pet-Care) y que la mayoría de las visitas no creará una cuenta. El usuario eligió hacer primero todo el frontend.
- Dependencias para las tareas con API (no se tocaron `src/mock/` ni `backend/`):
  - Buscar dentro de los catálogos (marcas y medicamentos), con una búsqueda pública en el API.
  - Mostrar en gris los negocios Gratis sin validar: `GET /pymes` hoy solo entrega los aprobados.
  - Próximos eventos en la landing: falta una ruta pública con lista blanca, porque `GET /muro` pide sesión.
  - Galería de fotos y video por plan, logos y fotos de las ONG: falta la carga de archivos.
  - Editor del carrusel y de «Quiénes somos» en Admin: hoy el contenido es fijo.
  - Equipo visible en el perfil del local y rol «Trabajador».
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 34 de 34, con 5 pruebas nuevas de búsqueda: tildes, sinónimos, orden que no depende del plan, comuna por sucursal y dirección compartible.
  - Revisión con Chromium sobre la build de Pages:
    - Landing, Explorar y perfil del local a 1366 px y 390 px, en claro y oscuro.
    - ONG, ingreso y registro.
    - Explorar con búsqueda, con el mapa en el teléfono y con el pin resaltado.
    - En total, 19 capturas sin desplazamiento horizontal ni errores de JavaScript.
  - Flujos revisados:
    - Buscar desde la landing y entrar por una categoría.
    - Perfil sin sesión (pide cuenta) y con sesión (formulario).
    - «Volver a Explorar» con los filtros.
    - Ingreso del tutor desde `#ingresar` y cierre de sesión que vuelve a la landing.
    - El carrusel avanza a los 7 segundos y se detiene con el botón de pausa.
  - `git diff --check` correcto.

## 2026-10-30

### Menú de cada rol con secciones desplegables

- Fecha: 2026-10-30.
- Rama: `patricioampuero/menu-desplegable`, creada sobre `patricioampuero/landing-explorar-frontend` porque ambas tocan `src/App.tsx` y esa rama aún no está en `main`. Se fusiona después de ella.
- Archivos modificados: `src/App.tsx`, `src/styles/design-pro.css` y `AGENTS.md`.
- Cambio realizado:
  - Las opciones de cada rol se agrupan en secciones desplegables. Inicio y Configuración quedan sueltos.
    - Pyme y jefe de local: Mi negocio, Clientes, Promoción y Cuenta.
    - Tutor: Explorar y adoptar.
    - ONG: Mi organización, y Alianzas y difusión.
    - Clínico: Atención.
    - Asesor: Cuentas y Gestión.
    - Administrador: Comunidad, Cuentas comerciales y Cumplimiento.
  - Una sección sin opciones permitidas desaparece, y una con una sola opción se muestra suelta. Por eso el clínico, que solo tiene Pacientes, ve su menú sin secciones.
  - La sección de la vista actual se abre sola. Cerrada, se marca para que se sepa dónde se está.
  - Escritorio: un botón contrae el menú a una columna de íconos con todas las opciones, separadas por sección. El navegador lo recuerda.
  - Hasta 800 px se elimina la barra inferior y el riel de íconos de la tableta. El botón ☰ de la barra superior abre un panel lateral con las secciones, el perfil y «Cerrar sesión». Se cierra al elegir una opción, con la X, con Escape o tocando fuera, y el foco vuelve a ☰. Mientras está abierto, el resto de la pantalla queda inerte.
- Motivo: el usuario pidió que el menú de cada vista fuera desplegable y que sus opciones también lo fueran. Eligió el menú lateral de cada rol y, en el teléfono, el botón ☰ con el menú completo.
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto. `npm test`: 34 de 34.
  - Recorrido con Chromium sobre la build de Pages con las 9 cuentas demo:
    - Cada opción a 1366 px en claro, con las secciones abiertas, y cada opción a 390 px en oscuro, desde el panel ☰. Son 72 opciones por tamaño.
    - Sin errores de JavaScript ni desplazamiento horizontal, y el panel se cierra después de cada elección.
  - Capturas:
    - Menú abierto y contraído a 1366 px en claro, y menú del administrador a 1366 px en oscuro.
    - Panel cerrado y abierto a 390 px en claro y oscuro, y a 768 px en oscuro.
  - El menú contraído mide 84 px y se mantiene al recargar.
  - Escape cierra el panel y devuelve el foco a ☰.
  - `git diff --check` correcto.

## 2026-11-01

### RE-01 · Base real nueva

- Fecha: 2026-11-01.
- Archivos modificados: ninguno. Es configuración: las conexiones están en `.env.production.local`, que Git ignora.
- Cambio realizado:
  - Se creó en Supabase un proyecto propio para la versión real, separado de la demo, en São Paulo (`sa-east-1`), la misma región de la demo.
  - Se aplicaron las migraciones 001 a 004 con `node --env-file=.env.production.local backend/db/migrate.mjs`. No se ejecutó `db:seed`.
- Motivo: la versión real necesita una base sin cuentas demo.
- Verificación ejecutada: antes de migrar, conexión a PostgreSQL 17.11 con la base vacía y proyecto distinto al de la demo. Después, 37 tablas, ninguna sin RLS, 4 migraciones, 3 comunas, 4 planes y 0 usuarios, Pymes, mascotas, sesiones y correos. La segunda ejecución respondió «La base ya está al día».
- Pendiente: la base trae solo 3 comunas (Osorno, Puerto Montt y Castro, de la migración 002); agregar más requiere una migración nueva. La conexión sigue con `sslmode=no-verify` hasta RE-03.

### RE-02 · Cuentas de asesor en la base real

- Fecha: 2026-11-01.
- Rama: `patricioampuero/re-02-cuentas-asesor`.
- Archivos modificados: `backend/db/crear-admin.mjs`, `backend/api/cuentas.test.mjs`, `backend/README.md`, `package.json` y `AGENTS.md`.
- Cambio realizado:
  - `backend/db/crear-admin.mjs` acepta `--asesor`, y el nuevo `npm run db:crear-asesor` lo usa. La cuenta nace igual que la del administrador: sin clave conocida y con una invitación de un solo uso que vence en 7 días.
  - El README y las reglas de trabajo explican que `npm run db:*` lee `.env`, que apunta a la demo, y cómo ejecutar los comandos contra la base real.
- Motivo: en la base real no había forma de crear asesores. El registro público admite tutor, Pyme y ONG; el asesor solo crea Pymes y ONG; y el comando existente solo creaba administradores. Sin asesores nadie puede validar negocios.
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 36 de 36, con 2 pruebas nuevas sobre PGlite:
    - El asesor no entra con la clave demo, entra con su invitación, recibe solo los permisos de asesor, puede crear una cuenta de Pyme y `/admin/usuarios` le responde 403.
    - Los argumentos distinguen administrador y asesor.
  - Sin datos, cada comando muestra su propio mensaje de uso y termina sin conectarse a la base.
  - No se creó ninguna cuenta en la base real: falta definir `APP_URL` para que el enlace apunte a la versión publicada.
  - `git diff --check` correcto. No cambia la interfaz.

### RE-05 y RE-06 · Publicar el API y el frontend real en Vercel

- Fecha: 2026-11-01.
- Rama: `patricioampuero/re-05-publicar-api-vercel`.
- Archivos agregados: `backend/http.mjs`, `backend/vercel/construir.mjs`, `backend/vercel/funcion.mjs`, `backend/vercel/rutas.mjs`, `backend/vercel/vercel.test.mjs` y `vercel.json`.
- Archivos modificados: `backend/server.mjs`, `backend/README.md`, `package.json`, `package-lock.json`, `.gitignore` y `AGENTS.md`.
- Cambio realizado:
  - `npm run build:vercel` genera `.vercel/output` con el frontend y una función que contiene todo el API. El API se empaqueta con esbuild porque `backend/api` importa sin extensión.
  - Frontend y API quedan en un mismo proyecto y una misma dirección, por eso RE-05 y RE-06 son una sola publicación y no hace falta configurar CORS. La app se compila con `VITE_API_URL=/api/v1`, así que sale en modo real, sin cuentas demo.
  - La función corre en São Paulo (`gru1`), la región de la base.
  - La dirección de los enlaces de los correos se toma de Vercel si no se define `APP_URL`, y cambia sola con un dominio propio.
  - La atención HTTP pasó de `backend/server.mjs` a `backend/http.mjs`, para que el servidor y la función no la dupliquen.
- Motivo: publicar la versión real con su base propia, decisión confirmada por el usuario.
- Verificación ejecutada:
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 40 de 40, con 4 pruebas nuevas: rutas, dirección de la app, orígenes permitidos y la función ya empaquetada, sin base y sin el cargador de TypeScript.
  - Recorrido local de `.vercel/output` contra la base real, solo con lecturas y las reglas de `config.json` simuladas: `/healthz`, comunas, planes, Pymes y ONG (200), QR inexistente (404), ingreso inválido (401).
  - En Chromium a 1366 px con esa misma salida: landing, Explorar con estado vacío e ingreso sin botones demo; ingreso inválido con su mensaje y sin errores de JavaScript. No hubo otra revisión visual porque la interfaz no cambió.
  - La revisión encontró un error: dentro del repositorio la función se cargaba como módulo ES. Ahora lleva su propio `package.json`, y la prueba empaqueta dentro del repositorio para detectarlo.
  - `git diff --check` correcto.
- Pendiente: la publicación en Vercel no se probó, porque requiere la cuenta del usuario. Esa revisión queda para el primer despliegue.

### Versión real publicada en Vercel

- Fecha: 2026-11-01.
- Archivos modificados: ninguno del código, solo esta bitácora. Es configuración del proyecto en Vercel.
- Cambio realizado: la versión real quedó en https://mockap-petsuite.vercel.app, con `DATABASE_URL`, `RESEND_API_KEY` y `MAIL_FROM` en el entorno Production. La función corre en São Paulo (`gru1`).
- Motivo: cerrar la revisión pendiente de RE-05 y RE-06.
- Problema encontrado: el API respondía `ECONNREFUSED 127.0.0.1:5432` aunque la variable existía y había dos Redeploy. Ese error significa que `DATABASE_URL` llega vacía o no llega. Se resolvió volviendo a cargar el valor y haciendo otro Redeploy. Vercel solo entrega las variables a los despliegues creados después de guardarlas.
- Verificación ejecutada:
  - `/api/v1/comunas`, planes, Pymes y ONG responden 200 en unos 150 ms, y un QR inexistente, 404.
  - En Chromium sobre el sitio publicado, a 1366 px en claro y 390 px en oscuro: landing, Explorar con estado vacío, Adopciones y Planes sin errores del servidor; ingreso sin botones demo, e ingreso inválido rechazado con su mensaje.
  - La base real siguió con 0 usuarios y 0 correos.
  - No se probó enviar correos: `MAIL_FROM` usa `resend.dev`, y sin un dominio verificado Resend solo envía al dueño de la cuenta.

### Comunas de la Región de Los Lagos

- Fecha: 2026-11-01.
- Rama: `patricioampuero/re-comunas-los-lagos`.
- Archivos agregados: `backend/db/migrations/005_comunas_los_lagos.sql`.
- Archivos modificados: `src/mock/db.ts`, `backend/api/cuentas.test.mjs` y `AGENTS.md`.
- Cambio realizado:
  - La migración 005 agrega 27 comunas a las 3 existentes, que conservan su id: quedan las 30 de la Región de Los Lagos.
  - El mock usa la misma lista y los mismos ids. Su clave sube a `petsuite-mock-db-v5` para que quien ya visitó la demo también las reciba, y se borra la v4.
- Motivo: con solo 3 comunas, una persona de otra comuna de la zona no podía elegir la suya al registrarse. El usuario dejó la decisión a criterio de la implementación: se eligió la región donde parte PetSuite, y otra región se agrega con otra migración.
- Verificación ejecutada:
  - Nombres contrastados con [Región de Los Lagos en Wikipedia](https://es.wikipedia.org/wiki/Regi%C3%B3n_de_Los_Lagos): 30 comunas en 4 provincias.
  - `npx tsc -b` sin errores y `npm run build -- --base=/mockap-petsuite/` correcto.
  - `npm test`: 41 de 41, con 1 prueba nueva: 30 comunas ordenadas, los ids existentes se conservan, se puede registrar en una comuna nueva y una inexistente responde 400. La paridad confirma que el mock y la base devuelven la misma lista.
  - En Chromium sobre la build de Pages, a 1366 y 390 px en claro y oscuro: 30 comunas en la landing, Explorar y registro, filtro por «Río Negro» correcto, clave v4 borrada, sin errores de JavaScript ni desplazamiento horizontal.
  - `git diff --check` correcto.
- Pendiente: aplicar la migración en la base real después de fusionar esta rama, con `node --env-file=.env.production.local backend/db/migrate.mjs`.
