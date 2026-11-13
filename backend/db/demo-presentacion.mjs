// Datos de demostración para presentar PetSuite en la versión real, sin tocar los datos reales.
//
//   node --env-file=.env.production.local backend/db/demo-presentacion.mjs --clave "<clave de 10 o más caracteres>"
//   node --env-file=.env.production.local backend/db/demo-presentacion.mjs --clave "<clave>" --aplicar
//   node --env-file=.env.production.local backend/db/demo-presentacion.mjs --quitar [--aplicar]
//
// Sin --aplicar es una simulación: muestra qué haría y no escribe nada.
// - Carga los datos del seed del mock (los mismos de la demo de GitHub Pages) con otras direcciones: todas las cuentas
//   terminan en @demo.petsuite.space, no reciben correos reales y usan la clave que se pasa al ejecutar.
// - No crea administradores ni asesores: tendrían acceso a los datos reales. La revisión se hace con la cuenta real
//   del administrador.
// - Los negocios y las ONG llevan «(demo)» en el nombre, porque se ven en el sitio público.
// - --quitar borra exactamente lo creado: las cuentas del dominio de demostración y todo lo que depende de ellas.
import { pathToFileURL } from 'node:url'
import { createPool } from './pool.mjs'
import { datosDemo, filas, insertar } from './seed.mjs'
import { DOMINIO_DEMO, SUFIJO_DEMO } from '../../src/shared/demo.ts'

const ROLES_EXCLUIDOS = new Set(['admin', 'asesor'])
// Columnas que apuntan a un usuario y aceptan null: si el usuario no se carga (admin o asesor), quedan vacías.
const OPCIONALES = new Set(['revisado_por', 'aplicada_por', 'subido_por'])
const uid = () => crypto.randomUUID()

/** Transforma la demo del mock en datos aptos para la base real. Devuelve las filas por tabla y las cuentas. */
export async function prepararDemo(db, clave) {
  const excluidos = new Set(db.usuarios.filter(u => ROLES_EXCLUIDOS.has(u.rol)).map(u => u.id))
  const correos = new Map(db.usuarios.map(u => [u.correo, u.correo.replace(/@.*$/, `@${DOMINIO_DEMO}`)]))
  db.usuarios = db.usuarios.filter(u => !excluidos.has(u.id)).map(u => ({ ...u, correo: correos.get(u.correo), clave }))
  for (const p of db.pymes) Object.assign(p, { nombre_comercial: p.nombre_comercial + SUFIJO_DEMO, descripcion: `Negocio ficticio para la demostración de PetSuite. ${p.descripcion ?? ''}`.trim() })
  for (const o of db.ongs) Object.assign(o, { nombre: o.nombre + SUFIJO_DEMO, contacto: correos.get(o.contacto) ?? o.contacto })
  // En la versión real no hay Orcob: los pagos de la demo figuran como transferencias.
  for (const pg of db.pagos) if (pg.canal === 'orcob') Object.assign(pg, { canal: 'transferencia', codigo_orcob: null, referencia: 'DEMO' })
  // La bandeja del mock menciona las claves de la demo, y la cobranza la deriva el asesor: no se cargan.
  db.correos = []
  db.casos_cobranza = []

  // Un negocio en verificación, sin documentos, para mostrar en vivo la subida y la revisión de documentos.
  const base = db.usuarios.find(u => u.rol === 'pyme')
  const nuevo = { ...base, id: uid(), correo: `nuevo@${DOMINIO_DEMO}`, nombre_visible: 'Carla Díaz', comuna_id: 2, creado_en: new Date().toISOString(), consentimientos: base.consentimientos }
  db.usuarios.push(nuevo)
  db.pymes.push({
    id: uid(), propietario_id: nuevo.id, nombre_comercial: `Forrajería Los Lagos${SUFIJO_DEMO}`, rut_empresa: '76888999-1', rubro: 'tienda',
    descripcion: 'Negocio ficticio para la demostración de PetSuite: alimento y accesorios en Puerto Montt.', comuna_id: 2, direccion: 'Avenida Presidente Ibáñez 1200, Puerto Montt',
    latitud: null, longitud: null, telefono: null, whatsapp: null, horario: {}, servicios: ['Alimento', 'Accesorios'], estado_verificacion: 'pendiente', origen: 'registro', fuente: null, creado_en: new Date().toISOString(),
  })

  agregarActividad(db)

  // Las solicitudes de adopción y otros textos pueden guardar un correo de la demo como contacto.
  const conCorreo = v => typeof v === 'string' && correos.has(v) ? correos.get(v) : v
  const tablas = []
  const descartadas = {}
  for (const [tabla, datos] of await filas(db)) {
    const limpias = []
    for (const fila of datos) {
      let descartar = false
      const nueva = {}
      for (const [k, v] of Object.entries(fila)) {
        if (typeof v === 'string' && excluidos.has(v)) { if (OPCIONALES.has(k)) nueva[k] = null; else descartar = true }
        else nueva[k] = conCorreo(v)
      }
      if (descartar) descartadas[tabla] = (descartadas[tabla] ?? 0) + 1
      else limpias.push(nueva)
    }
    if (limpias.length) tablas.push([tabla, limpias])
  }
  const cuentas = db.usuarios.map(u => ({ correo: u.correo, rol: u.rol, nombre: u.nombre_visible }))
  return { tablas, cuentas, descartadas }
}

/**
 * Actividad de los últimos 60 días para que los KPI de negocio tengan datos en la presentación: visitas al perfil
 * (más por la tarde y más después del inicio de un convenio con una ONG), vistas de productos y clics de contacto.
 * Es determinista, así cada carga muestra las mismas cifras.
 */
function agregarActividad(db) {
  let semilla = 7
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647 }
  const HORAS = [9, 10, 11, 12, 13, 13, 15, 16, 17, 18, 18, 19, 19, 19, 20, 20, 21]
  const DIA = 86_400_000, ahora = Date.now()
  for (const p of db.pymes.filter(x => x.estado_verificacion === 'aprobada')) {
    const items = db.catalogo.filter(i => i.pyme_id === p.id)
    const inicioCampana = db.convenios.filter(c => c.pyme_id === p.id && c.estado === 'activo').map(c => new Date(`${c.desde}T00:00:00-03:00`).getTime()).sort()[0]
    for (let d = 59; d >= 0; d--) {
      const dia = ahora - d * DIA
      const visitas = Math.round(4 + azar() * 5 + (inicioCampana && dia >= inicioCampana ? 3 : 0))
      for (let v = 0; v < visitas; v++) {
        const h = HORAS[Math.floor(azar() * HORAS.length)]
        const t = new Date(dia - (dia % DIA) + (h + 3) * 3_600_000 + Math.floor(azar() * 3_600_000))
        if (t.getTime() > ahora) continue
        const ocurrido_en = t.toISOString()
        db.eventos.push({ id: uid(), pyme_id: p.id, item_id: null, tipo: 'visita_perfil', ocurrido_en })
        if (items.length && azar() < 0.5) { const it = items[Math.floor(azar() * items.length)]; db.eventos.push({ id: uid(), pyme_id: p.id, item_id: it.id, tipo: 'vista_item', ocurrido_en }) }
        const r = azar()
        if (r < 0.08) db.eventos.push({ id: uid(), pyme_id: p.id, item_id: null, tipo: 'clic_contacto', ocurrido_en })
        else if (r < 0.15) db.eventos.push({ id: uid(), pyme_id: p.id, item_id: null, tipo: 'clic_whatsapp', ocurrido_en })
      }
    }
  }
}

const existeDemo = async client => (await client.query('select count(*)::int as n from usuarios where lower(correo) like $1', [`%@${DOMINIO_DEMO}`])).rows[0].n

/** Carga la demo en una transacción. Se niega si ya hay cuentas de demostración. */
export async function cargarDemoReal(client, clave, { aplicar = false, log = console.log } = {}) {
  if (!clave || clave.length < 10) throw new Error('Indica una clave de 10 o más caracteres con --clave "…" (será la de todas las cuentas de demostración).')
  if (await existeDemo(client)) throw new Error(`Ya hay cuentas @${DOMINIO_DEMO}. Quítalas primero con --quitar --aplicar.`)
  const { tablas, cuentas, descartadas } = await prepararDemo(await datosDemo(), clave)
  log(`${aplicar ? 'Cargando' : 'Simulación (sin --aplicar no se escribe nada)'}:`)
  log(tablas.map(([t, d]) => `  ${t}: ${d.length}`).join('\n'))
  if (Object.keys(descartadas).length) log(`Filas del administrador o el asesor de la demo que no se cargan: ${JSON.stringify(descartadas)}`)
  if (aplicar) {
    await client.query('begin')
    try {
      for (const [tabla, datos] of tablas) await insertar(client, tabla, datos)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
  log(`\nCuentas de demostración (clave: la que indicaste):\n${cuentas.map(c => `  ${c.correo.padEnd(34)} ${c.rol.padEnd(11)} ${c.nombre}`).join('\n')}`)
  return { tablas: Object.fromEntries(tablas.map(([t, d]) => [t, d.length])), cuentas }
}

// Claves foráneas de una columna: tabla hija, columna, tabla madre y acción al borrar.
const CLAVES = `select c.conrelid::regclass::text as hija, a.attname as columna, c.confrelid::regclass::text as madre, c.confdeltype as accion
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace`

/**
 * Borra las cuentas de demostración y todo lo que depende de ellas, de las hojas a la raíz, siguiendo las claves
 * foráneas de la base. Las columnas que quedan en null al borrar (on delete set null) se dejan a la base.
 */
export async function quitarDemoReal(client, { aplicar = false, log = console.log } = {}) {
  const claves = (await client.query(CLAVES)).rows
  const conId = new Set((await client.query("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id'")).rows.map(r => r.table_name))
  const plan = new Map() // tabla → ids a borrar (o filas sin id, por condición)
  const sinId = [] // [tabla, columna, ids de la madre]
  const visitar = async (tabla, ids) => {
    if (!ids.length) return
    const ya = plan.get(tabla) ?? new Set()
    const nuevos = ids.filter(id => !ya.has(id))
    if (!nuevos.length) return
    for (const id of nuevos) ya.add(id)
    plan.set(tabla, ya)
    for (const k of claves.filter(x => x.madre === tabla && x.accion !== 'n')) {
      if (conId.has(k.hija)) await visitar(k.hija, (await client.query(`select id from ${k.hija} where ${k.columna} = any($1)`, [nuevos])).rows.map(r => r.id))
      else sinId.push([k.hija, k.columna, nuevos])
    }
  }
  const raiz = (await client.query('select id from usuarios where lower(correo) like $1', [`%@${DOMINIO_DEMO}`])).rows.map(r => r.id)
  await visitar('usuarios', raiz)
  const correos = (await client.query('select count(*)::int as n from correos where lower(para) like $1', [`%@${DOMINIO_DEMO}`])).rows[0].n
  log(`${aplicar ? 'Quitando' : 'Simulación (sin --aplicar no se borra nada)'}:`)
  log([...plan].map(([t, ids]) => `  ${t}: ${ids.size}`).join('\n') + `\n  correos de la bandeja: ${correos}`)
  if (!aplicar) return Object.fromEntries([...plan].map(([t, ids]) => [t, ids.size]))
  // Orden: primero lo que nadie referencia. Se repite hasta vaciar el plan (las restricciones definen el orden).
  await client.query('begin')
  try {
    for (const [tabla, columna, ids] of sinId) await client.query(`delete from ${tabla} where ${columna} = any($1)`, [ids])
    const pendientes = new Map([...plan].map(([t, ids]) => [t, [...ids]]))
    for (let vuelta = 0; pendientes.size && vuelta < 50; vuelta++) {
      for (const [tabla, ids] of pendientes) {
        await client.query('savepoint intento')
        try {
          await client.query(`delete from ${tabla} where id = any($1)`, [ids])
          await client.query('release savepoint intento')
          pendientes.delete(tabla)
        } catch (error) {
          if (error.code !== '23503') throw error // otra cosa que una referencia pendiente
          await client.query('rollback to savepoint intento')
        }
      }
    }
    if (pendientes.size) throw new Error(`No se pudo borrar: ${[...pendientes.keys()].join(', ')}`)
    await client.query('delete from correos where lower(para) like $1', [`%@${DOMINIO_DEMO}`])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  log('Listo: no quedan datos de demostración.')
  return Object.fromEntries([...plan].map(([t, ids]) => [t, ids.size]))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const valor = nombre => { const i = args.indexOf(nombre); return i >= 0 ? args[i + 1] : undefined }
  let pool, client
  try {
    pool = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
    client = await pool.connect()
    if (args.includes('--quitar')) await quitarDemoReal(client, { aplicar: args.includes('--aplicar') })
    else await cargarDemoReal(client, valor('--clave'), { aplicar: args.includes('--aplicar') })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    client?.release()
    await pool?.end()
  }
}

