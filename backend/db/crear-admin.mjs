// Crea las cuentas internas de una base real (sin cuentas demo): el administrador y los asesores. Son los únicos roles
// sin registro público ni invitación desde la app. Muestra el enlace para crear la contraseña.
// Uso: npm run db:crear-admin -- correo@dominio.cl Nombre visible
//      npm run db:crear-asesor -- correo@dominio.cl Nombre visible
// npm lee .env; contra otra base: node --env-file=.env.production.local backend/db/crear-admin.mjs [--asesor] correo Nombre
// El enlace se imprime en esta terminal y vence en 7 días: el de un asesor se le entrega solo a esa persona.
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { createPool } from './pool.mjs'

const { VIGENCIA_HORAS, enlaceCuenta } = await import('../../src/shared/cuentas.ts')

/** Lee `[--asesor] correo Nombre visible`. */
export function leerArgumentos(args) {
  const asesor = args[0] === '--asesor'
  const [correo, ...nombre] = asesor ? args.slice(1) : args
  return { rol: asesor ? 'asesor' : 'admin', correo, nombre: nombre.join(' ') }
}

/** Inserta la cuenta (sin clave conocida, correo sin confirmar) y su invitación; devuelve el enlace. */
export async function crearAdmin(client, correo, nombre, base = process.env.APP_URL || 'http://localhost:5173/', rol = 'admin') {
  correo = correo.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('Correo inválido')
  if (!nombre.trim()) throw new Error('Falta el nombre visible')
  const { rows } = await client.query('select 1 from usuarios where lower(correo) = $1', [correo])
  if (rows.length) throw new Error('Ese correo ya tiene una cuenta')
  const token = randomBytes(16).toString('hex')
  await client.query('begin')
  try {
    const { rows: [u] } = await client.query("insert into usuarios (correo, clave_hash, rol, nombre_visible, estado) values ($1, $2, $3, $4, 'activo') returning id",
      [correo, await bcrypt.hash(randomBytes(32).toString('hex'), 10), rol, nombre.trim()])
    await client.query("insert into tokens_cuenta (usuario_id, tipo, token_hash, expira_en) values ($1, 'invitacion', decode($2, 'hex'), $3)",
      [u.id, createHash('sha256').update(token).digest('hex'), new Date(Date.now() + VIGENCIA_HORAS.invitacion * 3_600_000).toISOString()])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  return enlaceCuenta(base, 'invitacion', token)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { rol, correo, nombre } = leerArgumentos(process.argv.slice(2))
  const asesor = rol === 'asesor'
  let pool, client
  try {
    if (!correo || !nombre) throw new Error(`Uso: npm run db:crear-${rol} -- correo@dominio.cl Nombre visible`)
    pool = createPool(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL)
    client = await pool.connect()
    const enlace = await crearAdmin(client, correo, nombre, undefined, rol)
    const dias = VIGENCIA_HORAS.invitacion / 24
    console.log(`Cuenta de ${asesor ? 'asesor' : 'administrador'} creada para ${correo.trim().toLowerCase()}.\n${asesor ? `Entrégale este enlace solo a esa persona para que cree su contraseña (vence en ${dias} días):` : `Abre este enlace para crear la contraseña (vence en ${dias} días; no lo compartas):`}\n${enlace}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    client?.release()
    await pool?.end()
  }
}
