// Publicidad sin imágenes, convenios Pyme–ONG con cupones, perfil público (CMS) de las ONG y aprobaciones del asesor.
import { z } from 'zod'
import { ONG_CUPOS } from '../../src/modules/plans/plans'
import { auth, avisarAsesores, correoDe, enviarCorreo } from './auth'
import { comunasDe, dayOffset, fail, fecha, idDe, mesActual, now, on, parse, porTexto, sinEnlaces, sumarDias, uid, una } from './core'
import type { Row, Sql } from './db'
import { fotoSubidaSchema } from '../../src/shared/validators'
import { miOng, VISIBLE, type Ong } from './adopcion'
import { cuponesVigentes, estadoPlanDe, exigirCupo, miPyme, permisosEnPyme, planDe, suscripcionesDe, type Pyme } from './negocio'

const texto = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max).refine(sinEnlaces, 'No se permiten enlaces externos')

// ---------- Banners ----------
type Banner = {
  id: string; autor_tipo: 'pyme' | 'ong'; autor_id: string; titulo: string; texto: string; destino: string; ubicacion: string; comuna_id: number | null; tono: string
  desde: string; hasta: string; estado: 'pendiente' | 'aprobado' | 'rechazado' | 'retirado'; motivo: string | null; revisado_por: string | null; impresiones: number; clics: number; creado_en: string
}
// En la base el autor son dos columnas (pyme_id u ong_id); el API lo entrega como autor_id, igual que el mock.
const bannerDe = ({ pyme_id, ong_id, ...b }: Row): Banner => ({ ...b, autor_id: pyme_id ?? ong_id }) as Banner
const BANNER_AUTOR = "coalesce(p.nombre_comercial, o.nombre, case when b.autor_tipo = 'pyme' then 'Negocio' else 'ONG' end) as autor"
const BANNER_JOIN = 'left join pymes p on p.id = b.pyme_id left join ongs o on o.id = b.ong_id'

const bannerSchema = z.object({
  titulo: texto(5, 60, 'El título debe tener entre 5 y 60 caracteres'),
  texto: texto(10, 140, 'El texto debe tener entre 10 y 140 caracteres'),
  destino: z.enum(['perfil', 'adopciones', 'convenio']),
  ubicacion: z.enum(['inicio', 'directorio', 'muro']),
  comuna_id: z.number().int().positive().nullable().default(null),
  tono: z.enum(['acento', 'calido', 'info']).default('acento'),
  desde: fecha, hasta: fecha,
}).refine(b => b.hasta >= b.desde, { message: 'La fecha de término debe ser posterior al inicio', path: ['hasta'] })
  .refine(b => b.desde >= dayOffset(0), { message: 'El banner no puede empezar en el pasado', path: ['desde'] })
  .refine(b => b.hasta <= sumarDias(b.desde, 30), { message: 'Un banner dura como máximo 30 días; luego puedes renovarlo', path: ['hasta'] })

async function parseBanner(sql: Sql, body: unknown) {
  const d = parse(bannerSchema, body)
  if (d.comuna_id !== null && !(await comunasDe(sql)).has(d.comuna_id)) fail(400, 'Comuna no válida')
  return d
}

async function crearBanner(sql: Sql, autor_tipo: Banner['autor_tipo'], autor_id: string, d: z.infer<typeof bannerSchema>): Promise<Banner> {
  const b: Banner = { id: uid(), autor_tipo, autor_id, ...d, estado: 'pendiente', motivo: null, revisado_por: null, impresiones: 0, clics: 0, creado_en: now() }
  await sql(`insert into banners (id, autor_tipo, pyme_id, ong_id, titulo, texto, destino, ubicacion, comuna_id, tono, desde, hasta, estado, impresiones, clics, creado_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, 0, $14)`,
  [b.id, autor_tipo, autor_tipo === 'pyme' ? autor_id : null, autor_tipo === 'ong' ? autor_id : null, b.titulo, b.texto, b.destino, b.ubicacion, b.comuna_id, b.tono, b.desde, b.hasta, b.estado, b.creado_en])
  return b
}

async function retirarBanner(sql: Sql, columna: 'pyme_id' | 'ong_id', autorId: string, id: unknown) {
  const filas = await sql(`update banners set estado = 'retirado' where id = $1 and ${columna} = $2 returning id`, [idDe(id), autorId])
  if (!filas.length) fail(404, 'Banner no encontrado')
}

on('GET', '/pymes/:id/banners', async req => {
  const p = await miPyme(req, 'publicidad')
  return (await req.sql('select * from banners where pyme_id = $1 order by creado_en desc', [p.id])).map(bannerDe)
})
on('POST', '/pymes/:id/banners', async req => {
  const p = await miPyme(req, 'publicidad')
  const d = await parseBanner(req.sql, req.body)
  if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para publicar banners')
  if (d.destino === 'adopciones') return fail(400, 'Los banners de adopción son exclusivos de las ONG')
  await exigirCupo(req.sql, p.id, 'banners')
  const b = await crearBanner(req.sql, 'pyme', p.id, d)
  await avisarAsesores(req.sql, `Banner por revisar: ${p.nombre_comercial}`, `«${b.titulo}» espera tu aprobación en Aprobaciones.`)
  return b
})
on('DELETE', '/pymes/:id/banners/:bid', async req => {
  const p = await miPyme(req, 'publicidad')
  await retirarBanner(req.sql, 'pyme_id', p.id, req.params.bid)
  return undefined
})
on('GET', '/ong/banners', async req => {
  const o = await miOng(req)
  return (await req.sql('select * from banners where ong_id = $1 order by creado_en desc', [o.id])).map(bannerDe)
})
on('POST', '/ong/banners', async req => {
  const o = await miOng(req)
  const d = await parseBanner(req.sql, req.body)
  if (o.estado_verificacion !== 'aprobada') return fail(422, 'Tu organización debe estar verificada para publicar banners')
  const activos = Number((await una(req.sql, "select count(*)::int as n from banners where ong_id = $1 and estado in ('pendiente', 'aprobado') and hasta >= $2", [o.id, dayOffset(0)]))?.n)
  if (ONG_CUPOS.banners !== null && activos >= ONG_CUPOS.banners) return fail(422, `Las ONG pueden tener ${ONG_CUPOS.banners} banner activo a la vez, sin costo`)
  const b = await crearBanner(req.sql, 'ong', o.id, d)
  await avisarAsesores(req.sql, `Banner por revisar: ${o.nombre}`, `«${b.titulo}» espera tu aprobación en Aprobaciones.`)
  return b
})
on('DELETE', '/ong/banners/:bid', async req => {
  const o = await miOng(req)
  await retirarBanner(req.sql, 'ong_id', o.id, req.params.bid)
  return undefined
})

// Público: banners aprobados y vigentes para una ubicación. Los de planes con más visibilidad van primero.
on('GET', '/banners', async req => {
  const ubicacion = req.query.get('ubicacion') || 'inicio', comuna = Number(req.query.get('comuna') || 0)
  const hoy = dayOffset(0)
  const filas = await req.sql(`select b.*, ${BANNER_AUTOR} from banners b ${BANNER_JOIN}
    where b.estado = 'aprobado' and b.ubicacion = $1 and b.desde <= $2 and b.hasta >= $2
      and (b.autor_tipo = 'ong' or p.estado_verificacion = 'aprobada') order by b.creado_en`, [ubicacion, hoy])
  const subs = await suscripcionesDe(req.sql, [...new Set(filas.filter(b => b.pyme_id).map(b => b.pyme_id as string))])
  const prioridad = (b: Row) => b.autor_tipo === 'pyme' ? estadoPlanDe(subs.get(b.pyme_id) ?? []).plan.beneficios.destacado : 1
  const vigentes = filas.filter(b => !b.comuna_id || !comuna || b.comuna_id === comuna).sort((a, b) => prioridad(b) - prioridad(a)).slice(0, 3)
  if (vigentes.length) await req.sql('update banners set impresiones = impresiones + 1 where id = any($1::uuid[])', [vigentes.map(b => b.id)])
  return vigentes.map(r => { const b = bannerDe(r); return { id: b.id, titulo: b.titulo, texto: b.texto, tono: b.tono, destino: b.destino, autor_tipo: b.autor_tipo, autor_id: b.autor_id, autor: r.autor } })
})
on('POST', '/banners/:id/clic', async req => {
  await req.sql("update banners set clics = clics + 1 where id = $1 and estado = 'aprobado'", [idDe(req.params.id)])
  return { ok: true }
})

// ---------- Convenios Pyme–ONG y cupones ----------
const convenioSchema = z.object({
  ong_id: z.string().min(1, 'Elige la ONG aliada'),
  titulo: texto(5, 80, 'Describe el beneficio en 5 a 80 caracteres'),
  descuento_pct: z.number().int().min(5, 'El descuento mínimo es 5 %').max(50, 'El descuento máximo es 50 %'),
  condiciones: texto(10, 300, 'Indica las condiciones (mínimo 10 caracteres)'),
  desde: fecha, hasta: fecha,
  meta_mensual: z.number().int().min(10).max(1000).default(100),
  premio: texto(5, 120, 'Describe el premio').default('Premio de alimentos PetSuite: 2 sacos de 15 kg'),
}).refine(c => c.hasta > c.desde, { message: 'La fecha de término debe ser posterior al inicio', path: ['hasta'] })
  .refine(c => c.hasta <= sumarDias(c.desde, 366), { message: 'Un convenio dura como máximo un año', path: ['hasta'] })
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8)

type Convenio = { id: string; pyme_id: string; ong_id: string; titulo: string; descuento_pct: number; condiciones: string; codigo: string; desde: string; hasta: string; meta_mensual: number; premio: string; estado: string; motivo: string | null; creado_en: string }

// Vista del convenio con nombres, canjes del mes y premios, igual que vistaConvenio del mock.
async function vistasConvenio(sql: Sql, filtro: string, params: unknown[]) {
  const filas = await sql<Convenio & Row>(`select c.*, o.nombre as ong, p.nombre_comercial as negocio,
      (select count(*)::int from canjes k where k.convenio_id = c.id and to_char(k.ocurrido_en at time zone 'UTC', 'YYYY-MM') = $1) as canjes_mes,
      (select count(*)::int from canjes k where k.convenio_id = c.id) as canjes_total,
      coalesce((select json_agg(json_build_object('mes', pc.mes, 'otorgado_en', pc.otorgado_en) order by pc.otorgado_en) from premios_convenio pc where pc.convenio_id = c.id), '[]'::json) as premios
    from convenios c join ongs o on o.id = c.ong_id join pymes p on p.id = c.pyme_id where ${filtro}`, [mesActual(), ...params])
  return filas.map(c => {
    const premios = (c.premios as { mes: string; otorgado_en: string }[]).map(x => ({ mes: x.mes, otorgado_en: new Date(x.otorgado_en).toISOString() }))
    return { ...c, premios, meta_cumplida: premios.some(x => x.mes === mesActual()) }
  })
}
const vistaConvenio = async (sql: Sql, id: string) => (await vistasConvenio(sql, 'c.id = $2', [id]))[0]

on('GET', '/ongs', async req => {
  const comunas = await comunasDe(req.sql)
  const cupones = await cuponesVigentes(req.sql)
  const ongs = await req.sql<Ong & { animales: number }>(`select o.*, (select count(*)::int from animales a where a.ong_id = o.id and ${VISIBLE}) as animales
    from ongs o where o.estado_verificacion = 'aprobada'`)
  return ongs.sort(porTexto(o => o.nombre)).map(o => ({
    id: o.id, nombre: o.nombre, tipo: o.tipo, comuna: comunas.get(o.comuna_id) ?? '', mision: (o.perfil_publicado?.mision as string | undefined) ?? o.descripcion,
    emblema: o.perfil_publicado?.emblema ?? 'heart', color: o.perfil_publicado?.color ?? 'acento', animales: o.animales, cupones: cupones.filter(c => c.ong_id === o.id).length,
  }))
})

// Perfil público de la ONG: solo la versión aprobada por el asesor, sus animales disponibles, cupones e impacto.
on('GET', '/ongs/:id', async req => {
  const o = await una<Ong>(req.sql, "select * from ongs where id = $1 and estado_verificacion = 'aprobada'", [idDe(req.params.id)])
  if (!o) return fail(404, 'Organización no encontrada')
  const impacto = await una(req.sql, `select
      (select count(*)::int from canjes k join convenios c on c.id = k.convenio_id where c.ong_id = $1 and c.estado in ('activo', 'finalizado') and to_char(k.ocurrido_en at time zone 'UTC', 'YYYY-MM') = $2) as canjes_mes,
      (select count(*)::int from canjes k join convenios c on c.id = k.convenio_id where c.ong_id = $1 and c.estado in ('activo', 'finalizado')) as canjes_total,
      (select count(distinct c.pyme_id)::int from convenios c where c.ong_id = $1 and c.estado in ('activo', 'finalizado')) as aliados`, [o.id, mesActual()])
  return {
    id: o.id, nombre: o.nombre, tipo: o.tipo, comuna: (await comunasDe(req.sql)).get(o.comuna_id) ?? '', descripcion: o.descripcion, contacto: o.contacto, redes_sociales: o.redes_sociales, perfil: o.perfil_publicado,
    animales: await req.sql(`select a.id, a.nombre, a.especie, a.foto_url, a.edad_estimada from animales a where a.ong_id = $1 and ${VISIBLE} order by a.publicado_en`, [o.id]),
    cupones: (await cuponesVigentes(req.sql)).filter(c => c.ong_id === o.id),
    impacto,
  }
})

on('GET', '/pymes/:id/convenios', async req => {
  const p = await miPyme(req, 'convenios')
  return vistasConvenio(req.sql, 'c.pyme_id = $2 order by c.creado_en desc', [p.id])
})
on('POST', '/pymes/:id/convenios', async req => {
  const p = await miPyme(req, 'convenios')
  const d = parse(convenioSchema, req.body)
  if (p.estado_verificacion !== 'aprobada') return fail(422, 'Tu negocio debe estar verificado para proponer convenios')
  const o = await una<Ong>(req.sql, "select * from ongs where id = $1 and estado_verificacion = 'aprobada'", [idDe(d.ong_id)])
  if (!o) return fail(400, 'Elige una ONG verificada')
  await exigirCupo(req.sql, p.id, 'convenios')
  const base = `${slug(o.nombre)}-${slug(p.nombre_comercial)}${d.descuento_pct}`
  let codigo = base
  for (let n = 2; await una(req.sql, 'select 1 from convenios where upper(codigo) = upper($1)', [codigo]); n++) codigo = `${base}${n}`
  const id = uid()
  await req.sql(`insert into convenios (id, pyme_id, ong_id, titulo, descuento_pct, condiciones, codigo, desde, hasta, meta_mensual, premio, estado, creado_en)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pendiente_ong', $12)`, [id, p.id, o.id, d.titulo, d.descuento_pct, d.condiciones, codigo, d.desde, d.hasta, d.meta_mensual, d.premio, now()])
  await enviarCorreo(req.sql, await correoDe(req.sql, o.propietario_id), `${p.nombre_comercial} propone un convenio`, `Hola:\n\n${p.nombre_comercial} propone «${d.titulo}» (${d.descuento_pct} %) para tu comunidad, con el código ${codigo}.\nRevísalo en Convenios para aceptarlo o rechazarlo.\n\nEquipo PetSuite`, 'convenio')
  return vistaConvenio(req.sql, id)
})
on('POST', '/pymes/:id/convenios/:cid/finalizar', async req => {
  const p = await miPyme(req, 'convenios')
  const filas = await req.sql("update convenios set estado = 'finalizado' where id = $1 and pyme_id = $2 and estado not in ('rechazado', 'finalizado') returning id", [idDe(req.params.cid), p.id])
  if (!filas.length) return fail(404, 'Convenio no disponible')
  return vistaConvenio(req.sql, filas[0].id)
})

// Registra una venta hecha con el código de la ONG. Al llegar a la meta del mes se otorga el premio (una vez por mes).
on('POST', '/pymes/:id/canjes', async req => {
  const p = await miPyme(req, 'convenios')
  const u = await auth(req)
  const d = parse(z.object({ codigo: z.string().trim().min(3, 'Ingresa el código del cupón').max(40), sucursal_id: z.string().nullable().optional(), monto_clp: z.number().int().min(0).max(100_000_000).nullable().optional() }), req.body)
  const hoy = dayOffset(0)
  const c = await una<Convenio>(req.sql, 'select * from convenios where pyme_id = $1 and codigo = $2 for update', [p.id, d.codigo.toUpperCase()])
  if (!c) return fail(404, 'El código no corresponde a un convenio de tu negocio')
  if (c.estado !== 'activo' || c.desde > hoy || c.hasta < hoy) return fail(422, 'Este convenio no está vigente')
  const miembro = (await permisosEnPyme(req.sql, u, p))?.miembro
  const sucursal = miembro ? miembro.sucursal_id : d.sucursal_id ?? null
  if (sucursal && !(await una(req.sql, 'select 1 from sucursales where id = $1 and pyme_id = $2', [idDe(sucursal), p.id]))) return fail(400, 'Sucursal no válida')
  await req.sql('insert into canjes (id, convenio_id, sucursal_id, monto_clp, registrado_por, ocurrido_en) values ($1, $2, $3, $4, $5, $6)', [uid(), c.id, sucursal, d.monto_clp ?? null, u.id, now()])
  const delMes = Number((await una(req.sql, "select count(*)::int as n from canjes where convenio_id = $1 and to_char(ocurrido_en at time zone 'UTC', 'YYYY-MM') = $2", [c.id, mesActual()]))?.n)
  let premio = false
  if (delMes >= c.meta_mensual) {
    premio = (await req.sql('insert into premios_convenio (convenio_id, mes, otorgado_en) values ($1, $2, $3) on conflict do nothing returning mes', [c.id, mesActual(), now()])).length > 0
    if (premio) {
      const o = await una<Ong>(req.sql, 'select * from ongs where id = $1', [c.ong_id])
      const aviso = `El convenio «${c.titulo}» entre ${p.nombre_comercial} y ${o?.nombre ?? 'la ONG'} llegó a ${c.meta_mensual} canjes este mes.\nPremio: ${c.premio}.`
      await enviarCorreo(req.sql, await correoDe(req.sql, p.propietario_id), '¡Meta del convenio cumplida!', `${aviso}\nTu asesor coordinará la entrega.\n\nEquipo PetSuite`, 'premio')
      if (o) await enviarCorreo(req.sql, await correoDe(req.sql, o.propietario_id), '¡Tu comunidad cumplió la meta del convenio!', `${aviso}\n\nEquipo PetSuite`, 'premio')
      await avisarAsesores(req.sql, `Premio por entregar: ${p.nombre_comercial}`, aviso)
    }
  }
  return { ok: true, canjes_mes: delMes, meta: c.meta_mensual, premio }
})

on('GET', '/ong/convenios', async req => {
  const o = await miOng(req)
  return vistasConvenio(req.sql, 'c.ong_id = $2 order by c.creado_en desc', [o.id])
})
on('PATCH', '/ong/convenios/:cid', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ decision: z.enum(['aceptar', 'rechazar']), motivo: z.string().trim().max(300).optional() }), req.body)
  const c = await una<Convenio>(req.sql, "select * from convenios where id = $1 and ong_id = $2 and estado = 'pendiente_ong' for update", [idDe(req.params.cid), o.id])
  if (!c) return fail(404, 'Convenio no disponible')
  const p = await una<Pyme>(req.sql, 'select * from pymes where id = $1', [c.pyme_id])
  if (d.decision === 'aceptar') {
    await req.sql("update convenios set estado = 'pendiente_asesor' where id = $1", [c.id])
    await avisarAsesores(req.sql, `Convenio por aprobar: ${p?.nombre_comercial} × ${o.nombre}`, `«${c.titulo}» fue aceptado por la ONG y espera tu aprobación.`)
  } else await req.sql("update convenios set estado = 'rechazado', motivo = $2 where id = $1", [c.id, d.motivo || 'Rechazado por la ONG'])
  await enviarCorreo(req.sql, await correoDe(req.sql, p?.propietario_id), `Convenio ${d.decision === 'aceptar' ? 'aceptado' : 'rechazado'} por ${o.nombre}`, `«${c.titulo}» fue ${d.decision === 'aceptar' ? 'aceptado por la ONG y pasa a revisión del asesor PetSuite' : `rechazado por la ONG${d.motivo ? `: ${d.motivo}` : ''}`}.\n\nEquipo PetSuite`, 'convenio')
  return vistaConvenio(req.sql, c.id)
})

// ---------- CMS de la ONG ----------
const ongPerfilSchema = z.object({
  mision: texto(20, 600, 'Cuenta tu misión en al menos 20 caracteres'),
  como_ayudar: z.string().trim().max(600).refine(sinEnlaces, 'No se permiten enlaces externos').default(''),
  necesidades: z.array(z.string().trim().min(2).max(60)).max(10, 'Indica hasta 10 necesidades').default([]),
  voluntariado: z.string().trim().max(400).refine(sinEnlaces, 'No se permiten enlaces externos').default(''),
  horario_visitas: z.string().trim().max(80).default(''),
  donaciones: z.object({
    banco: z.string().trim().min(2, 'Indica el banco').max(60), tipo_cuenta: z.string().trim().min(2, 'Indica el tipo de cuenta').max(40),
    numero: z.string().trim().regex(/^[\d-]{4,30}$/, 'Número de cuenta inválido'), titular: z.string().trim().min(2, 'Indica el titular').max(100),
    rut: z.string().trim().regex(/^\d{7,8}-[\dkK]$/, 'RUT inválido (ej. 65123456-7)'), correo: z.string().trim().email('Correo de donaciones inválido'),
  }).nullable().default(null),
  emblema: z.enum(['heart', 'paw', 'home', 'shield']).default('heart'),
  color: z.enum(['acento', 'calido', 'info', 'vino']).default('acento'),
  // Portada opcional: una foto subida por la ONG. Pasa por la misma revisión del asesor que el resto del perfil.
  foto_portada: fotoSubidaSchema.nullable().default(null),
})
on('GET', '/ong/perfil', async req => {
  const o = await miOng(req)
  return { nombre: o.nombre, estado_verificacion: o.estado_verificacion, publicado: o.perfil_publicado, borrador: o.perfil_borrador, estado: o.perfil_estado, motivo: o.perfil_motivo }
})
// Guardar deja un borrador; enviar lo pasa a revisión. Lo público no cambia hasta que el asesor aprueba (evita datos bancarios fraudulentos).
on('PUT', '/ong/perfil', async req => {
  const o = await miOng(req)
  const d = parse(z.object({ perfil: ongPerfilSchema, enviar: z.boolean().default(false) }), req.body)
  const estado = d.enviar ? 'en_revision' : 'sin_enviar'
  await req.sql('update ongs set perfil_borrador = $2::jsonb, perfil_estado = $3, perfil_motivo = null where id = $1', [o.id, JSON.stringify(d.perfil), estado])
  if (d.enviar) await avisarAsesores(req.sql, `Perfil de ONG por revisar: ${o.nombre}`, `${o.nombre} envió cambios a su perfil público${d.perfil.donaciones ? ', incluidos datos para donaciones' : ''}.`)
  return { estado }
})

// ---------- Aprobaciones del asesor ----------
on('GET', '/asesor/aprobaciones', async req => {
  await auth(req, 'asesor', 'admin')
  const comunas = await comunasDe(req.sql)
  const banners = await req.sql(`select b.*, ${BANNER_AUTOR} from banners b ${BANNER_JOIN} where b.estado = 'pendiente' order by b.creado_en`)
  const conPlan = []
  for (const r of banners) {
    const { autor, ...b } = r
    conPlan.push({ ...bannerDe(b), autor, comuna: b.comuna_id ? comunas.get(b.comuna_id) ?? '' : 'Todas', plan: b.autor_tipo === 'pyme' ? (await planDe(req.sql, b.pyme_id)).nombre : 'ONG (sin costo)' })
  }
  const perfiles = await req.sql<Ong>("select * from ongs where perfil_estado = 'en_revision' order by creado_en")
  return {
    banners: conPlan,
    perfiles: perfiles.map(o => ({ id: o.id, nombre: o.nombre, verificada: o.estado_verificacion === 'aprobada', borrador: o.perfil_borrador, publicado: o.perfil_publicado })),
    convenios: await vistasConvenio(req.sql, "c.estado = 'pendiente_asesor' order by c.creado_en", []),
  }
})

const decisionSchema = z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string().trim().max(300).optional() })
  .refine(d => d.decision === 'aprobar' || (d.motivo ?? '').length >= 10, { message: 'Explica el motivo del rechazo (mínimo 10 caracteres)', path: ['motivo'] })

on('PATCH', '/asesor/banners/:id', async req => {
  const u = await auth(req, 'asesor', 'admin')
  const d = parse(decisionSchema, req.body)
  const [b] = await req.sql(`update banners set estado = $2, motivo = $3, revisado_por = $4 where id = $1 and estado = 'pendiente' returning *`,
    [idDe(req.params.id), d.decision === 'aprobar' ? 'aprobado' : 'rechazado', d.motivo || null, u.id])
  if (!b) return fail(404, 'Banner no disponible')
  const dueno = await una<{ propietario_id: string }>(req.sql, b.pyme_id ? 'select propietario_id from pymes where id = $1' : 'select propietario_id from ongs where id = $1', [b.pyme_id ?? b.ong_id])
  await enviarCorreo(req.sql, await correoDe(req.sql, dueno?.propietario_id), `Banner ${d.decision === 'aprobar' ? 'aprobado' : 'rechazado'}: ${b.titulo}`, d.decision === 'aprobar' ? `Tu banner se mostrará del ${b.desde} al ${b.hasta}.\n\nEquipo PetSuite` : `Tu banner no fue aprobado: ${d.motivo}\nPuedes corregirlo y enviarlo de nuevo.\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true }
})

on('PATCH', '/asesor/ong-perfil/:id', async req => {
  await auth(req, 'asesor', 'admin')
  const d = parse(decisionSchema, req.body)
  const o = await una<Ong>(req.sql, "select * from ongs where id = $1 and perfil_estado = 'en_revision' for update", [idDe(req.params.id)])
  if (!o) return fail(404, 'No hay cambios de perfil en revisión')
  if (d.decision === 'aprobar' && o.estado_verificacion !== 'aprobada') return fail(422, 'Primero verifica la organización')
  if (d.decision === 'aprobar') await req.sql("update ongs set perfil_publicado = perfil_borrador, perfil_estado = 'publicado', perfil_motivo = null where id = $1", [o.id])
  else await req.sql("update ongs set perfil_estado = 'rechazado', perfil_motivo = $2 where id = $1", [o.id, d.motivo])
  await enviarCorreo(req.sql, await correoDe(req.sql, o.propietario_id), `Perfil público ${d.decision === 'aprobar' ? 'publicado' : 'con observaciones'}`, d.decision === 'aprobar' ? 'Tus cambios ya se ven en tu perfil público de PetSuite.\n\nEquipo PetSuite' : `Tu asesor dejó observaciones: ${d.motivo}\n\nEquipo PetSuite`, 'aprobacion')
  return { ok: true }
})

on('PATCH', '/asesor/convenios/:id', async req => {
  await auth(req, 'asesor', 'admin')
  const d = parse(decisionSchema, req.body)
  const [c] = await req.sql<Convenio>("update convenios set estado = $2, motivo = $3 where id = $1 and estado = 'pendiente_asesor' returning *",
    [idDe(req.params.id), d.decision === 'aprobar' ? 'activo' : 'rechazado', d.motivo || null])
  if (!c) return fail(404, 'Convenio no disponible')
  const cuerpo = d.decision === 'aprobar' ? `El convenio «${c.titulo}» está activo. Código para difundir: ${c.codigo}.\nMeta mensual: ${c.meta_mensual} canjes. Premio: ${c.premio}.\n\nEquipo PetSuite` : `El convenio «${c.titulo}» no fue aprobado: ${d.motivo}\n\nEquipo PetSuite`
  // Primero el negocio y luego la ONG, como en el mock.
  for (const tabla of ['pymes', 'ongs']) {
    const dueno = await una<{ propietario_id: string }>(req.sql, `select propietario_id from ${tabla} where id = $1`, [tabla === 'pymes' ? c.pyme_id : c.ong_id])
    await enviarCorreo(req.sql, await correoDe(req.sql, dueno?.propietario_id), `Convenio ${d.decision === 'aprobar' ? 'activo' : 'rechazado'}: ${c.codigo}`, cuerpo, 'convenio')
  }
  return { ok: true }
})
