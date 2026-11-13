// Paridad entre el mock del navegador (src/mock/server.ts) y el API sobre PostgreSQL (backend/api).
// Cada guion corre dos veces sobre los mismos datos demo, con los mismos ids: una contra el mock y otra contra una
// base PGlite migrada. Las respuestas (código HTTP y contenido) deben coincidir; solo se normalizan los ids y tokens
// generados en la prueba y las horas.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// El TS de Node necesita extensiones explícitas en las importaciones que Vite resuelve solo.
registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

const values = new Map()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
// La demo (mock) simula Orcob; el API solo con esta variable. La versión real sin Orcob se prueba en pagos.test.mjs.
process.env.ORCOB_SIMULADO = '1'

const mock = await import('../../src/mock/server.ts')
const mockDb = await import('../../src/mock/db.ts')
const { createApi } = await import('./index.ts')
const { pgliteDatabase } = await import('./pglite.ts')
const { migrate } = await import('../db/migrate.mjs')
const { cargarDemo } = await import('../db/seed.mjs')

// ---------- Normalización ----------
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const HEX32 = /\b[0-9a-f]{32}\b/g
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g
const ORCOB = /ORC-(CB-)?\d{8}/g
const CLAVE_TEMPORAL = /Pet-[0-9a-f]{8}/g
const LLAVES_ALEATORIAS = new Set(['token', 'codigo_orcob', 'codigo_pago'])

function normalizar(valor, llave) {
  if (typeof valor === 'string') {
    if (LLAVES_ALEATORIAS.has(llave)) return `<${llave}>`
    // Fotos subidas: el API las entrega por /api/v1/imagenes/<id>; la demo, como data: URL.
    return valor.replace(/\/api\/v1\/imagenes\/[0-9a-f-]{36}|data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '<imagen>').replace(UUID, '<uuid>').replace(HEX32, '<hex>').replace(ISO, '<ts>').replace(ORCOB, '<orcob>').replace(CLAVE_TEMPORAL, '<clave>')
  }
  if (Array.isArray(valor)) return valor.map(x => normalizar(x))
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).filter(([, x]) => x !== undefined).map(([k, x]) => [k, normalizar(x, k)]))
  }
  return valor
}
const plantilla = ruta => ruta.replace(UUID, ':id').replace(HEX32, ':token')

// ---------- Clientes ----------
const llamadas = new Set()
function cliente(handle) {
  const registro = [], sesiones = {}
  const call = async (method, path, body, quien, { comparar = x => x } = {}) => {
    llamadas.add(`${method} ${path.split('?')[0]}`)
    let r
    try {
      r = { status: 200, data: await handle(method, path, body === undefined ? undefined : structuredClone(body), quien ? sesiones[quien] ?? null : null) }
    } catch (error) {
      if (typeof error?.status !== 'number') throw error
      r = { status: error.status, data: error.message }
    }
    if (r.data === undefined) r.status = 204
    registro.push({ paso: `${method} ${plantilla(path)}${quien ? ` (${quien})` : ''}`, status: r.status, data: r.status === 200 ? comparar(structuredClone(r.data)) : r.data })
    return r
  }
  call.sesion = (quien, r) => {
    if (r.status === 200) sesiones[quien] = { token: r.data.token, id: r.data.usuario.id, rol: r.data.usuario.rol, nombre: r.data.usuario.nombre_visible, comunaId: r.data.usuario.comuna_id }
    return r
  }
  call.login = async (quien, correo, clave = 'petsuite123') => call.sesion(quien, await call('POST', '/auth/login', { correo, clave }, null))
  // Token del último enlace (#verificar/… o #restablecer/…) enviado a un correo, leído en la bandeja del administrador.
  call.token = async (para, ruta) => {
    const { data } = await call('GET', '/admin/correos', undefined, 'admin')
    return new RegExp(`#${ruta}/([0-9a-f]{32})`).exec(data.find(c => c.para === para && c.cuerpo.includes(`#${ruta}/`)).cuerpo)[1]
  }
  call.registro = registro
  return call
}

// Corre el guion contra ambos backends con los mismos datos y compara paso a paso.
// Fotos de prueba: un JPEG mínimo sin metadatos y el mismo con un bloque EXIF (datos de cámara o ubicación).
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
// Documentos de prueba: un PDF y un PNG mínimos.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n').toString('base64')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('datos de prueba')]).toString('base64')
const JPEG_EXIF = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0'), Buffer.alloc(8), Buffer.from(JPEG, 'base64').subarray(2)]).toString('base64')

// Ficha con información pública: la demo no trae ninguna (solo existen en la versión real), así que la prueba
// agrega una a los datos de partida de ambos backends.
const FICHA_PUBLICA = {
  propietario_id: '', nombre_comercial: 'Forrajería Campo Verde', rut_empresa: '', rubro: 'tienda', descripcion: null, comuna_id: 1,
  direccion: 'Avenida Ejemplo 812, Osorno', latitud: '-40.5812', longitud: '-73.1188', telefono: '+56642000000', whatsapp: null, horario: {}, servicios: [],
  estado_verificacion: 'pendiente', origen: 'publica', fuente: 'https://ejemplo.test/forrajeria',
}

async function paridad(guion) {
  mockDb.resetDemo()
  mockDb.db.pymes.push({ ...FICHA_PUBLICA, id: crypto.randomUUID(), creado_en: mockDb.now() })
  mockDb.save()
  const semilla = structuredClone(mockDb.db)
  const { database, client } = await pgliteDatabase()
  try {
    await migrate(client, () => {})
    await cargarDemo(client, semilla, { log: () => {} })
    const enMock = cliente(mock.handle), enDb = cliente(createApi(database))
    await guion(enMock, semilla)
    await guion(enDb, semilla)
    assert.equal(enDb.registro.length, enMock.registro.length, 'ambos backends deben ejecutar los mismos pasos')
    enMock.registro.forEach((esperado, i) => {
      const obtenido = enDb.registro[i]
      assert.equal(obtenido.paso, esperado.paso)
      assert.deepEqual(normalizar(obtenido), normalizar(esperado), `paso ${i + 1}: ${esperado.paso}`)
    })
    // Resumen de códigos: el guion debe recorrer tanto respuestas correctas como rechazos.
    const estados = {}
    for (const r of enDb.registro) estados[r.status] = (estados[r.status] ?? 0) + 1
    if (process.env.PARIDAD_DETALLE) console.log(JSON.stringify(estados), enDb.registro.map(r => `${r.status} ${r.paso}`).join('\n'))
    return enMock.registro.length
  } finally {
    await database.close()
  }
}

const idDe = (lista, campo, valor) => lista.find(x => x[campo] === valor).id

// ---------- Guiones ----------
test('cuentas: login, registro, sesión y catálogos', async () => {
  const pasos = await paridad(async call => {
    await call('GET', '/comunas')
    await call('GET', '/planes')
    await call.login('nadie', 'tutor@petsuite.cl', 'incorrecta')
    await call.login('nadie', 'no-existe@petsuite.cl')
    await call.login('nadie', 'no es correo')
    await call.login('tutor', 'TUTOR@petsuite.cl')
    await call.login('clinico', 'clinico@petsuite.cl')
    await call.login('jefe', 'jefe@petsuite.cl')
    await call.login('admin', 'admin@petsuite.cl')
    await call('GET', '/auth/yo', undefined, 'tutor')
    await call('GET', '/auth/yo', undefined, 'clinico')
    await call('GET', '/auth/yo', undefined, 'jefe')
    await call('GET', '/auth/yo')
    const nuevo = { correo: 'Nueva@petsuite.cl', clave: 'secreta123', nombre_visible: 'Nueva Tutora', comuna_id: 2, acepta_terminos: true, acepta_privacidad: true }
    await call('POST', '/auth/registro', { ...nuevo, acepta_privacidad: false })
    await call('POST', '/auth/registro', { ...nuevo, comuna_id: 99 })
    await call('POST', '/auth/registro', { ...nuevo, clave: 'corta' })
    await call('POST', '/auth/registro', { ...nuevo, rol: 'admin' })
    await call('POST', '/auth/registro', nuevo)
    await call('POST', '/auth/registro', nuevo)

    // Confirmación del correo: sin ella no hay ingreso; el enlace sirve una sola vez.
    await call.login('nueva', 'nueva@petsuite.cl', 'secreta123')
    await call.login('nueva', 'nueva@petsuite.cl', 'otra')
    await call('POST', '/auth/reenviar-verificacion', { correo: 'NUEVA@petsuite.cl' })
    await call('POST', '/auth/reenviar-verificacion', { correo: 'nadie@petsuite.cl' })
    await call('POST', '/auth/reenviar-verificacion', { correo: 'tutor@petsuite.cl' })
    await call('POST', '/auth/reenviar-verificacion', { correo: 'no es correo' })
    await call('POST', '/auth/verificar', { token: 'a'.repeat(32) })
    const verificacion = await call.token('nueva@petsuite.cl', 'verificar')
    call.sesion('nueva', await call('POST', '/auth/verificar', { token: verificacion }))
    await call('POST', '/auth/verificar', { token: verificacion })
    await call('GET', '/auth/yo', undefined, 'nueva')
    await call.login('nueva', 'nueva@petsuite.cl', 'secreta123')
    await call('GET', '/mascotas', undefined, 'nueva')
    await call('GET', '/mascotas', undefined, 'clinico')

    // Recuperación de contraseña: misma respuesta exista o no la cuenta; el enlace cierra las sesiones abiertas.
    await call('POST', '/auth/recuperar', { correo: 'nadie@petsuite.cl' })
    await call('POST', '/auth/recuperar', { correo: 'Nueva@petsuite.cl' })
    await call('POST', '/auth/recuperar', { correo: 'nueva@petsuite.cl' })
    const recuperacion = await call.token('nueva@petsuite.cl', 'restablecer')
    await call('POST', '/auth/restablecer', { token: recuperacion, clave: 'corta' })
    await call('POST', '/auth/restablecer', { token: 'b'.repeat(32), clave: 'nuevaClave123' })
    await call('POST', '/auth/restablecer', { token: recuperacion, clave: 'nuevaClave123' })
    await call('POST', '/auth/restablecer', { token: recuperacion, clave: 'otraClave123' })
    await call('GET', '/auth/yo', undefined, 'nueva')
    await call.login('nueva', 'nueva@petsuite.cl', 'secreta123')
    await call.login('nueva', 'nueva@petsuite.cl', 'nuevaClave123')
    await call('GET', '/auth/yo', undefined, 'nueva')

    // Límites de solicitudes: tras 5 contraseñas incorrectas, esa cuenta queda bloqueada 15 minutos desde ese
    // cliente, aunque la sexta sea correcta; las demás cuentas siguen entrando.
    for (let i = 0; i < 5; i++) await call.login('nadie', 'jefe@petsuite.cl', `incorrecta-${i}`)
    await call.login('jefe', 'jefe@petsuite.cl')
    await call.login('tutor', 'tutor@petsuite.cl')
    // Registro, reenvío y recuperación envían correos: 10 por cliente cada hora (en este guion ya van 7).
    for (let i = 0; i < 3; i++) await call('POST', '/auth/recuperar', { correo: `persona${i}@petsuite.cl` })
    await call('POST', '/auth/recuperar', { correo: 'persona9@petsuite.cl' })
    await call('POST', '/auth/registro', { ...nuevo, correo: 'otra@petsuite.cl' })
  })
  assert.ok(pasos > 40)
})

test('Ficha Única: mascotas, accesos clínicos, registros con autoría, medallas y QR público', async () => {
  const pasos = await paridad(async (call, semilla) => {
    const luna = idDe(semilla.mascotas, 'nombre', 'Luna')
    const vet = idDe(semilla.pymes, 'nombre_comercial', 'Clínica Veterinaria Sur')
    const tienda = idDe(semilla.pymes, 'nombre_comercial', 'Huellitas Osorno')
    await call.login('tutor', 'tutor@petsuite.cl')
    await call.login('tutor2', 'tutor2@petsuite.cl')
    await call.login('clinico', 'clinico@petsuite.cl')

    const { data: mias } = await call('GET', '/mascotas', undefined, 'tutor')
    const token = mias[0].token_activo
    await call('POST', '/mascotas', { nombre: '', especie: 'gato' }, 'tutor')
    await call('POST', '/mascotas', { nombre: 'Michi', especie: 'gato' }, 'clinico')
    const { data: michi } = await call('POST', '/mascotas', { nombre: 'Michi', especie: 'gato', sexo: 'macho', fecha_nacimiento: '2024-02-01' }, 'tutor')
    await call('PATCH', `/mascotas/${michi.id}`, { raza: 'Siamés' }, 'tutor')
    await call('PATCH', `/mascotas/${michi.id}`, { raza: 'Persa' }, 'tutor2')
    await call('PATCH', '/mascotas/no-es-un-id', { raza: 'Persa' }, 'tutor')
    await call('PATCH', '/mascotas/00000000-0000-4000-8000-000000000000', { raza: 'Persa' }, 'tutor')
    await call('GET', '/mascotas', undefined, 'tutor')

    // Ficha con control de versión.
    const { data: ficha } = await call('GET', `/mascotas/${luna}/ficha`, undefined, 'tutor')
    await call('GET', `/mascotas/${luna}/ficha`, undefined, 'tutor2')
    const conCondicion = { ...ficha.datos_clinicos, condiciones: ['Displasia de cadera'] }
    const { data: v2 } = await call('PUT', `/mascotas/${luna}/ficha`, { version: ficha.version, datos_clinicos: conCondicion }, 'tutor')
    await call('PUT', `/mascotas/${luna}/ficha`, { version: ficha.version, datos_clinicos: conCondicion }, 'tutor')
    await call('PUT', `/mascotas/${luna}/ficha`, { version: v2.version, datos_clinicos: { ...conCondicion, notaEmergencia: 'x'.repeat(200) } }, 'tutor')

    // Acceso clínico temporal.
    await call('GET', '/mascotas/accesibles', undefined, 'clinico')
    await call('GET', `/mascotas/${luna}/ficha`, undefined, 'clinico')
    await call('POST', `/mascotas/${luna}/accesos`, { pyme_id: tienda, permiso: 'escritura', dias: 7 }, 'tutor')
    await call('POST', `/mascotas/${luna}/accesos`, { pyme_id: vet, permiso: 'escritura', dias: 31 }, 'tutor')
    await call('POST', `/mascotas/${luna}/accesos`, { pyme_id: 'otro', permiso: 'lectura', dias: 7 }, 'tutor')
    const { data: acceso } = await call('POST', `/mascotas/${luna}/accesos`, { pyme_id: vet, permiso: 'escritura', dias: 7 }, 'tutor')
    await call('GET', `/mascotas/${luna}/accesos`, undefined, 'tutor')
    await call('GET', `/mascotas/${luna}/accesos`, undefined, 'tutor2')
    await call('GET', '/mascotas/accesibles', undefined, 'clinico')
    const { data: vistaClinica } = await call('GET', `/mascotas/${luna}/ficha`, undefined, 'clinico')

    // Registros firmados por la clínica.
    await call('POST', `/mascotas/${luna}/registros`, { version: vistaClinica.version - 1, tipo: 'vacuna', fecha: '2026-10-01', titulo: 'Óctuple' }, 'clinico')
    await call('POST', `/mascotas/${luna}/registros`, { version: vistaClinica.version, tipo: 'vacuna', fecha: 'ayer', titulo: 'Óctuple' }, 'clinico')
    await call('POST', `/mascotas/${luna}/registros`, { version: vistaClinica.version, tipo: 'vacuna', fecha: '2026-10-01', titulo: 'Óctuple' }, 'tutor')
    const { data: r1 } = await call('POST', `/mascotas/${luna}/registros`, { version: vistaClinica.version, tipo: 'vacuna', fecha: '2026-10-01', titulo: 'Óctuple', proxima: '2027-10-01', notas: 'Sin reacción' }, 'clinico')
    const { data: r2 } = await call('POST', `/mascotas/${luna}/registros`, { version: r1.version, tipo: 'atencion', fecha: '2026-10-02', titulo: 'Control de cadera' }, 'clinico')
    const { data: r3 } = await call('POST', `/mascotas/${luna}/registros`, { version: r2.version, tipo: 'tratamiento', fecha: '2026-10-02', titulo: 'Antiinflamatorio 5 días', notas: 'Con comida' }, 'clinico')
    const vacuna = r3.datos_clinicos.vacunas.at(-1)

    // El tutor no puede alterar ni borrar registros clínicos, ni firmar como clínica.
    const alterada = structuredClone(r3.datos_clinicos)
    alterada.vacunas.at(-1).nombre = 'Otra vacuna'
    await call('PUT', `/mascotas/${luna}/ficha`, { version: r3.version, datos_clinicos: alterada }, 'tutor')
    await call('PUT', `/mascotas/${luna}/ficha`, { version: r3.version, datos_clinicos: { ...r3.datos_clinicos, vacunas: [] } }, 'tutor')
    const conFirmaFalsa = structuredClone(r3.datos_clinicos)
    conFirmaFalsa.atenciones.push({ id: 'propia-1', fecha: '2026-10-03', motivo: 'Baño', registrado_por: vet, clinica: 'Falsa' })
    const { data: r4 } = await call('PUT', `/mascotas/${luna}/ficha`, { version: r3.version, datos_clinicos: conFirmaFalsa }, 'tutor')

    await call('PATCH', `/mascotas/${luna}/registros/${vacuna.id}`, { version: r3.version, fecha: '2026-10-01', titulo: 'Óctuple refuerzo' }, 'clinico')
    const { data: r5 } = await call('PATCH', `/mascotas/${luna}/registros/${vacuna.id}`, { version: r4.version, fecha: '2026-10-01', titulo: 'Óctuple refuerzo' }, 'clinico')
    await call('PATCH', `/mascotas/${luna}/registros/no-existe`, { version: r5.version, fecha: '2026-10-01', titulo: 'Nada' }, 'clinico')
    await call('PATCH', `/mascotas/${luna}/registros/propia-1`, { version: r5.version, fecha: '2026-10-01', titulo: 'Nada' }, 'clinico')
    await call('POST', `/mascotas/${luna}/registros/${vacuna.id}/anular`, { version: r5.version, motivo: 'no' }, 'clinico')
    const { data: r6 } = await call('POST', `/mascotas/${luna}/registros/${vacuna.id}/anular`, { version: r5.version, motivo: 'Registrada en la mascota equivocada' }, 'clinico')
    await call('PATCH', `/mascotas/${luna}/registros/${vacuna.id}`, { version: r6.version, fecha: '2026-10-01', titulo: 'Otra' }, 'clinico')

    await call('DELETE', `/mascotas/${luna}/accesos/${acceso.id}`, undefined, 'tutor')
    await call('DELETE', `/mascotas/${luna}/accesos/${acceso.id}`, undefined, 'tutor')
    await call('GET', `/mascotas/${luna}/ficha`, undefined, 'clinico')
    await call('POST', `/mascotas/${luna}/accesos`, { pyme_id: vet, permiso: 'lectura', dias: 3 }, 'tutor')
    await call('GET', `/mascotas/${luna}/ficha`, undefined, 'clinico')
    await call('POST', `/mascotas/${luna}/registros`, { version: r6.version, tipo: 'atencion', fecha: '2026-10-05', titulo: 'Control' }, 'clinico')
    await call('GET', '/mascotas/accesibles', undefined, 'clinico')

    // Fotos: el servidor revisa el archivo (tipo real, EXIF), solo el tutor dueño la asocia a su mascota y la foto
    // se ve en la ficha QR. Al quitarla, la foto subida se borra.
    await call('POST', '/imagenes', { datos: JPEG, tipo: 'image/jpeg' })
    await call('POST', '/imagenes', { datos: JPEG, tipo: 'image/png' }, 'tutor')
    await call('POST', '/imagenes', { datos: JPEG_EXIF, tipo: 'image/jpeg' }, 'tutor')
    await call('POST', '/imagenes', { datos: 'esto no es una foto', tipo: 'image/jpeg' }, 'tutor')
    const { data: foto } = await call('POST', '/imagenes', { datos: JPEG, tipo: 'image/jpeg' }, 'tutor')
    const { data: ajena } = await call('POST', '/imagenes', { datos: JPEG, tipo: 'image/jpeg' }, 'tutor2')
    await call('GET', `/imagenes/${foto.id}`)
    await call('GET', '/imagenes/no-existe')
    await call('PUT', `/mascotas/${luna}/foto`, { imagen_id: foto.id }, 'tutor2')
    await call('PUT', `/mascotas/${luna}/foto`, { imagen_id: ajena.id }, 'tutor')
    await call('PUT', `/mascotas/${luna}/foto`, { imagen_id: foto.id }, 'tutor')
    await call('GET', `/qr/${token}`)
    await call('PUT', `/mascotas/${luna}/foto`, { imagen_id: null }, 'tutor')
    await call('GET', `/imagenes/${foto.id}`)
    await call('PUT', `/mascotas/${luna}/foto`, { imagen_id: ajena.id }, 'tutor2')

    // QR público: lista blanca, avisos y reemplazo de medalla.
    await call('GET', `/qr/${token}`)
    await call('GET', '/qr/corto')
    await call('GET', '/qr/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    await call('POST', `/qr/${token}/mensajes`, { mensaje: 'Hola' })
    await call('POST', `/qr/${token}/mensajes`, { mensaje: 'Encontré a Luna cerca de la plaza.', nombre: 'Vecina', contacto: '+56911112222', latitud: -40.5741, longitud: -73.1349 })
    await call('POST', `/qr/${token}/mensajes`, { mensaje: 'La vi de nuevo en la costanera.' })
    // Cada mensaje avisa al tutor por correo (sin proveedor de correo, la bandeja guarda el aviso completo).
    await call.login('admin', 'admin@petsuite.cl')
    await call('GET', '/admin/correos', undefined, 'admin', { comparar: lista => lista.filter(c => c.tipo === 'aviso_qr') })
    // Hasta 5 mensajes por medalla y cliente cada hora: el sexto responde 429.
    for (let i = 0; i < 3; i++) await call('POST', `/qr/${token}/mensajes`, { mensaje: `Aviso número ${i + 3} desde la plaza.` })
    await call('POST', `/qr/${token}/mensajes`, { mensaje: 'Un aviso más, ya sobre el límite.' })
    const { data: avisos } = await call('GET', `/mascotas/${luna}/mensajes`, undefined, 'tutor')
    await call('GET', `/mascotas/${luna}/mensajes`, undefined, 'tutor2')
    await call('PATCH', `/mascotas/mensajes/${avisos[0].id}`, { estado: 'leido' }, 'tutor2')
    await call('PATCH', `/mascotas/mensajes/${avisos[0].id}`, { estado: 'borrado' }, 'tutor')
    await call('PATCH', `/mascotas/mensajes/${avisos[0].id}`, { estado: 'leido' }, 'tutor')
    await call('GET', `/mascotas/${luna}/mensajes`, undefined, 'tutor')

    const { data: nueva } = await call('POST', `/mascotas/${luna}/medallas`, undefined, 'tutor')
    await call('POST', `/mascotas/${luna}/medallas`, undefined, 'tutor2')
    await call('GET', `/qr/${token}`)
    await call('POST', `/qr/${token}/mensajes`, { mensaje: 'Sigue cerca de la plaza.' })
    await call('GET', `/qr/${nueva.token_publico}`)
    await call('DELETE', `/mascotas/${luna}/medallas/activa`, undefined, 'tutor')
    await call('DELETE', `/mascotas/${luna}/medallas/activa`, undefined, 'tutor')
    await call('GET', `/qr/${nueva.token_publico}`)
    await call('POST', `/mascotas/${luna}/medallas`, undefined, 'tutor')
    await call('GET', '/mascotas', undefined, 'tutor')
  })
  assert.ok(pasos > 60)
})

const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const entrar = async (call, ...cuentas) => { for (const c of cuentas) await call.login(c, `${c}@petsuite.cl`) }

test('directorio y Pymes: perfil, consultas, catálogo, métricas, suscripción, Orcob y verificación', async () => {
  const pasos = await paridad(async (call, semilla) => {
    const shop = idDe(semilla.pymes, 'nombre_comercial', 'Huellitas Osorno')
    const vet = idDe(semilla.pymes, 'nombre_comercial', 'Clínica Veterinaria Sur')
    const pelu = idDe(semilla.pymes, 'nombre_comercial', 'Peluquería Canina Patagonia')
    const arnes = idDe(semilla.catalogo, 'nombre', 'Arnés ajustable')
    await entrar(call, 'tutor', 'tienda', 'veterinaria', 'peluqueria', 'jefe', 'clinico', 'asesor', 'admin')

    await call('GET', '/pymes')
    await call('GET', '/pymes?comuna=Puerto%20Montt')
    await call('GET', '/pymes?comuna=Osorno&rubro=veterinaria')
    await call('GET', '/pymes?rubro=inexistente')
    for (const quien of ['tienda', 'veterinaria', 'peluqueria', 'jefe', 'clinico', 'tutor']) await call('GET', '/pymes/mias', undefined, quien)

    // Ficha con información pública: aparece en Explorar sin sello, cuenta visitas y clics, pero no recibe
    // consultas ni se puede validar sin su dueño, y no aparece entre las Pymes por revisar.
    const publica = idDe(semilla.pymes, 'nombre_comercial', 'Forrajería Campo Verde')
    await call('GET', '/pymes?rubro=tienda')
    await call('GET', `/pymes/${publica}`)
    await call('POST', `/pymes/${publica}/eventos`, { tipo: 'clic_contacto' })
    await call('POST', `/pymes/${publica}/contactos`, { mensaje: '¿Tienen alimento para conejos?' }, 'tutor')
    await call('PATCH', `/admin/pymes/${publica}/verificacion`, { decision: 'aprobar' }, 'asesor')

    // Vitrina pública y eventos para métricas.
    await call('GET', `/pymes/${shop}`)
    await call('GET', '/pymes/no-existe')
    await call('POST', `/pymes/${shop}/eventos`, { tipo: 'vista_item', item_id: arnes })
    await call('POST', `/pymes/${shop}/eventos`, { tipo: 'vista_item', item_id: 'otro' })
    await call('POST', `/pymes/${shop}/eventos`, { tipo: 'clic_whatsapp' })
    await call('POST', `/pymes/${shop}/eventos`, { tipo: 'compra' })

    // Perfil del negocio.
    const { data: perfil } = await call('GET', `/pymes/${shop}/perfil`, undefined, 'tienda')
    await call('GET', `/pymes/${shop}/perfil`, undefined, 'jefe')
    await call('GET', `/pymes/${shop}/perfil`, undefined, 'clinico')
    const cambios = { nombre_comercial: 'Huellitas Osorno', descripcion: 'Alimentos y accesorios.', comuna_id: 1, direccion: 'Ramírez 550', telefono: '642200000', whatsapp: '56911112222', horario: { 'lun-vie': '09:00-19:00', sab: '', dom: '' }, servicios: ['Despacho', 'Despacho', 'Asesoría'], latitud: -40.5745, longitud: -73.135, foto_portada: '/img/collares.jpg' }
    await call('PATCH', `/pymes/${shop}/perfil`, { ...cambios, comuna_id: 99 }, 'tienda')
    await call('PATCH', `/pymes/${shop}/perfil`, { ...cambios, latitud: null }, 'tienda')
    await call('PATCH', `/pymes/${shop}/perfil`, cambios, 'tienda')
    await call('PATCH', `/pymes/${pelu}/perfil`, { ...cambios, nombre_comercial: 'Peluquería Canina Patagonia', comuna_id: 2 }, 'peluqueria')
    assert.ok(perfil)

    // Consultas de clientes.
    await call('POST', `/pymes/${shop}/contactos`, { mensaje: '¿Tienen arnés talla S?', contacto: '' }, 'tienda')
    await call('POST', `/pymes/${shop}/contactos`, { mensaje: 'Hola', contacto: '' }, 'tutor')
    await call('POST', '/pymes/no-existe/contactos', { mensaje: '¿Tienen arnés talla S?', contacto: '' }, 'tutor')
    const { data: consulta } = await call('POST', `/pymes/${shop}/contactos`, { mensaje: '¿Tienen arnés talla S?', contacto: '+56 9 1234 5678' }, 'tutor')
    await call('GET', `/pymes/${shop}/contactos`, undefined, 'jefe')
    await call('PATCH', `/pymes/${shop}/contactos/${consulta.id}`, { estado: 'leido' }, 'tienda')
    await call('PATCH', `/pymes/${shop}/contactos/${consulta.id}`, { estado: 'leido' }, 'tienda')
    await call('PATCH', `/pymes/${shop}/contactos/${consulta.id}`, { estado: 'respondido', respuesta: 'Sí, nos quedan dos.' }, 'tienda')
    await call('PATCH', `/pymes/${vet}/contactos/${consulta.id}`, { estado: 'leido' }, 'veterinaria')
    await call('GET', '/mis-contactos-pyme', undefined, 'tutor')

    // Catálogo con ofertas y cupos por plan.
    await call('GET', `/pymes/${shop}/catalogo`, undefined, 'tienda')
    await call('POST', `/pymes/${shop}/catalogo`, { tipo: 'producto', nombre: 'Cama', oferta: { precio_clp: 1000, desde: dia(0), hasta: dia(5) } }, 'tienda')
    await call('POST', `/pymes/${shop}/catalogo`, { tipo: 'producto', nombre: 'Cama', precio_referencial_clp: 1000, oferta: { precio_clp: 1000, desde: dia(0), hasta: dia(5) } }, 'tienda')
    await call('POST', `/pymes/${shop}/catalogo`, { tipo: 'producto', nombre: 'Cama', precio_referencial_clp: 1000, oferta: { precio_clp: 900, desde: dia(5), hasta: dia(0) } }, 'tienda')
    const { data: cama } = await call('POST', `/pymes/${shop}/catalogo`, { tipo: 'producto', nombre: 'Cama', descripcion: 'Talla M', precio_referencial_clp: 25000, categoria: 'Accesorios', oferta: { precio_clp: 19990, desde: dia(0), hasta: dia(5) } }, 'tienda')
    await call('PUT', `/pymes/${shop}/catalogo/${cama.id}`, { tipo: 'producto', nombre: 'Cama acolchada', oferta: null, sin_stock: true }, 'tienda')
    await call('PUT', `/pymes/${shop}/catalogo/${cama.id}`, { tipo: 'producto', nombre: 'Cama acolchada', precio_referencial_clp: 100 }, 'tienda')
    await call('PUT', `/pymes/${shop}/catalogo/no-existe`, { tipo: 'producto', nombre: 'X1' }, 'tienda')
    await call('POST', `/pymes/${pelu}/catalogo`, { tipo: 'servicio', nombre: 'Baño', precio_referencial_clp: 9000, oferta: { precio_clp: 8000, desde: dia(0), hasta: dia(3) } }, 'peluqueria')
    await call('POST', `/pymes/${pelu}/catalogo`, { tipo: 'servicio', nombre: 'Baño', precio_referencial_clp: 9000 }, 'peluqueria')
    await call('POST', `/pymes/${vet}/catalogo`, { tipo: 'servicio', nombre: 'Consulta', precio_referencial_clp: 15000 }, 'clinico')
    await call('GET', `/pymes/${shop}`)
    await call('DELETE', `/pymes/${shop}/catalogo/${cama.id}`, undefined, 'tienda')
    await call('DELETE', `/pymes/${shop}/catalogo/${cama.id}`, undefined, 'tienda')
    await call('GET', `/pymes/${shop}/catalogo`, undefined, 'jefe')

    for (const [id, quien] of [[shop, 'tienda'], [vet, 'veterinaria'], [pelu, 'peluqueria']]) await call('GET', `/pymes/${id}/metricas`, undefined, quien)

    // Suscripción: renovación por transferencia y pago por Orcob con su aviso.
    await call('GET', `/pymes/${shop}/suscripcion`, undefined, 'tienda')
    await call('GET', `/pymes/${shop}/suscripcion`, undefined, 'jefe')
    await call('POST', `/pymes/${shop}/suscripcion`, { plan_id: 4, canal: 'transferencia' }, 'tienda')
    await call('POST', `/pymes/${shop}/suscripcion`, { plan_id: 1, canal: 'orcob' }, 'tienda')
    await call('POST', `/pymes/${shop}/suscripcion`, { plan_id: 4, canal: 'transferencia', referencia_pago: 'TRF-2026-10' }, 'tienda')
    await call('POST', `/pymes/${shop}/suscripcion`, { plan_id: 4, canal: 'orcob' }, 'tienda')
    const { data: cobro } = await call('POST', `/pymes/${pelu}/suscripcion`, { plan_id: 2, canal: 'orcob' }, 'peluqueria')
    await call('POST', `/pymes/${shop}/pagos/${cobro.pago_id}/orcob-confirmado`, undefined, 'tienda')
    await call('POST', `/pymes/${pelu}/pagos/${cobro.pago_id}/orcob-confirmado`, undefined, 'peluqueria')
    await call('POST', `/pymes/${pelu}/pagos/${cobro.pago_id}/orcob-confirmado`, undefined, 'peluqueria')
    await call('GET', `/pymes/${pelu}/suscripcion`, undefined, 'peluqueria')
    // Mercado Pago sin MP_ACCESS_TOKEN (y en la demo): no se ofrece y sus rutas responden igual en ambos backends.
    // El flujo con Mercado Pago se prueba contra un Mercado Pago simulado en mercadopago.test.mjs.
    await call('GET', '/pagos/medios')
    await call('POST', `/pymes/${shop}/suscripcion`, { plan_id: 3, canal: 'mercadopago' }, 'tienda')
    await call('POST', `/pymes/${pelu}/pagos/${cobro.pago_id}/mercadopago`, undefined, 'peluqueria')
    await call('POST', `/pymes/${pelu}/pagos/${cobro.pago_id}/mercadopago`, undefined, 'tutor')
    await call('POST', `/pymes/${pelu}/pagos/${cobro.pago_id}/mercadopago/verificar`, undefined, 'peluqueria')
    await call('POST', '/pagos/mercadopago/webhook?data.id=123&type=payment', { type: 'payment', data: { id: '123' } })
    await call('GET', '/pymes/mias', undefined, 'peluqueria')
    await call('GET', '/pymes/mias', undefined, 'tienda')

    // Alta de una Pyme nueva y verificación del asesor.
    await call('POST', '/auth/registro', { correo: 'gato@petsuite.cl', clave: 'secreta123', nombre_visible: 'Gatería', comuna_id: 3, rol: 'pyme', acepta_terminos: true, acepta_privacidad: true })
    call.sesion('nueva', await call('POST', '/auth/verificar', { token: await call.token('gato@petsuite.cl', 'verificar') }))
    const alta = { nombre_comercial: 'Gatería Castro', rut_empresa: '76999888-K', rubro: 'tienda', comuna_id: 3, direccion: 'Blanco 10', latitud: -42.48, longitud: -73.76 }
    await call('POST', '/pymes', { ...alta, rut_empresa: '123' }, 'nueva')
    await call('POST', '/pymes', { ...alta, comuna_id: 99 }, 'nueva')
    await call('POST', '/pymes', { ...alta, plan_id: 9 }, 'nueva')
    await call('POST', '/pymes', { ...alta, plan_id: 3, canal_pago: 'mercadopago' }, 'nueva')
    await call('POST', '/pymes', { ...alta, rut_empresa: '76333444-5' }, 'nueva')
    const { data: gateria } = await call('POST', '/pymes', { ...alta, plan_id: 3, canal_pago: 'orcob' }, 'nueva')
    await call('POST', '/pymes', alta, 'tutor')
    await call('GET', '/pymes/mias', undefined, 'nueva')
    await call('POST', `/pymes/${gateria.id}/catalogo`, { tipo: 'producto', nombre: 'Rascador', precio_referencial_clp: 20000 }, 'nueva')
    await call('POST', `/pymes/${gateria.id}/suscripcion`, { plan_id: 3, canal: 'orcob' }, 'nueva')

    // Documentos de validación: sin ellos el alta no se aprueba. El RUT 76.999.888 es de empresa, así que también
    // se pide la constitución. El asesor descarga, aprueba o pide corregir; el archivo nunca es público.
    await call('GET', `/pymes/${gateria.id}/documentos`, undefined, 'nueva')
    await call('PATCH', `/admin/pymes/${gateria.id}/verificacion`, { decision: 'aprobar' }, 'asesor')
    const doc = (tipo, nombre, mime, datos, quien = 'nueva') => call('PUT', `/pymes/${gateria.id}/documentos/${tipo}`, { nombre, mime, datos }, quien)
    await doc('patente_comercial', 'patente.pdf', 'application/pdf', PDF, 'tutor')
    await doc('patente_comercial', 'patente.pdf', 'application/pdf', PDF, 'tienda')
    await doc('otro', 'patente.pdf', 'application/pdf', PDF)
    await doc('patente_comercial', 'patente.pdf', 'application/pdf', JPEG)
    await doc('patente_comercial', 'patente.txt', 'text/plain', PDF)
    await doc('patente_comercial', 'patente.pdf', 'application/pdf', 'no es base64 !')
    await doc('patente_comercial', 'documentos/patente 2026.pdf', 'application/pdf', PDF)
    await doc('resolucion_sanitaria', 'resolucion.jpg', 'image/jpeg', JPEG)
    const { data: docs } = await call('GET', `/admin/pymes/${gateria.id}/documentos`, undefined, 'asesor')
    await call('GET', `/admin/pymes/${gateria.id}/documentos`, undefined, 'tutor')
    await call('GET', '/admin/pymes/no-existe/documentos', undefined, 'asesor')
    await call('PATCH', `/admin/pymes/${gateria.id}/verificacion`, { decision: 'aprobar' }, 'asesor')
    const patente = docs.documentos.find(d => d.tipo === 'patente_comercial').archivo.id
    await call('GET', `/admin/documentos/${patente}/archivo`, undefined, 'asesor')
    await call('GET', `/admin/documentos/${patente}/archivo`, undefined, 'nueva')
    await call('GET', '/admin/documentos/no-existe/archivo', undefined, 'asesor')
    await call('GET', `/pymes/${gateria.id}/documentos/${patente}/archivo`, undefined, 'nueva')
    await call('GET', `/pymes/${shop}/documentos/${patente}/archivo`, undefined, 'tienda')
    await call('PATCH', `/admin/documentos/${patente}`, { decision: 'rechazar', motivo: 'corta' }, 'asesor')
    await call('PATCH', `/admin/documentos/${patente}`, { decision: 'rechazar', motivo: 'La patente está vencida: sube la del año 2026.' }, 'asesor')
    await call('PATCH', '/admin/documentos/no-existe', { decision: 'aprobar' }, 'asesor')
    await doc('constitucion_sociedad', 'constitucion.png', 'image/png', PNG)
    await call('PATCH', `/admin/pymes/${gateria.id}/verificacion`, { decision: 'aprobar' }, 'asesor')
    await doc('patente_comercial', 'patente-2026.pdf', 'application/pdf', PDF)
    await call('GET', '/pymes/mias', undefined, 'nueva')
    await call('GET', '/admin/pymes', undefined, 'asesor')
    await call('GET', '/admin/pymes', undefined, 'tutor')
    await call('PATCH', `/admin/pymes/${gateria.id}/verificacion`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/admin/pymes/${shop}/verificacion`, { decision: 'rechazar' }, 'asesor')
    await call('PATCH', '/admin/pymes/no-existe/verificacion', { decision: 'aprobar' }, 'asesor')
    await call('GET', '/admin/pymes?estado=aprobada', undefined, 'admin')
    await call('PATCH', `/admin/pymes/${pelu}/verificacion`, { decision: 'suspender' }, 'admin')
    await call('GET', '/admin/pymes?estado=suspendida', undefined, 'admin')
    await call('PATCH', `/admin/pymes/${pelu}/verificacion`, { decision: 'aprobar' }, 'admin')
    await call('GET', `/pymes/${gateria.id}`)
    await call('GET', '/pymes/mias', undefined, 'nueva')
    await call('GET', `/pymes/${gateria.id}/suscripcion`, undefined, 'nueva')
    await call('GET', '/admin/resumen', undefined, 'asesor')
    await call('GET', '/admin/resumen', undefined, 'tutor')
    await call('GET', '/correos/mios', undefined, 'nueva')
  })
  assert.ok(pasos > 90)
})

test('muro comunal y moderación: publicaciones, comentarios, reacciones, reportes y suspensión', async () => {
  const pasos = await paridad(async (call, semilla) => {
    const luna = idDe(semilla.mascotas, 'nombre', 'Luna')
    const tomas = idDe(semilla.animales, 'nombre', 'Tomás')
    const canela = idDe(semilla.animales, 'nombre', 'Canela')
    const borrador = idDe(semilla.animales, 'nombre', 'Borrador')
    await entrar(call, 'tutor', 'tutor2', 'ong', 'ong2', 'admin', 'tienda')
    const tutor2 = semilla.usuarios.find(u => u.correo === 'tutor2@petsuite.cl').id

    await call('GET', '/muro', undefined, 'tutor')
    await call('GET', '/muro?comuna=2', undefined, 'tutor')
    await call('GET', '/muro?comuna=abc', undefined, 'tutor')
    await call('GET', '/muro')

    await call('POST', '/muro', { tipo: 'recomendacion', texto: 'Muy corto' }, 'tutor')
    await call('POST', '/muro', { tipo: 'recomendacion', texto: 'Visiten https://ejemplo.cl para más info' }, 'tutor')
    await call('POST', '/muro', { tipo: 'evento', texto: 'Feria de adopción en la plaza central' }, 'tutor')
    await call('POST', '/muro', { tipo: 'evento', texto: 'Feria de adopción en la plaza central', fecha_evento: dia(-1) }, 'tutor')
    await call('POST', '/muro', { tipo: 'adopcion', texto: 'Doy en adopción a mi gato regalón', animal_id: tomas }, 'tutor')
    await call('POST', '/muro', { tipo: 'extravio', texto: 'Se perdió Luna cerca del río Rahue', mascota_id: luna }, 'tutor2')
    await call('POST', '/muro', { tipo: 'recomendacion', texto: 'Recomiendo la tienda Huellitas Osorno' }, 'tienda')
    const { data: extravio } = await call('POST', '/muro', { tipo: 'extravio', texto: 'Se perdió Luna cerca del río Rahue', mascota_id: luna, sector: 'Rahue Alto' }, 'tutor')
    const { data: evento } = await call('POST', '/muro', { tipo: 'evento', texto: 'Feria de adopción en la plaza central', fecha_evento: dia(4), sector: 'Plaza de Armas' }, 'tutor')

    await call('POST', `/muro/${extravio.id}/reacciones`, undefined, 'tutor2')
    await call('POST', `/muro/${extravio.id}/guardar`, undefined, 'tutor2')
    // Solo el autor recibe el id de la mascota del extravío (para su cartel); quien lo guardó, no.
    const { data: delAutor } = await call('GET', '/muro', undefined, 'tutor')
    assert.equal(delAutor.find(p => p.id === extravio.id).mascota_id, luna)
    const { data: guardadas } = await call('GET', '/muro?guardadas=1', undefined, 'tutor2')
    assert.equal(guardadas.find(p => p.id === extravio.id).mascota_id, null)
    await call('POST', `/muro/${evento.id}/reacciones`, undefined, 'tutor2')
    await call('POST', `/muro/${evento.id}/reacciones`, undefined, 'tutor2')
    await call('POST', '/muro/no-existe/guardar', undefined, 'tutor2')
    await call('POST', `/muro/${extravio.id}/comentarios`, { texto: 'Ok' }, 'tutor2')
    const { data: comentario } = await call('POST', `/muro/${extravio.id}/comentarios`, { texto: 'La vi en la costanera hace una hora' }, 'tutor2')
    await call('GET', '/muro?guardadas=1', undefined, 'tutor2')
    await call('GET', '/muro?comuna=1', undefined, 'tutor2')

    await call('PATCH', `/muro/${extravio.id}`, { texto: 'Se perdió Luna cerca del río, usa collar rojo', sector: 'Rahue' }, 'tutor2')
    await call('PATCH', `/muro/${extravio.id}`, { texto: 'Se perdió Luna cerca del río, usa collar rojo', sector: 'Rahue' }, 'tutor')
    await call('PATCH', `/muro/${evento.id}`, { texto: 'Feria de adopción en la plaza central de Osorno', fecha_evento: dia(-2) }, 'tutor')
    await call('PATCH', `/muro/${evento.id}`, { texto: 'Feria de adopción en la plaza central de Osorno', fecha_evento: dia(6) }, 'tutor')
    await call('PATCH', `/muro/${evento.id}/resuelto`, { resuelto: true }, 'tutor')
    await call('PATCH', `/muro/${extravio.id}/resuelto`, { resuelto: true }, 'tutor')
    await call('PATCH', `/muro/comentarios/${comentario.id}`, { texto: 'Editado por otro' }, 'tutor')
    await call('PATCH', `/muro/comentarios/${comentario.id}`, { texto: 'La vi en la costanera, iba hacia el puente' }, 'tutor2')

    // Reportes y moderación.
    await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: extravio.id, motivo: 'Contenido engañoso' }, 'tutor')
    await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: 'no-existe', motivo: 'Contenido engañoso' }, 'tutor2')
    await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: extravio.id, motivo: 'corto' }, 'tutor2')
    const { data: reporte } = await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: extravio.id, motivo: 'Contenido engañoso y repetido' }, 'tutor2')
    await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: extravio.id, motivo: 'Contenido engañoso y repetido' }, 'tutor2')
    const { data: rComentario } = await call('POST', '/reportes', { objeto_tipo: 'comentario', objeto_id: comentario.id, motivo: 'Lenguaje inapropiado' }, 'tutor')
    await call('POST', '/reportes', { objeto_tipo: 'publicacion', objeto_id: evento.id, motivo: 'Fecha equivocada en el evento' }, 'tienda')
    await call('GET', '/admin/reportes', undefined, 'admin')
    await call('GET', '/admin/reportes', undefined, 'tutor')
    await call('PATCH', `/admin/reportes/${rComentario.id}`, { decision: 'ocultar' }, 'admin')
    await call('PATCH', `/admin/reportes/${rComentario.id}`, { decision: 'ocultar' }, 'admin')
    await call('GET', '/muro', undefined, 'tutor')
    const autorExtravio = semilla.usuarios.find(u => u.correo === 'tutor@petsuite.cl').id
    await call('GET', `/admin/usuarios/${autorExtravio}/denuncias`, undefined, 'admin')
    await call('GET', '/admin/usuarios/no-existe/denuncias', undefined, 'admin')

    // Difusión de adopciones por ONG.
    await call('POST', '/muro', { tipo: 'recomendacion', texto: 'Recomendamos esterilizar a tiempo' }, 'ong')
    await call('POST', '/muro', { tipo: 'adopcion', texto: 'Canela busca hogar responsable', animal_id: canela }, 'ong')
    await call('POST', '/muro', { tipo: 'adopcion', texto: 'Borrador busca hogar responsable', animal_id: borrador }, 'ong')
    await call('POST', '/muro', { tipo: 'adopcion', texto: 'Borrador busca hogar responsable', animal_id: borrador }, 'ong2')
    await call('POST', '/muro', { tipo: 'adopcion', texto: 'Tomás busca un hogar con paciencia', animal_id: tomas }, 'ong')
    await call('GET', '/muro', undefined, 'ong')

    // Suspensión con la denuncia: oculta la publicación y resuelve sus reportes.
    const suspension = { tipo: 'temporal', dias: 3, motivo: 'spam', mensaje: 'Publicaste contenido repetido en el muro.' }
    await call('PATCH', `/admin/usuarios/${autorExtravio}`, { estado: 'suspendido', suspension: { ...suspension, dias: null } }, 'admin')
    await call('PATCH', `/admin/usuarios/${tutor2}`, { estado: 'suspendido', suspension, reporte_id: reporte.id }, 'admin')
    await call('PATCH', `/admin/usuarios/${autorExtravio}`, { estado: 'suspendido', suspension, reporte_id: reporte.id }, 'admin')
    await call('GET', '/muro', undefined, 'tutor')
    await call.login('tutor', 'tutor@petsuite.cl')
    await call('GET', '/admin/usuarios?q=ana', undefined, 'admin')
    await call('GET', '/admin/reportes', undefined, 'admin')
    await call('PATCH', `/admin/usuarios/${autorExtravio}`, { estado: 'activo' }, 'admin')
    await call.login('tutor', 'tutor@petsuite.cl')
    await call('DELETE', `/muro/comentarios/${comentario.id}`, undefined, 'tutor2')
    await call('DELETE', `/muro/${evento.id}`, undefined, 'tutor')
    await call('DELETE', `/muro/${evento.id}`, undefined, 'tutor')
    await call('GET', '/admin/reportes', undefined, 'admin')
    await call('GET', '/admin/usuarios', undefined, 'admin')
    await call('GET', '/admin/resumen', undefined, 'admin')
  })
  assert.ok(pasos > 60)
})

test('adopción y ONG: catálogo, solicitudes, traspaso de la ficha, registro, perfil público y verificación', async () => {
  const pasos = await paridad(async (call, semilla) => {
    const canela = idDe(semilla.animales, 'nombre', 'Canela')
    const tomas = idDe(semilla.animales, 'nombre', 'Tomás')
    const borrador = idDe(semilla.animales, 'nombre', 'Borrador')
    const patitas = idDe(semilla.ongs, 'nombre', 'Patitas del Sur')
    await entrar(call, 'tutor', 'tutor2', 'ong', 'ong2', 'asesor', 'admin')

    await call('GET', '/adopciones')
    await call('GET', '/adopciones?especie=GATO')
    await call('GET', '/adopciones?comuna=Puerto%20Montt')
    await call('GET', `/adopciones/${canela}`)
    await call('GET', `/adopciones/${borrador}`)
    await call('POST', `/adopciones/${canela}/solicitudes`, { mensaje: 'La quiero' })
    const { data: sol } = await call('POST', `/adopciones/${canela}/solicitudes`, { mensaje: 'Tenemos patio y experiencia con perros.', nombre: 'Diego', contacto: 'tutor2@petsuite.cl' })
    await call('POST', `/adopciones/${canela}/solicitudes`, { mensaje: 'También me interesa adoptarla.', contacto: '+56 9 8888 7777' })
    await call('POST', `/adopciones/${borrador}/solicitudes`, { mensaje: 'Me interesa adoptarlo pronto.' })
    assert.ok(sol)

    await call('GET', '/ong/mia', undefined, 'ong')
    await call('GET', '/ong/mia', undefined, 'tutor')
    const { data: animales } = await call('GET', '/ong/animales', undefined, 'ong')
    await call('GET', '/ong/animales', undefined, 'ong2')
    const { data: nuevo } = await call('POST', '/ong/animales', { nombre: 'Pelusa', especie: 'gato', edad_estimada: '1 año', historial_salud: { vacunas: [{ nombre: 'Triple felina', fecha: '2026-09-01' }] } }, 'ong')
    await call('POST', '/ong/animales', { nombre: '', especie: 'gato' }, 'ong')
    await call('PUT', `/ong/animales/${nuevo.id}`, { nombre: 'Pelusa', especie: 'gato', historia: 'Rescatada en invierno.', estado: 'en_proceso' }, 'ong')
    await call('PUT', `/ong/animales/${canela}`, { nombre: 'Canela', especie: 'perro' }, 'ong2')
    const { data: solicitudes } = await call('GET', `/ong/animales/${canela}/solicitudes`, undefined, 'ong')
    await call('GET', `/ong/animales/${canela}/solicitudes`, undefined, 'ong2')
    await call('PATCH', `/ong/solicitudes/${solicitudes[1].id}`, { estado: 'en_conversacion' }, 'ong')
    await call('GET', '/adopciones', undefined)
    await call('PATCH', `/ong/solicitudes/${solicitudes[1].id}`, { estado: 'cerrada' }, 'ong')
    await call('PATCH', `/ong/solicitudes/${solicitudes[1].id}`, { estado: 'cerrada' }, 'ong')
    await call('GET', '/ong/animales', undefined, 'ong')
    assert.ok(animales.length)

    // Adopción con traspaso de la ficha al tutor registrado.
    await call('POST', `/ong/animales/${canela}/adopcion`, { solicitud_id: 'otra' }, 'ong')
    await call('POST', `/ong/animales/${canela}/adopcion`, { solicitud_id: solicitudes[0].id }, 'ong')
    await call('POST', `/ong/animales/${canela}/adopcion`, {}, 'ong')
    await call('GET', '/mascotas', undefined, 'tutor2')
    await call('GET', `/ong/animales/${canela}/solicitudes`, undefined, 'ong')
    await call('POST', `/ong/animales/${tomas}/adopcion`, { correo: 'no-registrado@petsuite.cl' }, 'ong')
    await call('POST', `/ong/animales/${tomas}/vincular`, { correo: 'no-registrado@petsuite.cl' }, 'ong')
    await call('POST', `/ong/animales/${tomas}/vincular`, { correo: 'TUTOR@petsuite.cl' }, 'ong')
    await call('POST', `/ong/animales/${tomas}/vincular`, { correo: 'tutor@petsuite.cl' }, 'ong')
    await call('GET', '/mascotas', undefined, 'tutor')
    await call('GET', '/adopciones')

    // Registro de una ONG nueva, verificación y CMS del perfil público.
    await call('POST', '/ong', { nombre: 'Otra', tipo: 'refugio', comuna_id: 1 }, 'ong')
    await call('POST', '/auth/registro', { correo: 'refugio@petsuite.cl', clave: 'secreta123', nombre_visible: 'Refugio Castro', comuna_id: 3, rol: 'ong', acepta_terminos: true, acepta_privacidad: true })
    call.sesion('refugio', await call('POST', '/auth/verificar', { token: await call.token('refugio@petsuite.cl', 'verificar') }))
    await call('GET', '/ong/animales', undefined, 'refugio')
    await call('POST', '/ong', { nombre: 'Refugio Castro', tipo: 'refugio', comuna_id: 99 }, 'refugio')
    const { data: refugio } = await call('POST', '/ong', { nombre: 'Refugio Castro', tipo: 'refugio', comuna_id: 3, contacto: 'refugio@petsuite.cl' }, 'refugio')
    await call('GET', '/admin/ong', undefined, 'asesor')
    const perfil = { mision: 'Rescatamos perros y gatos abandonados de Chiloé.', necesidades: ['Alimento', 'Mantas'], donaciones: { banco: 'BancoEstado', tipo_cuenta: 'Cuenta Vista', numero: '123456', titular: 'Refugio Castro', rut: '65000111-2', correo: 'donaciones@refugio.cl' }, emblema: 'paw', color: 'calido' }
    await call('GET', '/ong/perfil', undefined, 'refugio')
    await call('PUT', '/ong/perfil', { perfil: { ...perfil, mision: 'Corta' } }, 'refugio')
    await call('PUT', '/ong/perfil', { perfil }, 'refugio')
    await call('PUT', '/ong/perfil', { perfil, enviar: true }, 'refugio')
    await call('GET', '/asesor/aprobaciones', undefined, 'asesor')
    await call('PATCH', `/asesor/ong-perfil/${refugio.id}`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/ong-perfil/${refugio.id}`, { decision: 'rechazar', motivo: 'corto' }, 'asesor')
    await call('PATCH', `/admin/ong/${refugio.id}/verificacion`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', '/admin/ong/no-existe/verificacion', { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/ong-perfil/${refugio.id}`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/ong-perfil/${refugio.id}`, { decision: 'aprobar' }, 'asesor')
    await call('GET', '/ong/perfil', undefined, 'refugio')
    await call('GET', '/admin/ong?estado=aprobada', undefined, 'admin')
    await call('GET', '/ongs')
    await call('GET', `/ongs/${patitas}`)
    await call('GET', `/ongs/${refugio.id}`)
    await call('GET', '/ongs/no-existe')
    await call('GET', '/correos/mios', undefined, 'refugio')
  })
  assert.ok(pasos > 60)
})

test('suite: sucursales, equipo, publicidad, convenios y canjes, cobranza, cuentas del asesor y privacidad', async () => {
  const pasos = await paridad(async (call, semilla) => {
    const shop = idDe(semilla.pymes, 'nombre_comercial', 'Huellitas Osorno')
    const vet = idDe(semilla.pymes, 'nombre_comercial', 'Clínica Veterinaria Sur')
    const pelu = idDe(semilla.pymes, 'nombre_comercial', 'Peluquería Canina Patagonia')
    const patitas = idDe(semilla.ongs, 'nombre', 'Patitas del Sur')
    const sucursalPm = idDe(semilla.sucursales, 'nombre', 'Huellitas Puerto Montt')
    const conveniosShop = semilla.convenios.find(c => c.codigo === 'PATITAS-HUELLITAS15').id
    await entrar(call, 'tutor', 'tutor2', 'tienda', 'veterinaria', 'peluqueria', 'jefe', 'clinico', 'ong', 'asesor', 'admin')

    // Sucursales.
    const sucursal = { nombre: 'Huellitas Valdivia', comuna_id: 2, direccion: 'Picarte 100', telefono: '+56 63 222', whatsapp: '+56 9 1111', horario: { 'lun-vie': '10:00-19:00', sab: '', dom: '' }, latitud: -39.81, longitud: -73.24 }
    await call('GET', `/pymes/${shop}/sucursales`, undefined, 'tienda')
    await call('GET', `/pymes/${shop}/sucursales`, undefined, 'jefe')
    await call('POST', `/pymes/${shop}/sucursales`, { ...sucursal, telefono: 'abc' }, 'tienda')
    await call('POST', `/pymes/${shop}/sucursales`, { ...sucursal, comuna_id: 99 }, 'tienda')
    const { data: valdivia } = await call('POST', `/pymes/${shop}/sucursales`, { ...sucursal, descripcion: 'Local nuevo', servicios: ['Despacho'] }, 'tienda')
    await call('POST', `/pymes/${shop}/sucursales`, sucursal, 'tienda')
    await call('POST', `/pymes/${pelu}/sucursales`, sucursal, 'peluqueria')
    await call('PUT', `/pymes/${shop}/sucursales/${valdivia.id}`, sucursal, 'jefe')
    await call('PUT', `/pymes/${shop}/sucursales/${sucursalPm}`, { ...sucursal, nombre: 'Huellitas Puerto Montt Centro' }, 'jefe')
    await call('DELETE', `/pymes/${shop}/sucursales/${sucursalPm}`, undefined, 'jefe')

    // Equipo.
    await call('GET', `/pymes/${shop}/equipo`, undefined, 'tienda')
    await call('POST', `/pymes/${shop}/equipo`, { nombre_visible: 'Vendedor', correo: 'vendedor@petsuite.cl', rol: 'clinico' }, 'tienda')
    await call('POST', `/pymes/${shop}/equipo`, { nombre_visible: 'Vendedor', correo: 'tutor@petsuite.cl', rol: 'jefe_local' }, 'tienda')
    await call('POST', `/pymes/${shop}/equipo`, { nombre_visible: 'Vendedor', correo: 'vendedor@petsuite.cl', rol: 'jefe_local', permisos: ['equipo'] }, 'tienda')
    await call('POST', `/pymes/${shop}/equipo`, { nombre_visible: 'Vendedor', correo: 'vendedor@petsuite.cl', rol: 'jefe_local', sucursal_id: 'otra' }, 'tienda')
    const { data: vendedor } = await call('POST', `/pymes/${shop}/equipo`, { nombre_visible: 'Vendedor', correo: 'Vendedor@petsuite.cl', rol: 'jefe_local', sucursal_id: valdivia.id, permisos: ['catalogo', 'convenios', 'catalogo'] }, 'tienda')
    await call('PATCH', `/pymes/${shop}/equipo/${vendedor.id}`, { permisos: [], sucursal_id: null }, 'tienda')
    await call('PATCH', `/pymes/${shop}/equipo/${vendedor.id}`, { permisos: ['pacientes'], sucursal_id: null }, 'tienda')
    await call('PATCH', `/pymes/${shop}/equipo/${vendedor.id}`, { permisos: ['convenios', 'metricas'], sucursal_id: null }, 'tienda')
    await call('GET', `/pymes/${shop}/sucursales`, undefined, 'tienda')
    await call('DELETE', `/pymes/${shop}/sucursales/${valdivia.id}`, undefined, 'tienda')
    await call('GET', `/pymes/${shop}/equipo`, undefined, 'tienda')
    await call('GET', '/correos/mios', undefined, 'tienda')
    // La invitación no trae clave: el integrante crea la suya con el enlace, que además confirma su correo.
    const invitacion = await call.token('vendedor@petsuite.cl', 'restablecer')
    await call.login('vendedor', 'vendedor@petsuite.cl', 'vendedor123')
    await call('POST', '/auth/restablecer', { token: invitacion, clave: 'vendedor123' })
    await call.login('vendedor', 'vendedor@petsuite.cl', 'vendedor123')
    await call('GET', '/pymes/mias', undefined, 'vendedor')
    await call('DELETE', `/pymes/${shop}/equipo/${vendedor.id}`, undefined, 'tienda')
    await call('DELETE', `/pymes/${shop}/equipo/${vendedor.id}`, undefined, 'tienda')
    await call('GET', '/pymes/mias', undefined, 'vendedor')
    await call.login('vendedor', 'vendedor@petsuite.cl', 'vendedor123')

    // Publicidad con aprobación del asesor.
    const banner = { titulo: 'Semana del gato', texto: 'Descuentos en arena y rascadores.', destino: 'perfil', ubicacion: 'directorio', desde: dia(0), hasta: dia(10) }
    await call('GET', `/pymes/${shop}/banners`, undefined, 'tienda')
    await call('POST', `/pymes/${shop}/banners`, banner, 'tienda')
    await call('POST', `/pymes/${vet}/banners`, { ...banner, hasta: dia(40) }, 'veterinaria')
    await call('POST', `/pymes/${vet}/banners`, { ...banner, desde: dia(-1) }, 'veterinaria')
    await call('POST', `/pymes/${vet}/banners`, { ...banner, destino: 'adopciones' }, 'veterinaria')
    await call('POST', `/pymes/${vet}/banners`, { ...banner, comuna_id: 99 }, 'veterinaria')
    await call('POST', `/pymes/${vet}/banners`, { ...banner, texto: 'Visita www.ejemplo.cl ahora' }, 'veterinaria')
    const { data: bannerVet } = await call('POST', `/pymes/${vet}/banners`, { ...banner, comuna_id: 1, tono: 'info' }, 'veterinaria')
    const { data: bannerVet2 } = await call('POST', `/pymes/${vet}/banners`, { ...banner, titulo: 'Vacunación gratis' }, 'veterinaria')
    await call('POST', `/pymes/${pelu}/banners`, banner, 'peluqueria')
    await call('POST', '/ong/banners', { ...banner, destino: 'adopciones', ubicacion: 'inicio' }, 'ong')
    const { data: bannersOng } = await call('GET', '/ong/banners', undefined, 'ong')
    await call('DELETE', `/ong/banners/${bannersOng[0].id}`, undefined, 'ong')
    await call('DELETE', `/ong/banners/${bannersOng[0].id}`, undefined, 'ong2')
    await call('POST', '/ong/banners', { ...banner, destino: 'adopciones', ubicacion: 'inicio' }, 'ong')
    await call('GET', '/asesor/aprobaciones', undefined, 'asesor')
    await call('PATCH', `/asesor/banners/${bannerVet.id}`, { decision: 'rechazar' }, 'asesor')
    await call('PATCH', `/asesor/banners/${bannerVet.id}`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/banners/${bannerVet.id}`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/banners/${bannerVet2.id}`, { decision: 'rechazar', motivo: 'El texto no corresponde al negocio.' }, 'asesor')
    await call('DELETE', `/pymes/${vet}/banners/${bannerVet2.id}`, undefined, 'veterinaria')
    await call('DELETE', `/pymes/${vet}/banners/${bannerVet2.id}`, undefined, 'tienda')
    await call('GET', '/banners?ubicacion=directorio&comuna=1')
    await call('GET', '/banners?ubicacion=directorio&comuna=2')
    await call('GET', '/banners')
    await call('POST', `/banners/${bannerVet.id}/clic`)
    await call('POST', `/banners/${bannerVet2.id}/clic`)
    await call('GET', `/pymes/${vet}/banners`, undefined, 'veterinaria')

    // Convenios Pyme–ONG, canjes y premio mensual.
    const convenio = { ong_id: patitas, titulo: 'Baño con 20 % de descuento', descuento_pct: 20, condiciones: 'Presenta el código al pagar.', desde: dia(0), hasta: dia(90) }
    await call('GET', `/pymes/${shop}/convenios`, undefined, 'tienda')
    await call('POST', `/pymes/${vet}/convenios`, { ...convenio, descuento_pct: 70 }, 'veterinaria')
    await call('POST', `/pymes/${vet}/convenios`, { ...convenio, ong_id: 'otra' }, 'veterinaria')
    await call('POST', `/pymes/${pelu}/convenios`, convenio, 'peluqueria')
    const { data: nuevoConvenio } = await call('POST', `/pymes/${vet}/convenios`, convenio, 'veterinaria')
    await call('POST', `/pymes/${vet}/convenios`, convenio, 'veterinaria')
    await call('GET', '/ong/convenios', undefined, 'ong')
    await call('PATCH', `/ong/convenios/${nuevoConvenio.id}`, { decision: 'aceptar' }, 'ong')
    await call('PATCH', `/ong/convenios/${nuevoConvenio.id}`, { decision: 'aceptar' }, 'ong')
    await call('PATCH', `/asesor/convenios/${nuevoConvenio.id}`, { decision: 'aprobar' }, 'asesor')
    await call('PATCH', `/asesor/convenios/${conveniosShop}`, { decision: 'rechazar', motivo: 'La ONG no ha confirmado la alianza.' }, 'asesor')
    await call('POST', `/pymes/${vet}/canjes`, { codigo: 'NO-EXISTE' }, 'veterinaria')
    await call('POST', `/pymes/${shop}/canjes`, { codigo: 'patitas-huellitas15' }, 'tienda')
    await call('POST', `/pymes/${vet}/canjes`, { codigo: 'patitas-sur10', sucursal_id: 'otra' }, 'veterinaria')
    await call('POST', `/pymes/${vet}/canjes`, { codigo: 'patitas-sur10' }, 'clinico')
    let premio = false
    for (let i = 0; i < 60 && !premio; i++) premio = (await call('POST', `/pymes/${vet}/canjes`, { codigo: 'patitas-sur10', monto_clp: 18000 }, 'veterinaria')).data.premio
    assert.ok(premio, 'el convenio llega a la meta del mes')
    await call('POST', `/pymes/${vet}/canjes`, { codigo: 'patitas-sur10' }, 'veterinaria')
    await call('GET', `/pymes/${vet}/convenios`, undefined, 'veterinaria')
    await call('POST', `/pymes/${vet}/convenios/${nuevoConvenio.id}/finalizar`, undefined, 'veterinaria')
    await call('POST', `/pymes/${vet}/convenios/${nuevoConvenio.id}/finalizar`, undefined, 'veterinaria')
    await call('GET', `/pymes/${vet}/metricas`, undefined, 'veterinaria')
    await call('GET', `/ongs/${patitas}`)
    await call('GET', '/ongs')
    await call('GET', `/pymes/${vet}`)

    // Cobranza con Orcob y cuentas creadas por el asesor.
    const { data: cartera } = await call('GET', '/asesor/cobranza', undefined, 'asesor')
    await call('POST', `/asesor/cobranza/${shop}/derivar`, undefined, 'asesor')
    const { data: caso } = await call('POST', `/asesor/cobranza/${pelu}/derivar`, undefined, 'asesor')
    await call('POST', `/asesor/cobranza/${pelu}/derivar`, undefined, 'asesor')
    await call('PATCH', `/asesor/cobranza/casos/${caso.id}`, { estado: 'reabierto' }, 'asesor')
    await call('PATCH', `/asesor/cobranza/casos/${caso.id}`, { estado: 'pagado' }, 'asesor')
    await call('PATCH', `/asesor/cobranza/casos/${caso.id}`, { estado: 'cerrado' }, 'asesor')
    await call('GET', '/asesor/cobranza', undefined, 'admin')
    assert.ok(cartera.length)
    await call('POST', '/asesor/cuentas', { tipo: 'pyme', correo: 'nuevo-negocio@petsuite.cl', nombre_visible: 'Nuevo Negocio', comuna_id: 99 }, 'asesor')
    await call('POST', '/asesor/cuentas', { tipo: 'pyme', correo: 'tienda@petsuite.cl', nombre_visible: 'Nuevo Negocio', comuna_id: 1 }, 'asesor')
    await call('POST', '/asesor/cuentas', { tipo: 'ong', correo: 'nuevo-refugio@petsuite.cl', nombre_visible: 'Nuevo Refugio', comuna_id: 2 }, 'asesor')
    await call('POST', '/asesor/cuentas', { tipo: 'pyme', correo: 'otro@petsuite.cl', nombre_visible: 'Otro', comuna_id: 1 }, 'tutor')
    await call('GET', '/admin/correos', undefined, 'asesor')
    await call('GET', '/correos/mios', undefined, 'peluqueria')

    // Privacidad (Ley 21.719): consentimientos, copia de datos, solicitudes y supresión.
    await call('GET', '/privacidad', undefined, 'tutor')
    await call('PATCH', '/privacidad/consentimientos', { comunicaciones: true, metricas: false }, 'tutor')
    await call('PATCH', '/privacidad/consentimientos', { comunicaciones: false }, 'tutor')
    // La cuenta del mock omite los campos que nunca se han usado; la base siempre los tiene.
    const sinVacios = datos => { if (!datos.cuenta.bloqueo_tratamiento) delete datos.cuenta.bloqueo_tratamiento; if (!datos.cuenta.suspension) delete datos.cuenta.suspension; return datos }
    await call('GET', '/privacidad/mis-datos', undefined, 'tutor', { comparar: sinVacios })
    await call('POST', '/privacidad/solicitudes', { derecho: 'olvido', detalle: 'Quiero que borren todo.' }, 'tutor')
    const { data: oposicion } = await call('POST', '/privacidad/solicitudes', { derecho: 'oposicion', detalle: 'No quiero recibir comunicaciones ni métricas.' }, 'tutor')
    await call('POST', '/privacidad/solicitudes', { derecho: 'oposicion', detalle: 'No quiero recibir comunicaciones ni métricas.' }, 'tutor')
    const { data: bloqueo } = await call('POST', '/privacidad/solicitudes', { derecho: 'bloqueo', detalle: 'Bloqueen el tratamiento de mis datos.' }, 'tutor')
    const { data: supresion } = await call('POST', '/privacidad/solicitudes', { derecho: 'supresion', detalle: 'Eliminen mi cuenta y mis datos.' }, 'tutor2')
    await call('GET', '/admin/privacidad', undefined, 'admin')
    await call('GET', '/admin/privacidad', undefined, 'asesor')
    await call('PATCH', `/admin/privacidad/${oposicion.id}`, { estado: 'respondida', respuesta: 'Ok' }, 'admin')
    await call('PATCH', `/admin/privacidad/${oposicion.id}`, { estado: 'en_proceso' }, 'admin')
    await call('PATCH', `/admin/privacidad/${oposicion.id}`, { estado: 'respondida', respuesta: 'Retiramos tus consentimientos opcionales.' }, 'admin')
    await call('PATCH', `/admin/privacidad/${oposicion.id}`, { estado: 'respondida', respuesta: 'Retiramos tus consentimientos opcionales.' }, 'admin')
    await call('PATCH', `/admin/privacidad/${bloqueo.id}`, { estado: 'respondida', respuesta: 'Bloqueamos el tratamiento de tus datos.' }, 'admin')
    await call('GET', '/privacidad', undefined, 'tutor')
    await call('GET', '/privacidad/mis-datos', undefined, 'tutor', { comparar: sinVacios })
    await call('GET', '/mascotas', undefined, 'tutor2')
    await call('PATCH', `/admin/privacidad/${supresion.id}`, { estado: 'respondida', respuesta: 'Eliminamos tu cuenta y tus datos personales.' }, 'admin')
    await call('GET', '/mascotas', undefined, 'tutor2')
    await call.login('tutor2', 'tutor2@petsuite.cl')
    await call('GET', '/admin/usuarios?q=eliminado', undefined, 'admin')
    await call('GET', '/admin/privacidad', undefined, 'admin')
  })
  assert.ok(pasos > 120)
})

// Toda ruta del API debe aparecer en algún guion: una ruta nueva sin prueba de paridad hace fallar esta prueba.
test('cobertura: cada ruta del API se compara con el mock', async () => {
  const { routes } = await import('./core.ts')
  const coincide = (patron, ruta) => {
    const a = patron.split('/'), b = ruta.split('/')
    return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i])
  }
  const usadas = new Set()
  for (const llamada of llamadas) {
    const [method, ruta] = llamada.split(' ')
    const r = routes.find(([m, patron]) => m === method && coincide(patron, ruta))
    if (r) usadas.add(`${r[0]} ${r[1]}`)
  }
  const faltan = routes.map(([m, patron]) => `${m} ${patron}`).filter(r => !usadas.has(r))
  assert.deepEqual(faltan, [], 'rutas sin guion de paridad')
})
