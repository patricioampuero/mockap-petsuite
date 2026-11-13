// Derechos del titular (Ley 21.719): consentimientos con historial, copia de los datos, solicitudes ARSOPOL y anonimización.
import { z } from 'zod'
import { VERSION_PRIVACIDAD } from '../../src/shared/legal'
import { auth, cerrarSesiones, cifrarClave, enviarCorreo, type Usuario } from './auth'
import { dayOffset, fail, idDe, now, on, parse, uid, una } from './core'
import type { Sql } from './db'

// Estado vigente de cada consentimiento: su fila más reciente, en el orden en que se otorgó por primera vez.
const consentimientosDe = (sql: Sql, usuarioId: string) => sql(`select tipo, otorgado, version, fecha from (
    select distinct on (tipo) tipo, otorgado, version, fecha, min(id) over (partition by tipo) as primero
    from consentimientos where usuario_id = $1 order by tipo, id desc) t order by primero`, [usuarioId])

const SOLICITUD = 'id, usuario_id, derecho, detalle, estado, respuesta, creado_en, vence_en, respondido_en'
const privacidadDe = async (sql: Sql, u: Usuario) => ({
  consentimientos: await consentimientosDe(sql, u.id), bloqueo_tratamiento: !!u.bloqueo_tratamiento,
  solicitudes: await sql(`select ${SOLICITUD} from solicitudes_privacidad where usuario_id = $1 order by creado_en desc`, [u.id]),
})

on('GET', '/privacidad', async req => privacidadDe(req.sql, await auth(req)))

// Acceso y portabilidad: copia estructurada (JSON) de los datos personales de la cuenta, sin claves ni datos de terceros.
on('GET', '/privacidad/mis-datos', async req => {
  const u = await auth(req)
  const privacidad = await privacidadDe(req.sql, u)
  const suspension = await una(req.sql, 'select tipo, dias, hasta, motivo, mensaje, aplicada_en from suspensiones where usuario_id = $1 and levantada_en is null', [u.id])
  const verificado = await una<{ correo_verificado_en: string | null }>(req.sql, 'select correo_verificado_en from usuarios where id = $1', [u.id])
  const mascotas = await req.sql(`select m.*, coalesce((select json_agg(json_build_object('estado', md.estado, 'emitida_en', md.emitida_en) order by md.emitida_en) from medallas md where md.mascota_id = m.id), '[]'::json) as medallas
    from mascotas m where m.tutor_id = $1 order by m.creado_en`, [u.id])
  for (const m of mascotas) for (const md of m.medallas) md.emitida_en = new Date(md.emitida_en).toISOString()
  return {
    generado_en: now(), responsable: 'PetSuite', version_aviso: VERSION_PRIVACIDAD,
    cuenta: { ...u, correo_verificado_en: verificado?.correo_verificado_en ?? null, consentimientos: privacidad.consentimientos, suspension: suspension ?? null },
    mascotas,
    accesos_otorgados: await req.sql('select p.nombre_comercial as clinica, a.permiso, a.vigente_hasta, a.revocado_en from accesos a join pymes p on p.id = a.pyme_id where a.otorgado_por = $1 order by a.vigente_hasta', [u.id]),
    publicaciones: await req.sql('select tipo, texto, creado_en, estado from publicaciones where autor_id = $1 order by creado_en', [u.id]),
    comentarios: await req.sql('select texto, creado_en, estado from comentarios where autor_id = $1 order by creado_en', [u.id]),
    consultas_a_negocios: await req.sql('select p.nombre_comercial as negocio, c.mensaje, c.respuesta, c.creado_en from contactos_pymes c join pymes p on p.id = c.pyme_id where c.remitente_id = $1 order by c.creado_en', [u.id]),
    correos_recibidos: await req.sql('select asunto, enviado_en from correos where para = $1 order by enviado_en', [u.correo]),
    solicitudes_privacidad: privacidad.solicitudes,
  }
})

// Oposición y retiro del consentimiento: efecto inmediato, sin necesidad de solicitud. Cada cambio queda en el historial.
on('PATCH', '/privacidad/consentimientos', async req => {
  const u = await auth(req)
  const d = parse(z.object({ comunicaciones: z.boolean().optional(), metricas: z.boolean().optional() }), req.body)
  for (const tipo of ['comunicaciones', 'metricas'] as const) {
    if (d[tipo] === undefined) continue
    await req.sql('insert into consentimientos (usuario_id, tipo, otorgado, version, fecha) values ($1, $2, $3, $4, $5)', [u.id, tipo, d[tipo], VERSION_PRIVACIDAD, now()])
  }
  return privacidadDe(req.sql, u)
})

on('POST', '/privacidad/solicitudes', async req => {
  const u = await auth(req)
  const d = parse(z.object({ derecho: z.enum(['acceso', 'rectificacion', 'supresion', 'oposicion', 'portabilidad', 'bloqueo']), detalle: z.string().trim().min(10, 'Describe tu solicitud en al menos 10 caracteres').max(500) }), req.body)
  if (await una(req.sql, "select 1 from solicitudes_privacidad where usuario_id = $1 and derecho = $2 and estado in ('recibida', 'en_proceso')", [u.id, d.derecho])) return fail(409, 'Ya tienes una solicitud abierta de este tipo')
  // Plazo legal de respuesta: 30 días corridos desde la recepción.
  const s = { id: uid(), usuario_id: u.id, derecho: d.derecho, detalle: d.detalle, estado: 'recibida', respuesta: null, creado_en: now(), vence_en: dayOffset(30), respondido_en: null }
  await req.sql(`insert into solicitudes_privacidad (${SOLICITUD}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [s.id, s.usuario_id, s.derecho, s.detalle, s.estado, s.respuesta, s.creado_en, s.vence_en, s.respondido_en])
  await enviarCorreo(req.sql, u.correo, 'Recibimos tu solicitud de privacidad', `Hola, ${u.nombre_visible}:\n\nRegistramos tu solicitud de ${d.derecho} (folio ${s.id.slice(0, 8)}). Te responderemos a más tardar el ${s.vence_en}.\n\nEquipo PetSuite`, 'privacidad')
  return s
})

on('GET', '/admin/privacidad', async req => {
  await auth(req, 'admin')
  return req.sql(`select s.id, s.usuario_id, s.derecho, s.detalle, s.estado, s.respuesta, s.creado_en, s.vence_en, s.respondido_en,
      u.nombre_visible as usuario, u.correo, u.rol
    from solicitudes_privacidad s join usuarios u on u.id = s.usuario_id order by s.vence_en, s.creado_en`)
})

// Supresión: anonimiza la cuenta y borra mascotas y medallas (con sus avisos y accesos); se conservan los pagos por obligación tributaria.
async function anonimizar(sql: Sql, u: { id: string }) {
  await sql('delete from mascotas where tutor_id = $1', [u.id])
  await sql('delete from imagenes where dueno_id = $1', [u.id])
  await sql("update publicaciones set estado = 'eliminada' where autor_id = $1", [u.id])
  await sql("update comentarios set estado = 'eliminado' where autor_id = $1", [u.id])
  await sql("update contactos_pymes set remitente_nombre = 'Usuario eliminado', remitente_contacto = null where remitente_id = $1", [u.id])
  await cerrarSesiones(sql, u.id)
  await sql('delete from consentimientos where usuario_id = $1', [u.id])
  await sql('update suspensiones set levantada_en = $2 where usuario_id = $1 and levantada_en is null', [u.id, now()])
  await sql("update usuarios set nombre_visible = 'Usuario eliminado', correo = $2, clave_hash = $3, estado = 'eliminado' where id = $1",
    [u.id, `eliminado-${u.id.slice(0, 8)}@petsuite.invalid`, await cifrarClave(uid())])
}

on('PATCH', '/admin/privacidad/:id', async req => {
  await auth(req, 'admin')
  const d = parse(z.object({ estado: z.enum(['en_proceso', 'respondida', 'rechazada']), respuesta: z.string().trim().max(1000).optional() })
    .refine(x => x.estado === 'en_proceso' || (x.respuesta ?? '').length >= 10, { message: 'Escribe la respuesta al titular (mínimo 10 caracteres)', path: ['respuesta'] }), req.body)
  const s = await una(req.sql, `update solicitudes_privacidad set estado = $2, respuesta = $3, respondido_en = $4 where id = $1 and estado in ('recibida', 'en_proceso') returning ${SOLICITUD}`,
    [idDe(req.params.id), d.estado, d.respuesta ?? null, d.estado === 'en_proceso' ? null : now()])
  if (!s) return fail(404, 'Solicitud no disponible')
  const u = await una<{ id: string; correo: string }>(req.sql, 'select id, correo from usuarios where id = $1', [s.usuario_id])
  const correo = u?.correo ?? ''
  if (u && d.estado === 'respondida') {
    if (s.derecho === 'bloqueo') await req.sql('update usuarios set bloqueo_tratamiento = true where id = $1', [u.id])
    // Oposición: se retiran los consentimientos opcionales que existan, conservando la versión con que se otorgaron.
    if (s.derecho === 'oposicion') {
      await req.sql(`insert into consentimientos (usuario_id, tipo, otorgado, version, fecha)
        select $1, tipo, false, version, $2 from (select distinct on (tipo) tipo, version from consentimientos where usuario_id = $1 and tipo in ('comunicaciones', 'metricas') order by tipo, id desc) t`, [u.id, now()])
    }
    if (s.derecho === 'supresion') await anonimizar(req.sql, u)
  }
  if (d.estado !== 'en_proceso') await enviarCorreo(req.sql, correo, `Respuesta a tu solicitud de ${s.derecho}`, `Hola:\n\n${d.respuesta}\n\nSi no estás conforme, puedes reclamar ante la Agencia de Protección de Datos Personales.\n\nEquipo PetSuite`, 'privacidad')
  return s
})
