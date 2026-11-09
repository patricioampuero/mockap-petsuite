// Ficha Única de Salud, medallas QR, accesos clínicos y la vista pública de emergencia.
// La vista pública usa una LISTA BLANCA: nunca medicamentos, historial, datos del tutor ni ids internos.
import { z } from 'zod'
import type { FichaDatos } from '../../src/shared/api'
import { correoAvisoQr } from '../../src/shared/avisos'
import { auth, baseApp, enviarCorreo, type Usuario } from './auth'
import { fail, fecha, idDe, now, on, parse, porTexto, uid, una, type Req } from './core'
import type { Sql } from './db'
import { clinicasDe } from './negocio'

export type Mascota = {
  id: string; tutor_id: string; nombre: string; especie: string; raza: string | null; sexo: string | null; fecha_nacimiento: string | null; foto_url: string | null
  datos_clinicos: FichaDatos; ficha_version: number; creado_en: string
}
export const MASCOTA = 'm.id, m.tutor_id, m.nombre, m.especie, m.raza, m.sexo, m.fecha_nacimiento, m.foto_url, m.datos_clinicos, m.ficha_version, m.creado_en'

// Autoría de los registros clínicos: se conserva al guardar la ficha completa.
const meta = { registrado_por: z.string().optional(), clinica: z.string().max(100).optional(), anulado: z.object({ motivo: z.string().max(200), en: z.string() }).optional() }
export const fichaSchema = z.object({
  condiciones: z.array(z.string().max(80)).max(8).default([]),
  medicamentos: z.array(z.string().max(80)).max(8).default([]),
  notaEmergencia: z.string().max(160).default(''),
  vacunas: z.array(z.object({ id: z.string().optional(), nombre: z.string().max(80), fecha: z.string().max(10), proxima: z.string().max(10).optional(), notas: z.string().max(500).optional(), ...meta })).max(100).default([]),
  alergias: z.array(z.object({ agente: z.string().max(80), reaccion: z.string().max(120).optional(), gravedad: z.enum(['leve', 'moderada', 'grave']).optional() })).max(50).default([]),
  tratamientos: z.array(z.object({ id: z.string().optional(), descripcion: z.string().max(200), inicio: z.string().max(10).optional(), fin: z.string().max(10).optional(), notas: z.string().max(500).optional(), ...meta })).max(100).default([]),
  atenciones: z.array(z.object({ id: z.string().optional(), fecha: z.string().max(10), motivo: z.string().max(200), notas: z.string().max(500).optional(), ...meta })).max(200).default([]),
  alertasCriticas: z.array(z.string().max(200)).max(20).default([]),
})

const mascotaSchema = z.object({
  nombre: z.string().trim().min(1, 'Ingresa el nombre').max(60),
  especie: z.string().trim().min(1).max(20),
  raza: z.string().trim().max(60).optional(),
  sexo: z.enum(['macho', 'hembra', 'desconocido']).optional(),
  fecha_nacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').optional(),
})

const QR_TOKEN = /^[A-Za-z0-9_-]{16,32}$/
const vigente = 'a.revocado_en is null and a.vigente_hasta > $NOW'
const conVigencia = (texto: string, posicion: number) => texto.replace('$NOW', `$${posicion}`)

const mascotaPorId = (sql: Sql, id: unknown, bloquear = false) =>
  una<Mascota>(sql, `select ${MASCOTA} from mascotas m where m.id = $1${bloquear ? ' for update' : ''}`, [idDe(id)])

async function propia(req: Req, bloquear = false): Promise<[Usuario, Mascota]> {
  const u = await auth(req, 'tutor')
  const m = await mascotaPorId(req.sql, req.params.id, bloquear)
  if (!m) return fail(404, 'Mascota no encontrada')
  if (m.tutor_id !== u.id) return fail(403, 'Sin permiso')
  return [u, m]
}

on('GET', '/mascotas', async req => {
  const u = await auth(req, 'tutor')
  return req.sql(`select ${MASCOTA}, (select md.token from medallas md where md.mascota_id = m.id and md.estado = 'activa') as token_activo
    from mascotas m where m.tutor_id = $1 order by m.creado_en`, [u.id])
})

on('GET', '/mascotas/accesibles', async req => {
  const u = await auth(req, 'clinico')
  const mias = (await clinicasDe(req.sql, u)).map(p => p.id)
  const filas = await req.sql(`select m.id, m.nombre, m.especie, m.raza, m.foto_url, t.nombre_visible as tutor, a.permiso, a.vigente_hasta, m.datos_clinicos->'alertasCriticas' as alertas
    from accesos a join mascotas m on m.id = a.mascota_id join usuarios t on t.id = m.tutor_id
    where a.pyme_id = any($1::uuid[]) and ${conVigencia(vigente, 2)}`, [mias, now()])
  return filas.sort(porTexto(f => f.nombre))
})

on('POST', '/mascotas', async req => {
  const u = await auth(req, 'tutor')
  const d = parse(mascotaSchema, req.body)
  const id = uid()
  await req.sql('insert into mascotas (id, tutor_id, nombre, especie, raza, sexo, fecha_nacimiento, creado_en) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, u.id, d.nombre, d.especie, d.raza || null, d.sexo ?? null, d.fecha_nacimiento ?? null, now()])
  return { id }
})

on('PATCH', '/mascotas/:id', async req => {
  const [, m] = await propia(req, true)
  const d = parse(mascotaSchema.partial(), req.body)
  await req.sql('update mascotas set nombre = $2, especie = $3, raza = $4, sexo = $5, fecha_nacimiento = $6 where id = $1',
    [m.id, d.nombre ?? m.nombre, d.especie ?? m.especie, d.raza ?? m.raza, d.sexo ?? m.sexo, d.fecha_nacimiento ?? m.fecha_nacimiento])
  return { id: m.id }
})

// Tutor dueño, o personal clínico de una veterinaria con acceso vigente.
async function accesoFicha(req: Req, bloquear = false): Promise<[Usuario, Mascota, 'lectura' | 'escritura']> {
  const u = await auth(req, 'tutor', 'clinico')
  const m = await mascotaPorId(req.sql, req.params.id, bloquear)
  if (!m) return fail(404, 'Mascota no encontrada')
  if (u.rol === 'tutor' && m.tutor_id === u.id) return [u, m, 'escritura']
  if (u.rol === 'clinico') {
    const accesos = await req.sql<{ permiso: string }>(`select a.permiso from accesos a
      join miembros mb on mb.pyme_id = a.pyme_id and mb.usuario_id = $2 and 'pacientes' = any(mb.permisos)
      where a.mascota_id = $1 and ${conVigencia(vigente, 3)}`, [m.id, u.id, now()])
    if (accesos.some(a => a.permiso === 'escritura')) return [u, m, 'escritura']
    if (accesos[0]) return [u, m, 'lectura']
  }
  return fail(403, 'Sin acceso a esta ficha')
}

async function guardarFicha(sql: Sql, m: Mascota, datos: FichaDatos) {
  const [r] = await sql<{ ficha_version: number }>('update mascotas set datos_clinicos = $2::jsonb, ficha_version = ficha_version + 1 where id = $1 returning ficha_version', [m.id, JSON.stringify(datos)])
  return { id: m.id, datos_clinicos: datos, version: r.ficha_version }
}

const versionOk = (m: Mascota, version: number) => {
  if (version !== m.ficha_version) fail(409, 'La ficha fue modificada por otra persona. Recarga e inténtalo de nuevo')
}

on('GET', '/mascotas/:id/ficha', async req => { const [, m] = await accesoFicha(req); return { id: m.id, datos_clinicos: m.datos_clinicos, version: m.ficha_version } })

// Control de concurrencia por versión: si otra persona guardó antes, 409. La fila queda bloqueada hasta terminar.
on('PUT', '/mascotas/:id/ficha', async req => {
  const [, m, permiso] = await accesoFicha(req, true)
  if (permiso !== 'escritura') return fail(403, 'Acceso de solo lectura')
  const d = parse(z.object({ version: z.number().int().positive(), datos_clinicos: fichaSchema }), req.body)
  versionOk(m, d.version)
  protegerRegistrosClinicos(m.datos_clinicos, d.datos_clinicos)
  return guardarFicha(req.sql, m, d.datos_clinicos)
})

// ---------- Registros clínicos con autoría ----------
type Registro = { id?: string; fecha?: string; inicio?: string; nombre?: string; motivo?: string; descripcion?: string; notas?: string; proxima?: string; registrado_por?: string; clinica?: string; anulado?: { motivo: string; en: string } }
const registrosDe = (f: FichaDatos): Registro[] => [...f.vacunas, ...f.atenciones, ...f.tratamientos]

// Los registros de una clínica solo los cambia esa clínica: el tutor no puede editarlos, borrarlos ni firmar como clínica.
// Comparación sin depender del orden de las claves ni de campos vacíos.
const canonico = (r: Registro | undefined) => r ? JSON.stringify(Object.entries(r).filter(([, v]) => v !== undefined && v !== '').sort(([a], [b]) => a.localeCompare(b))) : ''

function protegerRegistrosClinicos(prev: FichaDatos, next: FichaDatos) {
  const antes = new Map(registrosDe(prev).filter(r => r.registrado_por && r.id).map(r => [r.id!, canonico(r)]))
  const despues = new Map(registrosDe(next).filter(r => r.id).map(r => [r.id!, r]))
  for (const [id, json] of antes) if (canonico(despues.get(id)) !== json) fail(403, 'Los registros hechos por una clínica no se pueden modificar desde la cuenta del tutor')
  for (const r of registrosDe(next)) if (r.registrado_por && !antes.has(r.id ?? '')) { delete r.registrado_por; delete r.clinica; delete r.anulado }
}

async function clinicaConEscritura(req: Req): Promise<[Mascota, { id: string; nombre_comercial: string }]> {
  const [u, m, permiso] = await accesoFicha(req, true)
  if (u.rol !== 'clinico' || permiso !== 'escritura') return fail(403, 'Necesitas acceso de registro a esta ficha')
  const clinica = await una<{ id: string; nombre_comercial: string }>(req.sql, `select p.id, p.nombre_comercial from accesos a
    join pymes p on p.id = a.pyme_id
    join miembros mb on mb.pyme_id = a.pyme_id and mb.usuario_id = $2 and 'pacientes' = any(mb.permisos)
    where a.mascota_id = $1 and a.permiso = 'escritura' and ${conVigencia(vigente, 3)} limit 1`, [m.id, u.id, now()])
  return [m, clinica!]
}

const registroSchema = z.object({
  version: z.number().int().positive(),
  tipo: z.enum(['atencion', 'vacuna', 'tratamiento']),
  fecha,
  titulo: z.string().trim().min(3, 'Describe el registro').max(200),
  notas: z.string().trim().max(500).optional(),
  proxima: fecha.optional(),
})

on('POST', '/mascotas/:id/registros', async req => {
  const [m, clinica] = await clinicaConEscritura(req)
  const d = parse(registroSchema, req.body)
  versionOk(m, d.version)
  const firma = { id: uid(), registrado_por: clinica.id, clinica: clinica.nombre_comercial, ...(d.notas ? { notas: d.notas } : {}) }
  const f = m.datos_clinicos
  if (d.tipo === 'vacuna') f.vacunas.push({ ...firma, nombre: d.titulo, fecha: d.fecha, ...(d.proxima ? { proxima: d.proxima } : {}) })
  else if (d.tipo === 'tratamiento') f.tratamientos.push({ ...firma, descripcion: d.titulo, inicio: d.fecha })
  else f.atenciones.push({ ...firma, motivo: d.titulo, fecha: d.fecha })
  return guardarFicha(req.sql, m, f)
})

function registroPropio(m: Mascota, clinicaId: string, rid: string) {
  const r = registrosDe(m.datos_clinicos).find(x => x.id === rid)
  if (!r) return fail(404, 'Registro no encontrado')
  if (r.registrado_por !== clinicaId) return fail(403, 'Solo puedes cambiar los registros de tu clínica')
  if (r.anulado) return fail(422, 'El registro está anulado')
  return r
}

on('PATCH', '/mascotas/:id/registros/:rid', async req => {
  const [m, clinica] = await clinicaConEscritura(req)
  const d = parse(registroSchema.omit({ tipo: true }), req.body)
  versionOk(m, d.version)
  const r = registroPropio(m, clinica.id, req.params.rid)
  if ('nombre' in r) { r.nombre = d.titulo; r.fecha = d.fecha; if (d.proxima) r.proxima = d.proxima; else delete r.proxima }
  else if ('descripcion' in r) { r.descripcion = d.titulo; r.inicio = d.fecha }
  else { r.motivo = d.titulo; r.fecha = d.fecha }
  if (d.notas) r.notas = d.notas; else delete r.notas
  return guardarFicha(req.sql, m, m.datos_clinicos)
})

// Anular no borra: el registro queda tachado con el motivo, para que el historial sea trazable.
on('POST', '/mascotas/:id/registros/:rid/anular', async req => {
  const [m, clinica] = await clinicaConEscritura(req)
  const d = parse(z.object({ version: z.number().int().positive(), motivo: z.string().trim().min(5, 'Indica el motivo de la anulación (mínimo 5 caracteres)').max(200) }), req.body)
  versionOk(m, d.version)
  registroPropio(m, clinica.id, req.params.rid).anulado = { motivo: d.motivo, en: now() }
  return guardarFicha(req.sql, m, m.datos_clinicos)
})

// ---------- Medallas QR ----------
on('POST', '/mascotas/:id/medallas', async req => {
  const [, m] = await propia(req, true)
  const reemplazadas = await req.sql("update medallas set estado = 'reemplazada' where mascota_id = $1 and estado = 'activa' returning id", [m.id])
  const nueva = { id: uid(), token: uid().replace(/-/g, ''), estado: 'activa' as const, emitida_en: now() }
  await req.sql('insert into medallas (id, mascota_id, token, estado, emitida_en) values ($1, $2, $3, $4, $5)', [nueva.id, m.id, nueva.token, nueva.estado, nueva.emitida_en])
  return { id: nueva.id, token_publico: nueva.token, estado: nueva.estado, emitida_en: nueva.emitida_en, reemplazo: reemplazadas.length > 0 }
})

on('DELETE', '/mascotas/:id/medallas/activa', async req => {
  const [, m] = await propia(req)
  const filas = await req.sql("update medallas set estado = 'inactiva' where mascota_id = $1 and estado = 'activa' returning id", [m.id])
  return { desactivadas: filas.length }
})

// ---------- Accesos de veterinarias ----------
on('GET', '/mascotas/:id/accesos', async req => {
  const [, m] = await propia(req)
  return req.sql(`select a.id, a.permiso, a.vigente_hasta, p.nombre_comercial as clinica from accesos a join pymes p on p.id = a.pyme_id
    where a.mascota_id = $1 and ${conVigencia(vigente, 2)} order by a.vigente_hasta`, [m.id, now()])
})

on('POST', '/mascotas/:id/accesos', async req => {
  const [u, m] = await propia(req)
  const d = parse(z.object({ pyme_id: z.string().min(1, 'Elige una veterinaria'), permiso: z.enum(['lectura', 'escritura']), dias: z.number().int().min(1).max(30, 'El acceso dura como máximo 30 días') }), req.body)
  const p = await una<{ id: string }>(req.sql, "select id from pymes where id = $1 and rubro = 'veterinaria' and estado_verificacion = 'aprobada'", [idDe(d.pyme_id)])
  if (!p) return fail(400, 'Solo se puede compartir con una veterinaria verificada')
  const a = { id: uid(), permiso: d.permiso, vigente_hasta: new Date(Date.now() + d.dias * 86_400_000).toISOString() }
  await req.sql('insert into accesos (id, mascota_id, pyme_id, otorgado_por, permiso, vigente_hasta) values ($1, $2, $3, $4, $5, $6)', [a.id, m.id, p.id, u.id, a.permiso, a.vigente_hasta])
  return a
})

on('DELETE', '/mascotas/:id/accesos/:accesoId', async req => {
  const [, m] = await propia(req)
  const filas = await req.sql('update accesos set revocado_en = $3 where id = $1 and mascota_id = $2 and revocado_en is null returning id', [idDe(req.params.accesoId), m.id, now()])
  return { revocados: filas.length }
})

// ---------- Avisos de quien encuentra a la mascota ----------
const MENSAJE = 'x.id, x.remitente_nombre, x.remitente_contacto, x.mensaje, x.latitud, x.longitud, x.estado, x.enviado_en'

on('GET', '/mascotas/:id/mensajes', async req => {
  const [, m] = await propia(req)
  return req.sql(`select ${MENSAJE} from mensajes_qr x join medallas md on md.id = x.medalla_id where md.mascota_id = $1 order by x.enviado_en desc`, [m.id])
})

on('PATCH', '/mascotas/mensajes/:id', async req => {
  const u = await auth(req, 'tutor')
  const d = parse(z.object({ estado: z.enum(['leido', 'respondido']) }), req.body)
  const filas = await req.sql(`update mensajes_qr x set estado = $3 from medallas md, mascotas m
    where x.id = $1 and md.id = x.medalla_id and m.id = md.mascota_id and m.tutor_id = $2 returning x.id`, [idDe(req.params.id), u.id, d.estado])
  if (!filas.length) return fail(403, 'Sin permiso')
  return { ok: true }
})

// ---------- QR público (sin sesión) ----------
async function medallaActiva(req: Req) {
  const token = req.params.token
  if (!QR_TOKEN.test(token)) return fail(404, 'Medalla no válida')
  const r = await una<Mascota & { medalla_id: string; medalla_estado: string }>(req.sql, `select md.id as medalla_id, md.estado as medalla_estado, ${MASCOTA} from medallas md join mascotas m on m.id = md.mascota_id where md.token = $1`, [token])
  if (!r) return fail(404, 'Medalla no válida')
  // Reemplazada o desactivada por el tutor: 410 para que quien la escanea sepa qué pasó, sin datos de la mascota.
  if (r.medalla_estado !== 'activa') return fail(410, 'Medalla desactivada')
  return r
}

on('GET', '/qr/:token', async req => {
  const m = await medallaActiva(req)
  await req.sql('insert into escaneos (medalla_id, ocurrido_en) values ($1, $2)', [m.medalla_id, now()])
  const c = m.datos_clinicos
  return {
    nombre: m.nombre, especie: m.especie, raza: m.raza, foto_url: m.foto_url,
    alergias: c.alergias.map(a => ({ agente: a.agente, gravedad: a.gravedad })),
    alertasCriticas: c.alertasCriticas, condiciones: c.condiciones, notaEmergencia: c.notaEmergencia,
  }
})

on('POST', '/qr/:token/mensajes', async req => {
  const m = await medallaActiva(req)
  const d = parse(z.object({
    mensaje: z.string().trim().min(10, 'El mensaje debe tener al menos 10 caracteres').max(500, 'El mensaje admite hasta 500 caracteres'),
    nombre: z.string().trim().max(80).optional(),
    contacto: z.string().trim().max(120).optional(),
    latitud: z.number().min(-90).max(90).optional(),
    longitud: z.number().min(-180).max(180).optional(),
  }), req.body)
  await req.sql('insert into mensajes_qr (id, medalla_id, remitente_nombre, remitente_contacto, mensaje, latitud, longitud, estado, enviado_en) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [uid(), m.medalla_id, d.nombre || null, d.contacto || null, d.mensaje, d.latitud ?? null, d.longitud ?? null, 'nuevo', now()])
  // Aviso al tutor. Si el correo no sale, el mensaje igual queda guardado y el tutor lo ve en la ficha.
  // La copia de la bandeja omite el mensaje y los datos de quien escribió.
  const tutor = await una<{ correo: string; nombre_visible: string }>(req.sql, "select correo, nombre_visible from usuarios where id = $1 and estado = 'activo'", [m.tutor_id])
  if (tutor) {
    const c = correoAvisoQr(tutor.nombre_visible, m.nombre, d, baseApp())
    // Punto de guardado: un error al registrar el aviso no puede deshacer el mensaje de quien encontró la mascota.
    await req.sql('savepoint aviso_qr')
    try {
      await enviarCorreo(req.sql, tutor.correo, c.asunto, c.cuerpo, 'aviso_qr', c.detalles, { obligatorio: false, oculto: '[mensaje enviado solo al tutor]' })
      await req.sql('release savepoint aviso_qr')
    } catch (error) {
      await req.sql('rollback to savepoint aviso_qr')
      console.error('No se pudo registrar el aviso al tutor:', error)
    }
  }
  return { ok: true }
})
