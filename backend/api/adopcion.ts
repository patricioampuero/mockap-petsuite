// Adopción: catálogo público, solicitudes, gestión de animales de la ONG y traspaso de la Ficha Única al adoptante.
// Solo los animales disponibles de ONG verificadas son públicos.
import { z } from 'zod'
import type { FichaDatos } from '../../src/shared/api'
import { auth } from './auth'
import { comunasDe, fail, hace, idDe, now, on, parse, uid, una, type Req } from './core'
import type { Sql } from './db'
import { fichaSchema } from './ficha'
import { ordenAdopciones, PRIORIDAD_SOLO_DISPONIBLES } from '../../src/shared/prioridad'

export type Ong = {
  id: string; propietario_id: string; nombre: string; tipo: 'refugio' | 'rescatista_independiente' | 'agrupacion'; descripcion: string | null; comuna_id: number; contacto: string | null; redes_sociales: string | null
  estado_verificacion: 'pendiente' | 'aprobada' | 'rechazada'; perfil_publicado: Record<string, unknown> | null; perfil_borrador: Record<string, unknown> | null
  perfil_estado: 'sin_enviar' | 'en_revision' | 'publicado' | 'rechazado'; perfil_motivo: string | null; creado_en: string
}
export type Animal = {
  id: string; ong_id: string; nombre: string; especie: string; raza: string | null; edad_estimada: string | null; estado_salud: string | null; historia: string | null
  historial_salud: FichaDatos; foto_url: string | null; estado: 'disponible' | 'en_proceso' | 'adoptado'; mascota_id: string | null; publicado_en: string; prioritario: boolean
}
// Condición de «visible» del mock: disponible y de una ONG aprobada.
export const VISIBLE = "a.estado = 'disponible' and exists (select 1 from ongs o where o.id = a.ong_id and o.estado_verificacion = 'aprobada')"

export async function miOng(req: Req): Promise<Ong> {
  const u = await auth(req, 'ong')
  const o = await una<Ong>(req.sql, 'select * from ongs where propietario_id = $1', [u.id])
  if (!o) return fail(409, 'Primero registra tu organización')
  return o
}

on('GET', '/adopciones', async req => {
  const comuna = req.query.get('comuna'), especie = req.query.get('especie')
  const comunas = await comunasDe(req.sql)
  const filas = await req.sql<Animal & { ong: string; ong_comuna: number }>(`select a.*, o.nombre as ong, o.comuna_id as ong_comuna from animales a join ongs o on o.id = a.ong_id
    where ${VISIBLE}`)
  return filas.filter(a => (!comuna || comunas.get(a.ong_comuna) === comuna) && (!especie || a.especie.toLowerCase() === especie.toLowerCase()))
    .sort(ordenAdopciones)
    .map(a => ({ id: a.id, nombre: a.nombre, especie: a.especie, raza: a.raza, edad_estimada: a.edad_estimada, estado_salud: a.estado_salud, foto_url: a.foto_url, publicado_en: a.publicado_en, ong: a.ong, comuna: comunas.get(a.ong_comuna) ?? '', prioritario: a.prioritario }))
})

on('GET', '/adopciones/:id', async req => {
  const a = await una<Animal>(req.sql, 'select * from animales where id = $1', [idDe(req.params.id)])
  const o = a && await una<Ong>(req.sql, 'select * from ongs where id = $1', [a.ong_id])
  if (!a || !o || a.estado === 'adoptado' || o.estado_verificacion !== 'aprobada') return fail(404, 'No encontrado')
  await req.sql('insert into eventos_adopcion (animal_id, ocurrido_en) values ($1, $2)', [a.id, now()])
  return {
    id: a.id, nombre: a.nombre, especie: a.especie, raza: a.raza, edad_estimada: a.edad_estimada, estado_salud: a.estado_salud, historia: a.historia, foto_url: a.foto_url, publicado_en: a.publicado_en,
    vacunas: a.historial_salud.vacunas, ong_id: o.id, ong: o.nombre, ong_tipo: o.tipo, ong_descripcion: o.descripcion, ong_contacto: o.contacto, ong_redes: o.redes_sociales, comuna: (await comunasDe(req.sql)).get(o.comuna_id) ?? '',
  }
})

on('POST', '/adopciones/:id/solicitudes', async req => {
  const d = parse(z.object({
    mensaje: z.string().trim().min(10, 'Cuéntale a la organización por qué quieres adoptar (mínimo 10 caracteres)').max(1000),
    nombre: z.string().trim().max(80).optional(),
    contacto: z.string().trim().max(120).optional(),
  }), req.body)
  const a = await una<{ id: string }>(req.sql, `select a.id from animales a where a.id = $1 and ${VISIBLE}`, [idDe(req.params.id)])
  if (!a) return fail(404, 'Este animal ya no está disponible')
  await req.sql("insert into solicitudes_adopcion (id, animal_id, solicitante_nombre, solicitante_contacto, mensaje, estado, creado_en) values ($1, $2, $3, $4, $5, 'nueva', $6)",
    [uid(), a.id, d.nombre || null, d.contacto || null, d.mensaje, now()])
  return { ok: true }
})

on('GET', '/ong/mia', async req => {
  const u = await auth(req, 'ong')
  const o = await una<Ong>(req.sql, 'select * from ongs where propietario_id = $1', [u.id])
  return o ? { ...o, comuna: (await comunasDe(req.sql)).get(o.comuna_id) ?? '' } : null
})

on('POST', '/ong', async req => {
  const u = await auth(req, 'ong')
  const d = parse(z.object({
    nombre: z.string().trim().min(2, 'Ingresa el nombre de la organización').max(100),
    tipo: z.enum(['refugio', 'rescatista_independiente', 'agrupacion']),
    descripcion: z.string().trim().max(1000).optional(),
    comuna_id: z.number().int().positive(),
    contacto: z.string().trim().max(120).optional(),
    redes_sociales: z.string().trim().max(200).optional(),
  }), req.body)
  if (await una(req.sql, 'select 1 from ongs where propietario_id = $1', [u.id])) return fail(409, 'Tu cuenta ya tiene una organización registrada')
  if (!(await comunasDe(req.sql)).has(d.comuna_id)) return fail(400, 'Comuna no válida')
  const id = uid()
  await req.sql("insert into ongs (id, propietario_id, nombre, tipo, descripcion, comuna_id, contacto, redes_sociales, estado_verificacion, perfil_estado, creado_en) values ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', 'sin_enviar', $9)",
    [id, u.id, d.nombre, d.tipo, d.descripcion ?? null, d.comuna_id, d.contacto ?? null, d.redes_sociales ?? null, now()])
  return { id, estado_verificacion: 'pendiente' }
})

const animalSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresa el nombre del animal').max(60),
  especie: z.string().trim().min(1).max(20),
  raza: z.string().trim().max(60).optional(),
  edad_estimada: z.string().trim().max(30).optional(),
  estado_salud: z.string().trim().max(1000).optional(),
  historia: z.string().trim().max(2000).optional(),
  historial_salud: fichaSchema.optional(),
  estado: z.enum(['disponible', 'en_proceso', 'adoptado']).optional(),
})

const guardarAnimal = (sql: Sql, a: Animal) => sql(`insert into animales (id, ong_id, nombre, especie, raza, edad_estimada, estado_salud, historia, historial_salud, foto_url, estado, mascota_id, publicado_en)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
  on conflict (id) do update set nombre = excluded.nombre, especie = excluded.especie, raza = excluded.raza, edad_estimada = excluded.edad_estimada, estado_salud = excluded.estado_salud,
    historia = excluded.historia, historial_salud = excluded.historial_salud, estado = excluded.estado, mascota_id = excluded.mascota_id`,
[a.id, a.ong_id, a.nombre, a.especie, a.raza, a.edad_estimada, a.estado_salud, a.historia, JSON.stringify(a.historial_salud), a.foto_url, a.estado, a.mascota_id, a.publicado_en])

on('GET', '/ong/animales', async req => {
  const o = await miOng(req)
  return req.sql(`select a.*, (a.estado <> 'adoptado' and $2) as publicado,
      (select count(*)::int from solicitudes_adopcion s where s.animal_id = a.id and s.estado in ('nueva', 'en_conversacion')) as solicitudes_abiertas,
      (select count(*)::int from eventos_adopcion e where e.animal_id = a.id and e.ocurrido_en > $3) as visitas_7d
    from animales a where a.ong_id = $1 order by a.publicado_en desc`, [o.id, o.estado_verificacion === 'aprobada', hace(7)])
})

on('POST', '/ong/animales', async req => {
  const o = await miOng(req)
  const d = parse(animalSchema, req.body)
  const vacia: FichaDatos = { condiciones: [], medicamentos: [], notaEmergencia: '', vacunas: [], alergias: [], tratamientos: [], atenciones: [], alertasCriticas: [] }
  const a: Animal = {
    id: uid(), ong_id: o.id, nombre: d.nombre, especie: d.especie, raza: d.raza ?? null, edad_estimada: d.edad_estimada ?? null, estado_salud: d.estado_salud ?? null, historia: d.historia ?? null,
    historial_salud: d.historial_salud ?? vacia, foto_url: null, estado: 'disponible', mascota_id: null, publicado_en: now(), prioritario: false,
  }
  await guardarAnimal(req.sql, a)
  return { ...a, publicado: o.estado_verificacion === 'aprobada' }
})

// Los campos omitidos se conservan (por ejemplo, la foto y la raza al alternar la disponibilidad).
on('PUT', '/ong/animales/:id', async req => {
  const o = await miOng(req)
  const d = parse(animalSchema, req.body)
  const a = await una<Animal>(req.sql, 'select * from animales where id = $1 and ong_id = $2 for update', [idDe(req.params.id), o.id])
  if (!a) return fail(404, 'No encontrado')
  Object.assign(a, {
    nombre: d.nombre, especie: d.especie, raza: d.raza ?? a.raza, edad_estimada: d.edad_estimada ?? a.edad_estimada, estado_salud: d.estado_salud ?? a.estado_salud,
    historia: d.historia ?? a.historia, historial_salud: d.historial_salud ?? a.historial_salud, estado: a.estado === 'adoptado' ? a.estado : d.estado ?? a.estado,
  })
  await guardarAnimal(req.sql, a)
  return a
})

// Prioritario: a lo más uno por ONG (MAX_PRIORITARIOS_POR_ONG, y un índice único en la base). Marcar a otro le quita
// la prioridad al anterior.
on('PUT', '/ong/animales/:id/prioridad', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ prioritario: z.boolean() }), req.body)
  const a = await una<Animal>(req.sql, 'select * from animales where id = $1 and ong_id = $2 for update', [idDe(req.params.id), o.id])
  if (!a) return fail(404, 'No encontrado')
  if (d.prioritario && a.estado !== 'disponible') return fail(422, PRIORIDAD_SOLO_DISPONIBLES)
  if (d.prioritario) await req.sql('update animales set prioritario = false where ong_id = $1 and prioritario', [o.id])
  await req.sql('update animales set prioritario = $2 where id = $1', [a.id, d.prioritario])
  return { id: a.id, prioritario: d.prioritario }
})

on('GET', '/ong/animales/:id/solicitudes', async req => {
  const o = await miOng(req)
  const a = await una(req.sql, 'select id from animales where id = $1 and ong_id = $2', [idDe(req.params.id), o.id])
  if (!a) return fail(404, 'No encontrado')
  return req.sql('select id, solicitante_nombre, solicitante_contacto, mensaje, estado, creado_en from solicitudes_adopcion where animal_id = $1 order by creado_en desc', [a.id])
})

// En conversación marca el animal en proceso; cerrar la solicitud lo libera si no hay otras en curso.
on('PATCH', '/ong/solicitudes/:id', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ estado: z.enum(['en_conversacion', 'cerrada']) }), req.body)
  const s = await una<{ id: string; animal_id: string }>(req.sql, `select s.id, s.animal_id from solicitudes_adopcion s join animales a on a.id = s.animal_id
    where s.id = $1 and s.estado in ('nueva', 'en_conversacion') and a.ong_id = $2 for update of s`, [idDe(req.params.id), o.id])
  if (!s) return fail(404, 'Solicitud no disponible')
  await req.sql('update solicitudes_adopcion set estado = $2 where id = $1', [s.id, d.estado])
  await req.sql(`update animales a set estado = case when exists (select 1 from solicitudes_adopcion x where x.animal_id = a.id and x.estado = 'en_conversacion') then 'en_proceso' else 'disponible' end
    where a.id = $1 and a.estado <> 'adoptado'`, [s.animal_id])
  return { ok: true }
})

// Crea la Ficha Única del adoptante con el mismo historial de salud del animal.
async function traspasar(sql: Sql, a: Animal, tutorId: string) {
  const id = uid()
  await sql('insert into mascotas (id, tutor_id, nombre, especie, raza, foto_url, datos_clinicos, ficha_version, creado_en) values ($1, $2, $3, $4, $5, $6, $7::jsonb, 1, $8)',
    [id, tutorId, a.nombre, a.especie, a.raza, a.foto_url, JSON.stringify(a.historial_salud), now()])
  return id
}
const tutorPorCorreo = async (sql: Sql, correo?: string | null) => correo
  ? una<{ id: string }>(sql, "select id from usuarios where lower(correo) = $1 and rol = 'tutor' and estado = 'activo'", [correo.trim().toLowerCase()])
  : undefined

on('POST', '/ong/animales/:id/adopcion', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ solicitud_id: z.string().optional(), correo: z.string().trim().email('Correo inválido').optional() }), req.body)
  const a = await una<Animal>(req.sql, "select * from animales where id = $1 and ong_id = $2 and estado <> 'adoptado' for update", [idDe(req.params.id), o.id])
  if (!a) return fail(404, 'El animal no existe o ya fue adoptado')
  const sol = d.solicitud_id ? await una<{ id: string; solicitante_contacto: string | null }>(req.sql, 'select id, solicitante_contacto from solicitudes_adopcion where id = $1 and animal_id = $2', [idDe(d.solicitud_id), a.id]) : undefined
  if (d.solicitud_id && !sol) return fail(404, 'Solicitud no encontrada')
  const tutor = await tutorPorCorreo(req.sql, d.correo || sol?.solicitante_contacto)
  a.mascota_id = tutor ? await traspasar(req.sql, a, tutor.id) : null
  a.estado = 'adoptado'
  await guardarAnimal(req.sql, a)
  // Un animal adoptado deja de ser prioritario: la ONG puede destacar a otro.
  await req.sql('update animales set prioritario = false where id = $1', [a.id])
  if (sol) await req.sql("update solicitudes_adopcion set estado = 'concretada' where id = $1", [sol.id])
  await req.sql("update solicitudes_adopcion set estado = 'cerrada' where animal_id = $1 and estado in ('nueva', 'en_conversacion')", [a.id])
  return { ok: true, vinculada: !!tutor, mascota_id: a.mascota_id, invitar: !tutor }
})

on('POST', '/ong/animales/:id/vincular', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ correo: z.string().trim().email('Correo inválido') }), req.body)
  const a = await una<Animal>(req.sql, "select * from animales where id = $1 and ong_id = $2 and estado = 'adoptado' and mascota_id is null for update", [idDe(req.params.id), o.id])
  if (!a) return fail(404, 'No hay una adopción pendiente de vincular')
  const tutor = await tutorPorCorreo(req.sql, d.correo)
  if (!tutor) return fail(404, 'No existe un tutor con ese correo. Invítalo a crear su cuenta en PetSuite.')
  a.mascota_id = await traspasar(req.sql, a, tutor.id)
  await guardarAnimal(req.sql, a)
  return { ok: true, mascota_id: a.mascota_id }
})
