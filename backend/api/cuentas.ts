// Autenticación, registro y catálogos generales (comunas y planes).
import { z } from 'zod'
import { PLANES } from '../../src/modules/plans/plans'
import { VERSION_PRIVACIDAD } from '../../src/shared/legal'
import { CLAVE_ACTUAL_INCORRECTA, CORREO_SIN_CONFIRMAR, SEGUNDOS_ENTRE_ENVIOS, cambiarClaveSchema, correoRestablecer, correoVerificacion, perfilSchema } from '../../src/shared/cuentas'
import { auth, cerrarSesiones, cifrarClave, claveCorrecta, crearSesion, emitirToken, enviarCorreo, levantarVencidas, permisosDe, segundosDesdeEnvio, usarToken, USUARIO, usuarioPorId, type Usuario } from './auth'
import { comunasDe, fail, now, on, parse, porTexto, uid, una } from './core'
import type { Sql } from './db'

const sesionDe = async (sql: Sql, u: Usuario) => ({
  token: await crearSesion(sql, u.id),
  usuario: { id: u.id, rol: u.rol, nombre_visible: u.nombre_visible, comuna_id: u.comuna_id, permisos: await permisosDe(sql, u) },
})

// Ley 21.719: términos y tratamiento de datos son obligatorios; comunicaciones comerciales, opcionales.
export async function consentimientosIniciales(sql: Sql, usuarioId: string, comunicaciones: boolean) {
  const fecha = now()
  for (const [tipo, otorgado] of [['terminos', true], ['privacidad', true], ['comunicaciones', comunicaciones], ['metricas', true]] as const) {
    await sql('insert into consentimientos (usuario_id, tipo, otorgado, version, fecha) values ($1, $2, $3, $4, $5)', [usuarioId, tipo, otorgado, VERSION_PRIVACIDAD, fecha])
  }
}

type ConCorreo = Usuario & { correo_verificado_en: string | null }
const porCorreo = (sql: Sql, correo: string) => una<ConCorreo>(sql, `select ${USUARIO}, u.correo_verificado_en from usuarios u where lower(u.correo) = $1`, [correo.toLowerCase()])
const correoSchema = z.object({ correo: z.string().trim().email('Correo inválido').max(254) })
const tokenSchema = z.string().max(200)

on('POST', '/auth/login', async req => {
  const d = parse(z.object({ correo: z.string().trim().email('Correo inválido'), clave: z.string().min(1, 'Ingresa tu contraseña') }), req.body)
  const fila = await una<ConCorreo & { clave_hash: string }>(req.sql, `select ${USUARIO}, u.clave_hash, u.correo_verificado_en from usuarios u where lower(u.correo) = $1`, [d.correo.toLowerCase()])
  // Se compara siempre, exista o no la cuenta, para no revelar qué correos están registrados por el tiempo de respuesta.
  if (!(await claveCorrecta(d.clave, fila?.clave_hash)) || !fila) return fail(401, 'Credenciales incorrectas')
  // Solo con la clave correcta se informa que falta confirmar el correo.
  if (!fila.correo_verificado_en) return fail(403, CORREO_SIN_CONFIRMAR)
  let u: Usuario | undefined = fila
  if (u.estado === 'suspendido') {
    await levantarVencidas(req.sql, u.id)
    u = await usuarioPorId(req.sql, u.id)
  }
  if (!u || u.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  return sesionDe(req.sql, u)
})

on('POST', '/auth/registro', async req => {
  const d = parse(z.object({
    correo: z.string().trim().email('Correo inválido').max(254),
    clave: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72),
    nombre_visible: z.string().trim().min(2, 'Ingresa tu nombre').max(80),
    comuna_id: z.number().int().positive(),
    rol: z.enum(['tutor', 'pyme', 'ong']).default('tutor'),
    acepta_terminos: z.literal(true, { message: 'Debes aceptar los términos de uso' }),
    acepta_privacidad: z.literal(true, { message: 'Debes autorizar el tratamiento de tus datos según el aviso de privacidad' }),
    acepta_comunicaciones: z.boolean().default(false),
  }), req.body)
  const correo = d.correo.toLowerCase()
  if (await una(req.sql, 'select 1 from usuarios where lower(correo) = $1', [correo])) return fail(409, 'Ese correo ya está registrado')
  if (!(await comunasDe(req.sql)).has(d.comuna_id)) return fail(400, 'Comuna no válida')
  const u: Usuario = { id: uid(), correo, rol: d.rol, nombre_visible: d.nombre_visible, comuna_id: d.comuna_id, estado: 'activo', bloqueo_tratamiento: false, creado_en: now() }
  await req.sql('insert into usuarios (id, correo, clave_hash, rol, nombre_visible, comuna_id, estado, creado_en) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [u.id, correo, await cifrarClave(d.clave), u.rol, u.nombre_visible, u.comuna_id, u.estado, u.creado_en])
  await consentimientosIniciales(req.sql, u.id, d.acepta_comunicaciones)
  // La cuenta queda pendiente: no hay sesión hasta que la persona abre el enlace enviado a su correo.
  const enlace = await emitirToken(req.sql, u.id, 'verificacion')
  const c = correoVerificacion(u.nombre_visible, u.rol, enlace)
  await enviarCorreo(req.sql, correo, c.asunto, c.cuerpo, 'verificacion', enlace)
  return { verificacion_pendiente: true, correo }
})

// Confirma el correo con el enlace y deja la sesión iniciada.
on('POST', '/auth/verificar', async req => {
  const d = parse(z.object({ token: tokenSchema }), req.body)
  let u: Usuario | undefined = await usarToken(req.sql, d.token, ['verificacion'])
  await req.sql('update usuarios set correo_verificado_en = coalesce(correo_verificado_en, $2) where id = $1', [u.id, now()])
  if (u.estado === 'suspendido') {
    await levantarVencidas(req.sql, u.id)
    u = await usuarioPorId(req.sql, u.id)
  }
  if (!u || u.estado !== 'activo') return fail(403, 'Tu cuenta está suspendida')
  return sesionDe(req.sql, u)
})

// Reenvío y recuperación responden lo mismo exista o no la cuenta, para no revelar qué correos están registrados.
on('POST', '/auth/reenviar-verificacion', async req => {
  const d = parse(correoSchema, req.body)
  const u = await porCorreo(req.sql, d.correo)
  if (u && !u.correo_verificado_en && u.estado === 'activo' && await segundosDesdeEnvio(req.sql, u.id, 'verificacion') >= SEGUNDOS_ENTRE_ENVIOS) {
    const enlace = await emitirToken(req.sql, u.id, 'verificacion')
    const c = correoVerificacion(u.nombre_visible, u.rol, enlace)
    await enviarCorreo(req.sql, u.correo, c.asunto, c.cuerpo, 'verificacion', enlace)
  }
  return { ok: true }
})

on('POST', '/auth/recuperar', async req => {
  const d = parse(correoSchema, req.body)
  const u = await porCorreo(req.sql, d.correo)
  if (u && u.estado !== 'eliminado' && await segundosDesdeEnvio(req.sql, u.id, 'restablecer') >= SEGUNDOS_ENTRE_ENVIOS) {
    const enlace = await emitirToken(req.sql, u.id, 'restablecer')
    const c = correoRestablecer(u.nombre_visible, enlace)
    await enviarCorreo(req.sql, u.correo, c.asunto, c.cuerpo, 'restablecer', enlace)
  }
  return { ok: true }
})

// Contraseña nueva con un enlace de recuperación o de invitación: confirma el correo y cierra las sesiones abiertas.
on('POST', '/auth/restablecer', async req => {
  const d = parse(z.object({ token: tokenSchema, clave: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(72) }), req.body)
  const u = await usarToken(req.sql, d.token, ['restablecer', 'invitacion'])
  await req.sql('update usuarios set clave_hash = $2, correo_verificado_en = coalesce(correo_verificado_en, $3) where id = $1', [u.id, await cifrarClave(d.clave), now()])
  await cerrarSesiones(req.sql, u.id)
  return { ok: true }
})

on('GET', '/auth/yo', async req => {
  const u = await auth(req)
  return { id: u.id, rol: u.rol, nombre_visible: u.nombre_visible, correo: u.correo, comuna_id: u.comuna_id, permisos: await permisosDe(req.sql, u) }
})
// Perfil: el nombre visible y la comuna. El correo no se cambia aquí: identifica la cuenta y está confirmado.
on('PATCH', '/auth/yo', async req => {
  const u = await auth(req)
  const d = parse(perfilSchema, req.body)
  if (d.comuna_id !== undefined && !(await comunasDe(req.sql)).has(d.comuna_id)) return fail(400, 'Comuna no válida')
  const nuevo = { ...u, nombre_visible: d.nombre_visible ?? u.nombre_visible, comuna_id: d.comuna_id ?? u.comuna_id }
  await req.sql('update usuarios set nombre_visible = $2, comuna_id = $3 where id = $1', [u.id, nuevo.nombre_visible, nuevo.comuna_id])
  return { id: u.id, rol: u.rol, nombre_visible: nuevo.nombre_visible, correo: u.correo, comuna_id: nuevo.comuna_id, permisos: await permisosDe(req.sql, u) }
})

// Cambiar la contraseña con la actual. Cierra todas las sesiones, igual que restablecerla con un enlace.
on('POST', '/auth/cambiar-clave', async req => {
  const u = await auth(req)
  const d = parse(cambiarClaveSchema, req.body)
  const fila = await una<{ clave_hash: string }>(req.sql, 'select clave_hash from usuarios where id = $1', [u.id])
  if (!(await claveCorrecta(d.actual, fila?.clave_hash))) return fail(403, CLAVE_ACTUAL_INCORRECTA)
  await req.sql('update usuarios set clave_hash = $2 where id = $1', [u.id, await cifrarClave(d.nueva)])
  await cerrarSesiones(req.sql, u.id)
  return { ok: true }
})

on('GET', '/comunas', async req => [...(await comunasDe(req.sql))].map(([id, nombre]) => ({ id, nombre })).sort(porTexto(c => c.nombre)))
on('GET', '/planes', () => PLANES)
