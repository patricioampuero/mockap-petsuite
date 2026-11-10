// Carga fichas con información pública: negocios reales que aún no se inscriben en PetSuite. Aparecen en Explorar en
// gris, sin sello ni catálogo, con su nombre, dirección, teléfono y rubro públicos, hasta que su dueño las reclame.
// Uso: npm run db:cargar-fichas -- backend/db/fichas/los-lagos.json            (simulación: no escribe nada)
//      npm run db:cargar-fichas -- backend/db/fichas/los-lagos.json --aplicar  (carga las que falten)
// npm lee .env (demo); contra la base real: node --env-file=.env.production.local backend/db/cargar-fichas.mjs <json> [--aplicar]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { createPool } from './pool.mjs'

const telefono = z.string().trim().regex(/^\+56\d{8,9}$/, 'Teléfono en formato +56 seguido de 8 o 9 dígitos').nullable().default(null)
const ficha = z.object({
  nombre: z.string().trim().min(2).max(100),
  rubro: z.enum(['veterinaria', 'tienda', 'peluqueria', 'otro']),
  comuna: z.string().trim().min(2),
  direccion: z.string().trim().min(3).max(200),
  // Solo con un punto exacto (por ejemplo, el del local en OpenStreetMap). Sin él, la ficha aparece en la lista sin pin
  // y «Cómo llegar» busca la dirección escrita: un punto aproximado llevaría a otra cuadra.
  latitud: z.number().min(-56).max(-17).nullable().default(null),
  longitud: z.number().min(-110).max(-66).nullable().default(null),
  telefono,
  whatsapp: telefono,
  fuente: z.string().trim().min(5).max(500),
})
  .refine(f => (f.latitud === null) === (f.longitud === null), 'Latitud y longitud van juntas')
const archivo = z.object({ fichas: z.array(ficha).min(1) })

// Mismo nombre en la misma comuna = mismo negocio (sin tildes, mayúsculas ni signos).
const clave = (nombre, comunaId) => `${comunaId}:${nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`

/** Valida el archivo y, con aplicar, inserta las fichas que falten en una transacción. Devuelve el resumen. */
export async function cargarFichas(client, datos, { aplicar = false, log = console.log } = {}) {
  const { fichas } = archivo.parse(datos)
  const { rows: comunas } = await client.query('select id, nombre from comunas')
  const comunaId = new Map(comunas.map(c => [c.nombre.toLowerCase(), c.id]))
  const { rows: existentes } = await client.query('select nombre_comercial, comuna_id from pymes')
  const vistos = new Set(existentes.map(p => clave(p.nombre_comercial, p.comuna_id)))
  const nuevas = [], omitidas = []
  for (const f of fichas) {
    const id = comunaId.get(f.comuna.toLowerCase())
    if (!id) throw new Error(`Comuna desconocida en «${f.nombre}»: ${f.comuna}`)
    const k = clave(f.nombre, id)
    if (vistos.has(k)) { omitidas.push(f.nombre); continue }
    vistos.add(k)
    nuevas.push({ ...f, comuna_id: id })
  }
  for (const f of nuevas) log(`${aplicar ? 'Carga' : 'Cargaría'}: ${f.nombre} · ${f.rubro} · ${f.comuna}`)
  for (const nombre of omitidas) log(`Ya existe, se omite: ${nombre}`)
  if (aplicar && nuevas.length) {
    await client.query('begin')
    try {
      for (const f of nuevas) {
        await client.query(`insert into pymes (nombre_comercial, rubro, comuna_id, direccion, latitud, longitud, telefono, whatsapp, estado_verificacion, origen, fuente)
          values ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', 'publica', $9)`,
        [f.nombre, f.rubro, f.comuna_id, f.direccion, f.latitud, f.longitud, f.telefono, f.whatsapp, f.fuente])
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
  return { nuevas: nuevas.length, omitidas: omitidas.length }
}

/** Quita una ficha pública (por ejemplo, si el negocio lo pide). Nunca toca un negocio inscrito por su dueño. */
export async function quitarFicha(client, nombre, comuna) {
  const { rows } = await client.query(`delete from pymes p using comunas c where c.id = p.comuna_id and p.origen = 'publica'
    and lower(p.nombre_comercial) = lower($1) and lower(c.nombre) = lower($2) returning p.id`, [nombre.trim(), comuna.trim()])
  return rows.length
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const ruta = args.find(a => !a.startsWith('--')), aplicar = args.includes('--aplicar')
  let pool, client
  try {
    if (!ruta) throw new Error('Uso: npm run db:cargar-fichas -- backend/db/fichas/<archivo>.json [--aplicar]')
    pool = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
    client = await pool.connect()
    const r = await cargarFichas(client, JSON.parse(readFileSync(ruta, 'utf8')), { aplicar })
    console.log(aplicar ? `Listo: ${r.nuevas} fichas cargadas, ${r.omitidas} ya existían.` : `Simulación: se cargarían ${r.nuevas} fichas (${r.omitidas} ya existen). Agrega --aplicar para cargarlas.`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    client?.release()
    await pool?.end()
  }
}
