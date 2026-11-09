// Cuentas, sesiones y permisos. El token de sesión solo lo conoce el cliente: la base guarda su SHA-256.
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { ENLACE_INVALIDO, VIGENCIA_HORAS, enlaceCuenta, type TipoToken } from '../../src/shared/cuentas'
import { PERMISOS_ADMIN, PERMISOS_ASESOR, PERMISOS_DUENO, type Rol } from '../../src/shared/permissions'
import { fail, now, uid, una, type Req } from './core'
import type { Sql } from './db'

export type Usuario = {
  id: string; correo: string; rol: Rol; nombre_visible: string; comuna_id: number | null
  estado: 'activo' | 'suspendido' | 'eliminado'; bloqueo_tratamiento: boolean; creado_en: string
}
export const USUARIO = 'u.id, u.correo, u.rol, u.nombre_visible, u.comuna_id, u.estado, u.bloqueo_tratamiento, u.creado_en'

const DIAS_SESION = 30
const RONDAS_BCRYPT = 10
// Hash de una clave que nadie tiene: comparar contra él iguala el tiempo de respuesta cuando el correo no existe.
const HASH_FALSO = bcrypt.hashSync('petsuite-sin-cuenta', RONDAS_BCRYPT)

const huella = (token: string) => createHash('sha256').update(token).digest('hex')
export const cifrarClave = (clave: string) => bcrypt.hash(clave, RONDAS_BCRYPT)
export const claveCorrecta = (clave: string, hash: string | null | undefined) => bcrypt.compare(clave, hash ?? HASH_FALSO)

export async function crearSesion(sql: Sql, usuarioId: string) {
  const token = randomBytes(32).toString('base64url')
  await sql("insert into sesiones (token_hash, usuario_id, creada_en, expira_en) values (decode($1, 'hex'), $2, $3, $4)",
    [huella(token), usuarioId, now(), new Date(Date.now() + DIAS_SESION * 86_400_000).toISOString()])
  return token
}
export const cerrarSesiones = (sql: Sql, usuarioId: string) => sql('delete from sesiones where usuario_id = $1', [usuarioId])

// Una suspensión temporal vencida se levanta al usar la cuenta, como refreshSuspension del mock. Sin usuario, revisa todas.
export async function levantarVencidas(sql: Sql, usuarioId?: string) {
  const params: unknown[] = [now()]
  if (usuarioId) params.push(usuarioId)
  await sql(`with s as (
      update suspensiones set levantada_en = $1
      where levantada_en is null and tipo = 'temporal' and hasta <= $1 ${usuarioId ? 'and usuario_id = $2' : ''}
      returning usuario_id)
    update usuarios set estado = 'activo' where estado = 'suspendido' and id in (select usuario_id from s)`, params)
}

export async function usuarioPorId(sql: Sql, id: string) {
  return una<Usuario>(sql, `select ${USUARIO} from usuarios u where u.id = $1`, [id])
}

// La sesión se resuelve una vez por solicitud aunque la ruta consulte auth varias veces.
const sesiones = new WeakMap<Req, Promise<Usuario | undefined>>()
async function usuarioDeSesion(req: Req) {
  let u = await una<Usuario>(req.sql, `select ${USUARIO} from sesiones s join usuarios u on u.id = s.usuario_id where s.token_hash = decode($1, 'hex') and s.expira_en > $2`,
    [huella(req.session!.token), now()])
  if (u?.estado === 'suspendido') {
    await levantarVencidas(req.sql, u.id)
    u = await usuarioPorId(req.sql, u.id)
  }
  return u
}

// RBAC: sin token válido 401; cuenta suspendida o rol distinto 403.
export async function auth(req: Req, ...roles: Rol[]): Promise<Usuario> {
  if (!req.session) return fail(401, 'Sesión requerida')
  let pendiente = sesiones.get(req)
  if (!pendiente) sesiones.set(req, pendiente = usuarioDeSesion(req))
  const u = await pendiente
  if (!u) return fail(401, 'Sesión inválida')
  if (u.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  if (roles.length && !roles.includes(u.rol)) return fail(403, 'Sin permiso')
  return u
}

export async function permisosDe(sql: Sql, u: Pick<Usuario, 'id' | 'rol'>): Promise<string[]> {
  if (u.rol === 'admin') return PERMISOS_ADMIN
  if (u.rol === 'asesor') return PERMISOS_ASESOR
  if (u.rol === 'pyme') return PERMISOS_DUENO
  if (u.rol === 'jefe_local' || u.rol === 'clinico') {
    const filas = await sql<{ permisos: string[] }>('select permisos from miembros where usuario_id = $1 order by creado_en', [u.id])
    return [...new Set(filas.flatMap(f => f.permisos))]
  }
  return []
}

export type Correo = { id: string; para: string; asunto: string; cuerpo: string; tipo: 'bienvenida' | 'verificacion' | 'restablecer' | 'cuenta_creada' | 'cuenta_equipo' | 'aprobacion' | 'convenio' | 'cobranza' | 'privacidad' | 'premio' | 'aviso_qr'; enviado_en: string }

// ---------- Correo ----------
// Con RESEND_API_KEY y MAIL_FROM, el correo sale por Resend y la bandeja (tabla correos) guarda una copia sin el
// enlace de acceso (privado), para que nadie que lea la bandeja pueda usarlo. Sin proveedor (desarrollo y pruebas),
// la bandeja es el único canal y guarda el correo completo, igual que el mock.
const OCULTO = '[enlace enviado solo al destinatario]'

/**
 * privado: parte del cuerpo que solo recibe el destinatario (un enlace de acceso o datos de un tercero); la copia
 * de la bandeja la reemplaza por oculto. obligatorio: si el envío falla, la solicitud responde 502 y se deshace;
 * por defecto, solo cuando hay un enlace privado que la persona está esperando.
 */
export async function enviarCorreo(sql: Sql, para: string, asunto: string, cuerpo: string, tipo: Correo['tipo'], privado?: string,
  { obligatorio = !!privado, oculto = OCULTO }: { obligatorio?: boolean; oculto?: string } = {}) {
  if (!para) return
  const clave = process.env.RESEND_API_KEY, remitente = process.env.MAIL_FROM
  const real = !!(clave && remitente)
  await sql('insert into correos (id, para, asunto, cuerpo, tipo, enviado_en) values ($1, $2, $3, $4, $5, $6)', [uid(), para, asunto, real && privado ? cuerpo.split(privado).join(oculto) : cuerpo, tipo, now()])
  if (real && !(await enviarPorResend(clave, remitente, para, asunto, cuerpo)) && obligatorio) {
    // Sin el correo, la persona quedaría esperando un enlace que nunca llega: la solicitud falla y se deshace.
    fail(502, 'No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.')
  }
}

async function enviarPorResend(clave: string, remitente: string, para: string, asunto: string, cuerpo: string) {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remitente, to: [para], subject: asunto, text: cuerpo }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) console.error(`Resend respondió ${r.status}: ${await r.text().catch(() => '')}`)
    return r.ok
  } catch (error) {
    console.error('No se pudo contactar a Resend:', error)
    return false
  }
}

// ---------- Enlaces de cuenta ----------
export const baseApp = () => process.env.APP_URL || 'http://localhost:5173/'

/** Segundos desde el último enlace de ese tipo para la cuenta (Infinity si nunca se envió). */
export async function segundosDesdeEnvio(sql: Sql, usuarioId: string, tipo: TipoToken) {
  const f = await una<{ creado_en: string }>(sql, 'select creado_en from tokens_cuenta where usuario_id = $1 and tipo = $2 order by creado_en desc limit 1', [usuarioId, tipo])
  return f ? (Date.now() - new Date(f.creado_en).getTime()) / 1000 : Infinity
}

/** Emite un enlace de un solo uso y anula los anteriores del mismo tipo que sigan sin usar. */
export async function emitirToken(sql: Sql, usuarioId: string, tipo: TipoToken) {
  await sql('update tokens_cuenta set usado_en = $3 where usuario_id = $1 and tipo = $2 and usado_en is null', [usuarioId, tipo, now()])
  const token = randomBytes(16).toString('hex')
  await sql("insert into tokens_cuenta (usuario_id, tipo, token_hash, creado_en, expira_en) values ($1, $2, decode($3, 'hex'), $4, $5)",
    [usuarioId, tipo, huella(token), now(), new Date(Date.now() + VIGENCIA_HORAS[tipo] * 3_600_000).toISOString()])
  return enlaceCuenta(baseApp(), tipo, token)
}

/** Consume un enlace vigente de alguno de los tipos indicados; si no existe, ya se usó o venció, responde 400. */
export async function usarToken(sql: Sql, token: string, tipos: TipoToken[]) {
  const u = await una<Usuario>(sql, `select ${USUARIO} from tokens_cuenta t join usuarios u on u.id = t.usuario_id
    where t.token_hash = decode($1, 'hex') and t.tipo = any($2::text[]) and t.usado_en is null and t.expira_en > $3`, [huella(token), tipos, now()])
  if (!u) return fail(400, ENLACE_INVALIDO)
  await sql('update tokens_cuenta set usado_en = $3 where usuario_id = $1 and tipo = any($2::text[]) and usado_en is null', [u.id, tipos, now()])
  return u
}
export async function correoDe(sql: Sql, usuarioId: string | null | undefined) {
  return usuarioId ? (await una<{ correo: string }>(sql, 'select correo from usuarios where id = $1', [usuarioId]))?.correo ?? '' : ''
}
export async function avisarAsesores(sql: Sql, asunto: string, cuerpo: string) {
  const asesores = await sql<{ correo: string }>("select correo from usuarios where rol = 'asesor' and estado = 'activo' order by creado_en")
  for (const a of asesores) await enviarCorreo(sql, a.correo, asunto, cuerpo, 'aprobacion')
}
