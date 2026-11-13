// Carga en PostgreSQL los datos de demostración del mock (seed de src/mock/db.ts), con las claves cifradas con bcrypt.
// Uso: npm run db:seed (base vacía) o npm run db:seed -- --reset (borra todos los datos y vuelve a cargar la demo).
// La demo sale del mismo seed que usa el navegador, así ambos modos muestran las mismas cuentas y datos.
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { createPool } from './pool.mjs'

registerHooks({ resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && !context.parentURL?.includes('/node_modules/')) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
  }
  return nextResolve(specifier, context)
} })

// Tablas que crean las migraciones; el reinicio nunca las borra.
const REFERENCIA = ['comunas', 'planes', 'schema_migrations']
const RONDAS_BCRYPT = 10

/** Genera la demo en memoria con el seed del mock, sin tocar el almacenamiento del navegador. */
export async function datosDemo() {
  const values = new Map()
  globalThis.localStorage ??= { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const mock = await import('../../src/mock/db.ts')
  mock.resetDemo()
  return mock.db
}

/** Traduce cada colección del mock a las filas de su tabla, en orden de dependencias. */
export async function filas(db) {
  const usuarios = await Promise.all(db.usuarios.map(async u => ({
    id: u.id, correo: u.correo, clave_hash: await bcrypt.hash(u.clave, RONDAS_BCRYPT), rol: u.rol, nombre_visible: u.nombre_visible,
    comuna_id: u.comuna_id, estado: u.estado, bloqueo_tratamiento: u.bloqueo_tratamiento ?? false, creado_en: u.creado_en,
    correo_verificado_en: u.correo_verificado_en ?? null,
  })))
  return [
    ['usuarios', usuarios],
    ['consentimientos', db.usuarios.flatMap(u => (u.consentimientos ?? []).map(c => ({ usuario_id: u.id, ...c })))],
    ['suspensiones', db.usuarios.filter(u => u.suspension).map(u => ({ usuario_id: u.id, ...u.suspension }))],
    ['mascotas', db.mascotas],
    ['medallas', db.medallas],
    ['escaneos', db.escaneos.map(({ id: _, ...e }) => e)],
    ['mensajes_qr', db.mensajes],
    // Las fichas públicas del mock tienen dueño y RUT vacíos; en la base son null.
    ['pymes', db.pymes.map(p => ({ ...p, propietario_id: p.propietario_id || null, rut_empresa: p.rut_empresa || null }))],
    ['accesos', db.accesos],
    ['sucursales', db.sucursales],
    ['miembros', db.miembros],
    ['contactos_pymes', db.contactos_pymes],
    ['items_catalogo', db.catalogo.map(({ oferta, ...i }) => ({ ...i, oferta_precio_clp: oferta?.precio_clp ?? null, oferta_desde: oferta?.desde ?? null, oferta_hasta: oferta?.hasta ?? null }))],
    ['eventos_pyme', db.eventos.map(({ id: _, ...e }) => e)],
    ['suscripciones', db.suscripciones],
    ['pagos', db.pagos],
    ['casos_cobranza', db.casos_cobranza],
    ['ongs', db.ongs],
    ['animales', db.animales],
    ['solicitudes_adopcion', db.solicitudes],
    ['eventos_adopcion', db.eventos_adopcion.map(({ id: _, ...e }) => e)],
    ['publicaciones', db.publicaciones],
    ['comentarios', db.comentarios],
    ['reacciones', db.reacciones],
    ['guardados', db.guardados],
    ['reportes', db.reportes.map(({ objeto_id, ...r }) => ({ ...r, publicacion_id: r.objeto_tipo === 'publicacion' ? objeto_id : null, comentario_id: r.objeto_tipo === 'comentario' ? objeto_id : null }))],
    ['banners', db.banners.map(({ autor_id, ...b }) => ({ ...b, pyme_id: b.autor_tipo === 'pyme' ? autor_id : null, ong_id: b.autor_tipo === 'ong' ? autor_id : null }))],
    ['convenios', db.convenios.map(({ premios: _, ...c }) => c)],
    ['premios_convenio', db.convenios.flatMap(c => c.premios.map(p => ({ convenio_id: c.id, ...p })))],
    ['canjes', db.canjes],
    ['correos', db.correos],
    ['solicitudes_privacidad', db.solicitudes_privacidad],
    ['imagenes', db.imagenes.map(i => ({ ...i, datos: Buffer.from(i.datos, 'base64') }))],
    // En la demo, un documento grande se guarda sin su contenido: en la base queda un byte, para respetar la restricción.
    ['documentos_pyme', (db.documentos ?? []).map(d => ({ ...d, datos: d.datos ? Buffer.from(d.datos, 'base64') : Buffer.alloc(1) }))],
  ]
}

// Inserta por lotes. Un campo del mock sin columna en la tabla hace fallar la carga: así se nota si el modelo se desalinea.
export async function insertar(client, tabla, datos) {
  const columnas = [...new Set(datos.flatMap(Object.keys))]
  for (let i = 0; i < datos.length; i += 200) {
    const params = []
    const valores = datos.slice(i, i + 200).map(f => `(${columnas.map(c => { params.push(f[c] ?? null); return `$${params.length}` }).join(', ')})`)
    await client.query(`insert into ${tabla} (${columnas.join(', ')}) values ${valores.join(', ')}`, params)
  }
}

/** Carga la demo en una transacción. Sin reset, se niega a tocar una base que ya tiene usuarios. */
export async function seedDemo(client, opciones = {}) {
  return cargarDemo(client, await datosDemo(), opciones)
}

/** Carga unos datos con la forma del mock (las pruebas usan los del propio mock, con los mismos ids). */
export async function cargarDemo(client, demo, { reset = false, log = console.log } = {}) {
  const { rows: [{ hay }] } = await client.query('select exists (select 1 from usuarios) as hay')
  if (hay && !reset) throw new Error('La base ya tiene datos. Para borrarlos y cargar la demo: npm run db:seed -- --reset')
  const tablas = (await filas(demo)).filter(([, datos]) => datos.length)
  await client.query('begin')
  try {
    if (reset) {
      const { rows } = await client.query(`select tablename from pg_tables where schemaname = 'public' and tablename not in (${REFERENCIA.map(t => `'${t}'`).join(', ')})`)
      await client.query(`truncate ${rows.map(r => `public."${r.tablename}"`).join(', ')} restart identity cascade`)
    }
    for (const [tabla, datos] of tablas) await insertar(client, tabla, datos)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  log(tablas.map(([tabla, datos]) => `${tabla}: ${datos.length}`).join('\n'))
  return Object.fromEntries(tablas.map(([tabla, datos]) => [tabla, datos.length]))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool, client
  try {
    pool = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
    client = await pool.connect()
    await seedDemo(client, { reset: process.argv.includes('--reset') })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    client?.release()
    await pool?.end()
  }
}
