// Administración y asesoría: resumen, usuarios y suspensiones, moderación, verificación de Pymes y ONG.
import { z } from 'zod'
import { DIAS_PERIODO, PLANES, PLAN_GRATIS, planPorId } from '../../src/modules/plans/plans'
import { FICHA_PUBLICA_SIN_DUENO } from '../../src/shared/fichas'
import { documentosFaltantes } from '../../src/shared/documentos'
import { aprobarDocumentos, documentosDe } from './documentos'
import { userSuspensionSchema } from '../../src/shared/validators'
import { auth, cerrarSesiones, correoDe, enviarCorreo, levantarVencidas } from './auth'
import { comunasDe, dayOffset, fail, hace, idDe, now, on, parse, uid, una } from './core'
import type { Sql } from './db'
import { VISIBLE } from './adopcion'
import { estadoPlanDe, PYME, suscripcionesDe, ultimaDe, usoPyme, type Pyme, type Suscripcion } from './negocio'
import type { Pago } from './pymes'

on('GET', '/admin/resumen', async req => {
  await auth(req, 'admin', 'asesor')
  await levantarVencidas(req.sql)
  const desde = hace(30)
  // Ingreso mensual recurrente: suma de la tarifa del plan que rige hoy en cada Pyme verificada.
  const aprobadas = await req.sql<{ id: string }>("select id from pymes where estado_verificacion = 'aprobada'")
  const subs = await suscripcionesDe(req.sql, aprobadas.map(p => p.id))
  const planes = aprobadas.map(p => estadoPlanDe(subs.get(p.id) ?? []))
  const c = await una(req.sql, `select
      (select count(*)::int from banners where estado = 'pendiente') as banners_pendientes,
      (select count(*)::int from convenios where estado = 'pendiente_asesor') as convenios_pendientes,
      (select count(*)::int from ongs where perfil_estado = 'en_revision') as perfiles_pendientes,
      (select count(*)::int from solicitudes_privacidad where estado in ('recibida', 'en_proceso')) as privacidad_pendientes,
      (select count(*)::int from usuarios) as usuarios,
      (select count(*)::int from usuarios where estado = 'suspendido') as suspendidos,
      (select count(*)::int from pymes where estado_verificacion = 'aprobada') as pymes_activas,
      (select count(*)::int from pymes where estado_verificacion = 'pendiente') as pymes_pendientes,
      (select count(*)::int from reportes where estado = 'abierto') as reportes_abiertos,
      (select count(*)::int from escaneos) as escaneos,
      (select coalesce(sum(monto_clp), 0)::int from pagos where estado = 'confirmado' and pagado_en > $1) as ingresos_30d,
      (select count(*)::int from ongs where estado_verificacion = 'pendiente') as ong_pendientes,
      (select count(*)::int from animales a where ${VISIBLE}) as animales_disponibles`, [desde])
  return {
    por_plan: PLANES.map(pl => ({ codigo: pl.codigo, nombre: pl.nombre, pymes: planes.filter(e => e.plan.id === pl.id).length })),
    mrr: planes.reduce((n, e) => n + e.plan.precio_mensual_clp, 0),
    en_gracia: planes.filter(e => e.en_gracia).length,
    banners_pendientes: c!.banners_pendientes, convenios_pendientes: c!.convenios_pendientes, perfiles_pendientes: c!.perfiles_pendientes, privacidad_pendientes: c!.privacidad_pendientes,
    usuarios: c!.usuarios, suspendidos: c!.suspendidos, pymes_activas: c!.pymes_activas, pymes_pendientes: c!.pymes_pendientes, reportes_abiertos: c!.reportes_abiertos,
    escaneos: c!.escaneos, ingresos_30d: c!.ingresos_30d, ong_pendientes: c!.ong_pendientes, animales_disponibles: c!.animales_disponibles,
  }
})

// Suspensión vigente con la forma del mock: { tipo, dias, hasta, motivo, mensaje, aplicada_en } o null.
const SUSPENSION = `(select json_build_object('tipo', s.tipo, 'dias', s.dias, 'hasta', s.hasta, 'motivo', s.motivo, 'mensaje', s.mensaje, 'aplicada_en', s.aplicada_en)
  from suspensiones s where s.usuario_id = u.id and s.levantada_en is null) as suspension`
// json_build_object deja los momentos con el formato de Postgres; se llevan a ISO como el resto del API.
const conIso = <T extends { suspension: Record<string, unknown> | null }>(u: T) => {
  if (u.suspension) for (const k of ['hasta', 'aplicada_en']) if (u.suspension[k]) u.suspension[k] = new Date(u.suspension[k] as string).toISOString()
  return u
}

on('GET', '/admin/usuarios', async req => {
  await auth(req, 'admin')
  await levantarVencidas(req.sql)
  const q = (req.query.get('q') || '').toLowerCase()
  // El filtro se aplica en JS para que mayúsculas y acentos se comparen igual que en el mock, sin depender de la intercalación de la base.
  const usuarios = await req.sql<{ correo: string; nombre_visible: string; suspension: Record<string, unknown> | null }>(`select u.id, u.correo, u.rol, u.nombre_visible, u.estado, ${SUSPENSION}, u.creado_en
    from usuarios u order by u.creado_en desc`)
  return usuarios.filter(u => !q || u.nombre_visible.toLowerCase().includes(q) || u.correo.includes(q)).slice(0, 100).map(conIso)
})

on('GET', '/admin/usuarios/:id/denuncias', async req => {
  await auth(req, 'admin')
  const user = await una<{ id: string }>(req.sql, 'select id from usuarios where id = $1', [idDe(req.params.id)])
  if (!user) return fail(404, 'Usuario no encontrado')
  return req.sql(`select r.id, r.motivo, r.estado, r.creado_en, ru.nombre_visible as reportante, p.texto as contenido
    from reportes r join publicaciones p on p.id = r.publicacion_id join usuarios ru on ru.id = r.reportante_id
    where p.autor_id = $1 order by r.creado_en desc`, [user.id])
})

on('PATCH', '/admin/usuarios/:id', async req => {
  const admin = await auth(req, 'admin')
  const d = parse(z.discriminatedUnion('estado', [
    z.object({ estado: z.literal('activo') }),
    z.object({ estado: z.literal('suspendido'), suspension: userSuspensionSchema, reporte_id: z.string().optional() }),
  ]), req.body)
  if (req.params.id === admin.id) return fail(400, 'No puedes suspender tu propia cuenta')
  const u = await una<{ id: string; rol: string }>(req.sql, 'select id, rol from usuarios where id = $1 for update', [idDe(req.params.id)])
  if (!u) return fail(404, 'Usuario no encontrado')
  if (u.rol === 'admin') return fail(403, 'No se puede suspender a un administrador')
  const post = d.estado === 'suspendido' && d.reporte_id ? await una<{ id: string }>(req.sql, `select p.id from reportes r join publicaciones p on p.id = r.publicacion_id
    where r.id = $1 and r.estado = 'abierto' and p.autor_id = $2`, [idDe(d.reporte_id), u.id]) : null
  if (d.estado === 'suspendido' && d.reporte_id && !post) return fail(400, 'La denuncia no pertenece a este usuario')
  await req.sql('update usuarios set estado = $2 where id = $1', [u.id, d.estado])
  await req.sql('update suspensiones set levantada_en = $2 where usuario_id = $1 and levantada_en is null', [u.id, now()])
  if (d.estado === 'suspendido') {
    const s = d.suspension
    await req.sql('insert into suspensiones (id, usuario_id, tipo, dias, hasta, motivo, mensaje, aplicada_por, aplicada_en) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [uid(), u.id, s.tipo, s.dias, s.tipo === 'temporal' ? new Date(Date.now() + s.dias! * 86_400_000).toISOString() : null, s.motivo, s.mensaje, admin.id, now()])
    await cerrarSesiones(req.sql, u.id)
    if (post) {
      await req.sql("update publicaciones set estado = 'oculta' where id = $1", [post.id])
      await req.sql("update reportes set estado = 'resuelto_ocultado' where publicacion_id = $1 and estado = 'abierto'", [post.id])
    }
  }
  return { ok: true }
})

on('GET', '/admin/reportes', async req => {
  await auth(req, 'admin')
  return req.sql(`select r.id, r.objeto_tipo, coalesce(r.publicacion_id, r.comentario_id) as objeto_id, r.motivo, r.estado, r.creado_en, ru.nombre_visible as reportante,
      coalesce(c.texto, p.texto) as contenido, au.nombre_visible as autor, coalesce(c.autor_id, p.autor_id) as autor_id
    from reportes r join usuarios ru on ru.id = r.reportante_id
      left join comentarios c on c.id = r.comentario_id left join publicaciones p on p.id = r.publicacion_id
      left join usuarios au on au.id = coalesce(c.autor_id, p.autor_id)
    where r.estado = 'abierto' order by r.creado_en`)
})

on('PATCH', '/admin/reportes/:id', async req => {
  await auth(req, 'admin')
  const d = parse(z.object({ decision: z.enum(['ocultar', 'mantener']) }), req.body)
  const r = await una<{ id: string; objeto_tipo: string; objeto_id: string }>(req.sql, "select id, objeto_tipo, coalesce(publicacion_id, comentario_id) as objeto_id from reportes where id = $1 and estado = 'abierto' for update", [idDe(req.params.id)])
  if (!r) return fail(404, 'Reporte no disponible')
  if (d.decision === 'ocultar') {
    if (r.objeto_tipo === 'comentario') await req.sql("update comentarios set estado = 'oculto' where id = $1", [r.objeto_id])
    else await req.sql("update publicaciones set estado = 'oculta' where id = $1", [r.objeto_id])
    // Ocultar el contenido cierra también los demás reportes sobre él.
    await req.sql("update reportes set estado = 'resuelto_ocultado' where coalesce(publicacion_id, comentario_id) = $1 and estado = 'abierto'", [r.objeto_id])
  }
  await req.sql('update reportes set estado = $2 where id = $1', [r.id, d.decision === 'ocultar' ? 'resuelto_ocultado' : 'resuelto_mantenido'])
  return { ok: true }
})

const pagosDe = (sql: Sql, pymeIds: string[]) => sql<Pago & { pyme_id: string }>(`select pg.*, s.pyme_id from pagos pg join suscripciones s on s.id = pg.suscripcion_id
  where s.pyme_id = any($1::uuid[]) order by pg.pagado_en`, [pymeIds])

on('GET', '/admin/pymes', async req => {
  await auth(req, 'admin', 'asesor')
  const estado = req.query.get('estado') || 'pendiente'
  // Pendientes incluye las renovaciones o cambios de plan de Pymes ya verificadas que esperan confirmar su pago.
  // Las fichas públicas no se revisan aquí: se validan cuando su dueño las reclama.
  const pymes = await req.sql<Pyme>(`select ${PYME} from pymes p where p.origen <> 'publica' and (p.estado_verificacion = $1
    or ($1 = 'pendiente' and p.estado_verificacion = 'aprobada' and exists (select 1 from pagos pg join suscripciones s on s.id = pg.suscripcion_id where s.pyme_id = p.id and pg.estado = 'pendiente')))
    order by p.creado_en`, [estado])
  const ids = pymes.map(p => p.id), subs = await suscripcionesDe(req.sql, ids), pagos = await pagosDe(req.sql, ids), comunas = await comunasDe(req.sql)
  const resultado = []
  for (const p of pymes) {
    const lista = subs.get(p.id) ?? [], s = ultimaDe(lista)
    const pend = pagos.find(pg => pg.pyme_id === p.id && pg.estado === 'pendiente')
    const pago = pend ?? (s && pagos.find(pg => pg.suscripcion_id === s.id))
    const sub = pago && lista.find(x => x.id === pago.suscripcion_id)
    const uso = await usoPyme(req.sql, p.id), docs = await documentosDe(req.sql, p)
    resultado.push({
      id: p.id, nombre_comercial: p.nombre_comercial, rut_empresa: p.rut_empresa, rubro: p.rubro, comuna: comunas.get(p.comuna_id) ?? '', estado_verificacion: p.estado_verificacion,
      solicitud: p.estado_verificacion === 'aprobada' && pend ? 'renovacion' : 'alta', plan: sub ? planPorId(sub.plan_id).nombre : PLAN_GRATIS.nombre,
      plan_vigente: estadoPlanDe(lista).plan.nombre, canal: pago?.canal ?? null, referencia: pago?.referencia ?? null, monto_clp: pago?.monto_clp ?? 0,
      sucursales: uso.sucursales, equipo: uso.usuarios,
      documentos_subidos: docs.documentos.filter(x => x.archivo).length, documentos_faltan: docs.faltan,
    })
  }
  return resultado
})

on('PATCH', '/admin/pymes/:id/verificacion', async req => {
  const revisor = await auth(req, 'admin', 'asesor')
  const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar', 'suspender']) }), req.body)
  const p = await una<Pyme>(req.sql, `select ${PYME} from pymes p where p.id = $1 for update`, [idDe(req.params.id)])
  if (!p) return fail(404, 'Pyme no encontrada')
  if (p.origen === 'publica') return fail(422, FICHA_PUBLICA_SIN_DUENO)
  // Un alta se aprueba solo con sus documentos obligatorios subidos y sin rechazos pendientes de corregir.
  const faltan = (await documentosDe(req.sql, p)).faltan
  if (d.decision === 'aprobar' && p.estado_verificacion === 'pendiente' && faltan.length) return fail(422, documentosFaltantes(faltan))
  const subs = (await suscripcionesDe(req.sql, [p.id])).get(p.id)!
  const pendientes = subs.filter(s => s.estado === 'pendiente')
  const renovacion = p.estado_verificacion === 'aprobada' && pendientes.length > 0 && d.decision !== 'suspender'
  const guardar = (s: Suscripcion) => req.sql('update suscripciones set inicio = $2, fin = $3, estado = $4 where id = $1', [s.id, s.inicio, s.fin, s.estado])

  if (d.decision === 'aprobar') {
    // Renovación: el periodo pedido se respeta. Alta o reactivación: parte hoy.
    const activar = pendientes.length ? pendientes : subs.slice(-1)
    for (const s of activar) {
      if (!renovacion || s.inicio < dayOffset(0)) Object.assign(s, { inicio: dayOffset(0), fin: dayOffset(DIAS_PERIODO) })
      s.estado = 'activa'
      await guardar(s)
    }
    await req.sql("update pagos pg set estado = 'confirmado', pagado_en = $2 from suscripciones s where s.id = pg.suscripcion_id and s.pyme_id = $1 and pg.estado = 'pendiente'", [p.id, now()])
    if (p.estado_verificacion === 'pendiente') await aprobarDocumentos(req.sql, p, revisor)
    p.estado_verificacion = 'aprobada'
  } else {
    for (const s of renovacion ? pendientes : subs) { s.estado = 'cancelada'; await guardar(s) }
    await req.sql("update pagos pg set estado = 'rechazado' from suscripciones s where s.id = pg.suscripcion_id and s.pyme_id = $1 and pg.estado = 'pendiente'", [p.id])
    // Rechazar una renovación solo rechaza ese pago; el negocio sigue verificado.
    if (!renovacion) p.estado_verificacion = d.decision === 'rechazar' ? 'rechazada' : 'suspendida'
  }
  await req.sql('update pymes set estado_verificacion = $2 where id = $1', [p.id, p.estado_verificacion])
  const texto = { aprobar: renovacion ? 'confirmamos tu pago y tu nuevo periodo quedó activo' : 'tu negocio fue verificado y ya aparece en el directorio', rechazar: renovacion ? 'no pudimos confirmar tu pago; revisa la referencia e inténtalo de nuevo' : 'no pudimos verificar tu negocio; tu asesor te contactará', suspender: 'tu negocio fue suspendido del directorio; contacta a tu asesor' }[d.decision]
  await enviarCorreo(req.sql, await correoDe(req.sql, p.propietario_id), `${p.nombre_comercial}: ${d.decision === 'aprobar' ? 'solicitud aprobada' : 'revisión de tu cuenta'}`, `Hola:\n\nTe informamos que ${texto}.\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true }
})

on('GET', '/admin/ong', async req => {
  await auth(req, 'admin', 'asesor')
  const estado = req.query.get('estado') || 'pendiente'
  const comunas = await comunasDe(req.sql)
  const ongs = await req.sql<{ comuna_id: number }>(`select o.id, o.nombre, o.tipo, o.descripcion, o.contacto, o.redes_sociales, o.estado_verificacion, o.comuna_id, o.creado_en,
      (select count(*)::int from animales a where a.ong_id = o.id) as animales
    from ongs o where o.estado_verificacion = $1 order by o.creado_en`, [estado])
  return ongs.map(({ comuna_id, ...o }) => ({ ...o, comuna: comunas.get(comuna_id) ?? '' }))
})

on('PATCH', '/admin/ong/:id/verificacion', async req => {
  await auth(req, 'admin', 'asesor')
  const d = parse(z.object({ decision: z.enum(['aprobar', 'rechazar']) }), req.body)
  const o = await una<{ id: string; nombre: string; propietario_id: string }>(req.sql, 'update ongs set estado_verificacion = $2 where id = $1 returning id, nombre, propietario_id', [idDe(req.params.id), d.decision === 'aprobar' ? 'aprobada' : 'rechazada'])
  if (!o) return fail(404, 'ONG no encontrada')
  await enviarCorreo(req.sql, await correoDe(req.sql, o.propietario_id), `${o.nombre}: ${d.decision === 'aprobar' ? 'organización verificada' : 'revisión de tu organización'}`, d.decision === 'aprobar' ? 'Hola:\n\nTu organización fue verificada. Tus animales ya aparecen en el catálogo público y puedes publicar tu perfil, banners y convenios.\n\nEquipo PetSuite' : 'Hola:\n\nNo pudimos verificar tu organización. Tu asesor te contactará para revisar los antecedentes.\n\nEquipo PetSuite', 'aprobacion')
  return { ok: true }
})
