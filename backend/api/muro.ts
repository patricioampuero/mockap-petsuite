// Muro comunal: publicaciones por comuna, comentarios, reacciones, guardados y reportes a moderación.
import { z } from 'zod'
import { auth, type Usuario } from './auth'
import { dayOffset, fail, fecha, hace, idDe, now, on, parse, sinEnlaces, uid, una, type Req } from './core'
import type { Row, Sql } from './db'
import { fotoPropia } from './imagenes'

type Publicacion = {
  id: string; autor_id: string; comuna_id: number; mascota_id: string | null; animal_id: string | null; tipo: 'extravio' | 'encuentro' | 'recomendacion' | 'alerta' | 'evento' | 'adopcion'; texto: string
  sector: string | null; foto_url: string | null; fecha_evento: string | null; resuelto_en: string | null; editado_en: string | null; estado: 'publicada' | 'oculta' | 'eliminada'; creado_en: string
}
const PUBLICACION = 'p.id, p.autor_id, p.comuna_id, p.mascota_id, p.animal_id, p.tipo, p.texto, p.sector, p.foto_url, p.fecha_evento, p.resuelto_en, p.editado_en, p.estado, p.creado_en'

const textoMuro = (min: number) => z.string().trim().min(min, `Escribe al menos ${min} caracteres`).max(1000).refine(sinEnlaces, 'No se permiten enlaces externos')

// Urgente: extravíos sin resolver y alertas de salud de la última semana. Se muestran primero.
const urgente = (p: Publicacion) => (p.tipo === 'extravio' && !p.resuelto_en) || (p.tipo === 'alerta' && p.creado_en > hace(7))

// Publicaciones con sus datos de vista en una consulta; los comentarios visibles, en otra.
async function vistas(sql: Sql, u: Usuario, filtro: string, params: unknown[]) {
  const filas = await sql<Publicacion & Row>(`select ${PUBLICACION}, a.nombre_visible as autor, m.nombre as mascota, m.tutor_id as mascota_tutor_id,
      an.id as an_id, an.nombre as an_nombre, an.estado as an_estado, o.nombre as an_ong, o.estado_verificacion as an_ong_estado,
      (select count(*)::int from reacciones r where r.publicacion_id = p.id) as n_reacciones,
      exists (select 1 from reacciones r where r.publicacion_id = p.id and r.usuario_id = $1) as reaccione,
      exists (select 1 from guardados g where g.publicacion_id = p.id and g.usuario_id = $1) as guardado
    from publicaciones p join usuarios a on a.id = p.autor_id
      left join mascotas m on m.id = p.mascota_id
      left join animales an on an.id = p.animal_id left join ongs o on o.id = an.ong_id
    where ${filtro} order by p.creado_en desc limit 100`, [u.id, ...params])
  const comentarios = await sql<{ id: string; publicacion_id: string; autor: string; autor_id: string; texto: string; editado_en: string | null }>(`select c.id, c.publicacion_id, u.nombre_visible as autor, c.autor_id, c.texto, c.editado_en
    from comentarios c join usuarios u on u.id = c.autor_id where c.publicacion_id = any($1::uuid[]) and c.estado = 'visible' order by c.creado_en`, [filas.map(f => f.id)])
  return filas.map(p => ({
    id: p.id, tipo: p.tipo, texto: p.texto, creado_en: p.creado_en, editado: !!p.editado_en, autor: p.autor, es_mio: p.autor_id === u.id,
    comuna_id: p.comuna_id, sector: p.sector, foto_url: p.foto_url, fecha_evento: p.fecha_evento, resuelto: !!p.resuelto_en, urgente: urgente(p),
    mascota: p.mascota_id ? p.mascota ?? null : null,
    // Solo el autor, y mientras la mascota siga siendo suya, recibe el id para armar el cartel con su medalla.
    mascota_id: p.mascota_id && p.autor_id === u.id && p.mascota_tutor_id === u.id ? p.mascota_id : null,
    // La adopción solo se enlaza mientras el animal siga publicado.
    animal: p.an_id && p.an_estado === 'disponible' && p.an_ong_estado === 'aprobada' ? { id: p.an_id, nombre: p.an_nombre, ong: p.an_ong } : null,
    reacciones: p.n_reacciones, reaccione: p.reaccione, guardado: p.guardado,
    comentarios: comentarios.filter(c => c.publicacion_id === p.id).map(c => ({ id: c.id, autor: c.autor, texto: c.texto, es_mio: c.autor_id === u.id, editado: !!c.editado_en })),
  }))
}

// ?comuna=<id> muestra el muro de esa comuna; ?guardadas=1, lo que el usuario guardó en cualquier comuna.
on('GET', '/muro', async req => {
  const u = await auth(req)
  if (req.query.get('guardadas') === '1') {
    return vistas(req.sql, u, "p.estado = 'publicada' and exists (select 1 from guardados g where g.publicacion_id = p.id and g.usuario_id = $1)", [])
  }
  const comuna = Number(req.query.get('comuna') || u.comuna_id)
  return vistas(req.sql, u, "p.estado = 'publicada' and p.comuna_id = $2::bigint", [Number.isSafeInteger(comuna) ? comuna : 0])
})

const publicacionSchema = z.object({
  tipo: z.enum(['extravio', 'encuentro', 'recomendacion', 'alerta', 'evento', 'adopcion']),
  texto: textoMuro(15),
  mascota_id: z.string().optional(),
  animal_id: z.string().optional(),
  sector: z.string().trim().max(80, 'El sector admite hasta 80 caracteres').refine(sinEnlaces, 'No se permiten enlaces externos').optional(),
  fecha_evento: fecha.optional(),
  // Foto subida por el autor (POST /imagenes). En un extravío reemplaza a la foto de la mascota.
  imagen_id: z.string().max(60).optional(),
})

on('POST', '/muro', async req => {
  const u = await auth(req, 'tutor', 'ong')
  const d = parse(publicacionSchema, req.body)
  const p: Publicacion = { id: uid(), autor_id: u.id, comuna_id: 0, mascota_id: null, animal_id: null, tipo: d.tipo, texto: d.texto, sector: d.sector || null, foto_url: null, fecha_evento: null, resuelto_en: null, editado_en: null, estado: 'publicada', creado_en: now() }
  if (u.rol === 'ong' || d.tipo === 'adopcion') {
    // Solo una ONG verificada difunde a sus propios animales publicados, en el muro de la comuna de la ONG.
    if (u.rol !== 'ong' || d.tipo !== 'adopcion') return fail(403, 'Las adopciones las publican las ONG verificadas')
    const o = await una<{ id: string; comuna_id: number; estado_verificacion: string }>(req.sql, 'select id, comuna_id, estado_verificacion from ongs where propietario_id = $1', [u.id])
    if (!o || o.estado_verificacion !== 'aprobada') return fail(403, 'Tu organización debe estar verificada para difundir en el muro')
    const a = await una<{ id: string; nombre: string; foto_url: string | null; estado: string }>(req.sql, 'select id, nombre, foto_url, estado from animales where id = $1 and ong_id = $2', [idDe(d.animal_id), o.id])
    if (!a || a.estado !== 'disponible') return fail(422, 'Solo puedes difundir animales disponibles y publicados')
    if (await una(req.sql, "select 1 from publicaciones where animal_id = $1 and estado = 'publicada'", [a.id])) return fail(409, `${a.nombre} ya está difundido en el muro`)
    Object.assign(p, { comuna_id: o.comuna_id, animal_id: a.id, foto_url: a.foto_url })
  } else {
    if (!u.comuna_id) return fail(400, 'Define tu comuna en el perfil')
    const m = d.mascota_id ? await una<{ id: string; tutor_id: string; foto_url: string | null }>(req.sql, 'select id, tutor_id, foto_url from mascotas where id = $1', [idDe(d.mascota_id)]) : undefined
    if (d.mascota_id && m?.tutor_id !== u.id) return fail(403, 'La mascota no es tuya')
    if (d.tipo === 'evento' && !d.fecha_evento) return fail(400, 'Indica la fecha del evento')
    if (d.tipo === 'evento' && d.fecha_evento! < dayOffset(0)) return fail(400, 'La fecha del evento ya pasó')
    const foto = d.imagen_id ? await fotoPropia(req.sql, d.imagen_id, u.id) : null
    Object.assign(p, { comuna_id: u.comuna_id, mascota_id: d.tipo === 'extravio' ? m?.id ?? null : null, foto_url: foto ?? (d.tipo === 'extravio' ? m?.foto_url ?? null : null), fecha_evento: d.tipo === 'evento' ? d.fecha_evento! : null })
  }
  await req.sql(`insert into publicaciones (id, autor_id, comuna_id, mascota_id, animal_id, tipo, texto, sector, foto_url, fecha_evento, estado, creado_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [p.id, p.autor_id, p.comuna_id, p.mascota_id, p.animal_id, p.tipo, p.texto, p.sector, p.foto_url, p.fecha_evento, p.estado, p.creado_en])
  return { id: p.id, tipo: p.tipo, texto: p.texto, creado_en: p.creado_en }
})

async function publicacionPropia(req: Req): Promise<Publicacion> {
  const u = await auth(req)
  const p = await una<Publicacion>(req.sql, `select ${PUBLICACION} from publicaciones p where p.id = $1 and p.estado <> 'eliminada' for update`, [idDe(req.params.id)])
  if (!p) return fail(404, 'Publicación no encontrada')
  if (p.autor_id !== u.id) return fail(403, 'Solo puedes cambiar tus propias publicaciones')
  return p
}

on('PATCH', '/muro/:id', async req => {
  const p = await publicacionPropia(req)
  const d = parse(publicacionSchema.pick({ texto: true, sector: true, fecha_evento: true }), req.body)
  if (p.estado === 'oculta') return fail(422, 'La publicación fue ocultada por moderación y no se puede editar')
  if (p.tipo === 'evento' && d.fecha_evento && d.fecha_evento < dayOffset(0)) return fail(400, 'La fecha del evento ya pasó')
  await req.sql('update publicaciones set texto = $2, sector = $3, fecha_evento = $4, editado_en = $5 where id = $1',
    [p.id, d.texto, d.sector || null, p.tipo === 'evento' ? d.fecha_evento ?? p.fecha_evento : null, now()])
  return { ok: true }
})

on('DELETE', '/muro/:id', async req => {
  const p = await publicacionPropia(req)
  await req.sql("update publicaciones set estado = 'eliminada' where id = $1", [p.id])
  // Los reportes pendientes sobre lo eliminado ya no requieren revisión.
  await req.sql("update reportes set estado = 'resuelto_mantenido' where publicacion_id = $1 and estado = 'abierto'", [p.id])
  return undefined
})

// Cerrar un extravío o encuentro cuando la mascota volvió a casa (se puede reabrir).
on('PATCH', '/muro/:id/resuelto', async req => {
  const p = await publicacionPropia(req)
  const d = parse(z.object({ resuelto: z.boolean() }), req.body)
  if (p.tipo !== 'extravio' && p.tipo !== 'encuentro') return fail(422, 'Solo los extravíos y encuentros se marcan como resueltos')
  await req.sql('update publicaciones set resuelto_en = $2 where id = $1', [p.id, d.resuelto ? now() : null])
  return { ok: true }
})

const publicada = (sql: Sql, id: unknown) => una(sql, "select id from publicaciones where id = $1 and estado = 'publicada'", [idDe(id)])

// Reaccionar y guardar alternan: la segunda vez se quita.
async function alternar(req: Req, tabla: 'reacciones' | 'guardados') {
  const u = await auth(req)
  const p = await publicada(req.sql, req.params.id)
  if (!p) return fail(404, 'Publicación no encontrada')
  const quitadas = await req.sql(`delete from ${tabla} where publicacion_id = $1 and usuario_id = $2 returning publicacion_id`, [p.id, u.id])
  if (!quitadas.length) await req.sql(`insert into ${tabla} (publicacion_id, usuario_id) values ($1, $2) on conflict do nothing`, [p.id, u.id])
  return !quitadas.length
}
on('POST', '/muro/:id/reacciones', async req => ({ reaccione: await alternar(req, 'reacciones') }))
on('POST', '/muro/:id/guardar', async req => ({ guardado: await alternar(req, 'guardados') }))

on('POST', '/muro/:id/comentarios', async req => {
  const u = await auth(req)
  const d = parse(z.object({ texto: textoMuro(3) }), req.body)
  const p = await publicada(req.sql, req.params.id)
  if (!p) return fail(404, 'Publicación no disponible')
  const c = { id: uid(), texto: d.texto, creado_en: now() }
  await req.sql("insert into comentarios (id, autor_id, publicacion_id, texto, estado, creado_en) values ($1, $2, $3, $4, 'visible', $5)", [c.id, u.id, p.id, c.texto, c.creado_en])
  return c
})

async function comentarioPropio(req: Req) {
  const u = await auth(req)
  const c = await una<{ id: string; autor_id: string }>(req.sql, "select id, autor_id from comentarios where id = $1 and estado = 'visible' for update", [idDe(req.params.cid)])
  if (!c) return fail(404, 'Comentario no encontrado')
  if (c.autor_id !== u.id) return fail(403, 'Solo puedes cambiar tus propios comentarios')
  return c
}

on('PATCH', '/muro/comentarios/:cid', async req => {
  const c = await comentarioPropio(req)
  const d = parse(z.object({ texto: textoMuro(3) }), req.body)
  await req.sql('update comentarios set texto = $2, editado_en = $3 where id = $1', [c.id, d.texto, now()])
  return { ok: true }
})

on('DELETE', '/muro/comentarios/:cid', async req => {
  const c = await comentarioPropio(req)
  await req.sql("update comentarios set estado = 'eliminado' where id = $1", [c.id])
  await req.sql("update reportes set estado = 'resuelto_mantenido' where comentario_id = $1 and estado = 'abierto'", [c.id])
  return undefined
})

on('POST', '/reportes', async req => {
  const u = await auth(req)
  const d = parse(z.object({ objeto_tipo: z.enum(['publicacion', 'comentario']), objeto_id: z.string().min(1), motivo: z.string().trim().min(10, 'Describe el motivo con al menos 10 caracteres').max(200) }), req.body)
  const objeto = d.objeto_tipo === 'publicacion'
    ? await una<{ id: string; autor_id: string }>(req.sql, "select id, autor_id from publicaciones where id = $1 and estado = 'publicada'", [idDe(d.objeto_id)])
    : await una<{ id: string; autor_id: string }>(req.sql, "select id, autor_id from comentarios where id = $1 and estado = 'visible'", [idDe(d.objeto_id)])
  if (!objeto) return fail(404, 'Contenido no encontrado')
  if (objeto.autor_id === u.id) return fail(422, 'No puedes reportar tu propio contenido')
  if (await una(req.sql, "select 1 from reportes where coalesce(publicacion_id, comentario_id) = $1 and reportante_id = $2 and estado = 'abierto'", [objeto.id, u.id])) return fail(409, 'Ya reportaste este contenido; el equipo lo está revisando')
  const id = uid()
  await req.sql("insert into reportes (id, reportante_id, objeto_tipo, publicacion_id, comentario_id, motivo, estado, creado_en) values ($1, $2, $3, $4, $5, $6, 'abierto', $7)",
    [id, u.id, d.objeto_tipo, d.objeto_tipo === 'publicacion' ? objeto.id : null, d.objeto_tipo === 'comentario' ? objeto.id : null, d.motivo, now()])
  return { id }
})
