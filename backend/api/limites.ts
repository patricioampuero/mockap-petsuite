// Límites de solicitudes del API (reglas en src/shared/limites.ts, iguales a las del mock).
// Cada paso corre en su propia transacción: un intento fallido queda registrado aunque la ruta se deshaga.
import { createHash } from 'node:crypto'
import { ApiError } from '../../src/shared/errors'
import { mensajeDemasiados, STATUS_DEMASIADOS, type Limite, type Regla } from '../../src/shared/limites'
import { now } from './core'
import type { Database } from './db'

// En hexadecimal y con decode() en la consulta, como token_hash: funciona igual con pg y con PGlite.
const huella = (clave: string) => createHash('sha256').update(clave).digest('hex')
const desde = (segundos: number) => new Date(Date.now() - segundos * 1000).toISOString()

// Si la versión se publica antes de aplicar la migración 006, la tabla no existe (42P01): el API sigue
// atendiendo sin límites en vez de dejar a todos sin poder ingresar, y lo deja anotado en el registro.
async function sinTablaNoBloquea(paso: () => Promise<void>) {
  try { await paso() } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error
    console.error('Límites de solicitudes desactivados: falta aplicar la migración 006 (tabla limites_solicitudes).')
  }
}

/** Responde 429 si alguna regla ya llegó a su máximo dentro de su ventana. */
export async function verificarLimites(database: Database, limite: Limite) {
  let bloqueo: Regla | undefined
  await sinTablaNoBloquea(() => database.tx(async sql => {
    for (const r of limite.reglas) {
      const [{ n }] = await sql<{ n: string }>("select count(*) as n from limites_solicitudes where clave_hash = decode($1, 'hex') and ocurrido_en > $2", [huella(r.clave), desde(r.segundos)])
      if (Number(n) >= r.max) { bloqueo = r; return }
    }
  }))
  if (bloqueo) throw new ApiError(mensajeDemasiados(bloqueo.segundos), STATUS_DEMASIADOS)
}

/** Suma un evento a cada regla y borra los eventos que ya no cuentan para ninguna ventana. */
export async function registrarEvento(database: Database, limite: Limite) {
  await sinTablaNoBloquea(() => database.tx(async sql => {
    const ahora = now()
    for (const r of limite.reglas) await sql("insert into limites_solicitudes (clave_hash, ocurrido_en) values (decode($1, 'hex'), $2)", [huella(r.clave), ahora])
    await sql('delete from limites_solicitudes where ocurrido_en < $1', [desde(2 * 86_400)])
  }))
}

/** Tras un ingreso correcto se olvidan los intentos fallidos de esa cuenta desde ese cliente. */
export async function limpiarClave(database: Database, clave: string) {
  await sinTablaNoBloquea(() => database.tx(async sql => { await sql("delete from limites_solicitudes where clave_hash = decode($1, 'hex')", [huella(clave)]) }))
}
