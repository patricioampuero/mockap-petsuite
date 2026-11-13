// KPI de negocio: cálculos compartidos por el mock y el API, así ambos entregan las mismas cifras.
// Las horas se cuentan en la hora de Chile continental (America/Santiago), que es la del negocio y sus clientes.
// Son indicadores para tomar decisiones (cuándo publicar, qué cupón funciona, si una campaña con una ONG atrajo
// visitas), distintos de los SLA de disponibilidad o rendimiento de la plataforma.

export type EventoKpi = { tipo: 'visita_perfil' | 'vista_item' | 'clic_contacto' | 'clic_whatsapp'; ocurrido_en: string }
export type Franja = { franja: string; horas: string; visitas: number }
export type ImpactoCampana = { dias: number; visitas_antes: number; visitas_despues: number; variacion_pct: number | null }

export const FRANJAS = [
  { franja: 'Madrugada', horas: '0 a 6 h', desde: 0, hasta: 6 },
  { franja: 'Mañana', horas: '6 a 12 h', desde: 6, hasta: 12 },
  { franja: 'Tarde', horas: '12 a 18 h', desde: 12, hasta: 18 },
  { franja: 'Noche', horas: '18 a 24 h', desde: 18, hasta: 24 },
] as const

const formatoHora = new Intl.DateTimeFormat('es-CL', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Santiago' })
/** Hora del día (0 a 23) en Chile de un momento ISO. */
export const horaChile = (iso: string) => Number(formatoHora.format(new Date(iso))) % 24

const visitas = (eventos: EventoKpi[]) => eventos.filter(e => e.tipo === 'visita_perfil')

/** Visitas al perfil por franja horaria: muestra cuándo conviene publicar ofertas o responder consultas. */
export const porFranja = (eventos: EventoKpi[]): Franja[] => {
  const horas = visitas(eventos).map(e => horaChile(e.ocurrido_en))
  return FRANJAS.map(f => ({ franja: f.franja, horas: f.horas, visitas: horas.filter(h => h >= f.desde && h < f.hasta).length }))
}

/** Hora con más visitas (0 a 23), o null sin visitas. Ante un empate gana la más temprana. */
export function horaPeak(eventos: EventoKpi[]): number | null {
  const n = new Array<number>(24).fill(0)
  for (const e of visitas(eventos)) n[horaChile(e.ocurrido_en)]++
  const max = Math.max(...n)
  return max ? n.indexOf(max) : null
}

/** Porcentaje de visitas que terminan en un clic para llamar o escribir por WhatsApp, o null sin visitas. */
export function tasaContacto(totales: Record<EventoKpi['tipo'], number>): number | null {
  return totales.visita_perfil ? Math.round(((totales.clic_contacto + totales.clic_whatsapp) / totales.visita_perfil) * 100) : null
}

const dia = 86_400_000
const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00-03:00`).getTime()

/**
 * Impacto de una campaña (convenio con una ONG que empezó en `desde`): visitas al perfil en los días siguientes al
 * inicio comparadas con los mismos días anteriores. Compara hasta 14 días y nunca más de los que lleva la campaña.
 */
export function impactoCampana(eventos: EventoKpi[], desde: string, ahora = Date.now()): ImpactoCampana {
  const inicio = inicioDia(desde)
  const dias = Math.max(1, Math.min(14, Math.ceil((ahora - inicio) / dia)))
  const t = visitas(eventos).map(e => new Date(e.ocurrido_en).getTime())
  const visitas_antes = t.filter(x => x >= inicio - dias * dia && x < inicio).length
  const visitas_despues = t.filter(x => x >= inicio && x < inicio + dias * dia).length
  return { dias, visitas_antes, visitas_despues, variacion_pct: visitas_antes ? Math.round(((visitas_despues - visitas_antes) / visitas_antes) * 100) : null }
}

/** Una campaña se mide si ya empezó, sigue activa o terminó, y empezó hace menos de 90 días. */
export const campanaMedible = (c: { estado: string; desde: string }, hoy: string) =>
  (c.estado === 'activo' || c.estado === 'finalizado') && c.desde <= hoy && inicioDia(c.desde) > inicioDia(hoy) - 90 * dia

/** Días hacia atrás de eventos que necesita el cálculo de campañas (90 de antigüedad más 14 de comparación). */
export const DIAS_EVENTOS_CAMPANAS = 104

/** Los `max` con más conteo; ante un empate, por nombre (el mismo orden en el mock y en el API). */
export const topPorConteo = (conteos: Map<string, number>, max = 5) =>
  [...conteos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max)

/** KPI de la plataforma para el panel del administrador: tráfico de Explorar, contacto y canjes de cupones con ONG. */
export function kpisPlataforma(totales: Record<EventoKpi['tipo'], number>, visitasPorNegocio: Map<string, number>, canjesPorOng: Map<string, number>) {
  return {
    visitas_30d: totales.visita_perfil,
    contactos_30d: totales.clic_contacto + totales.clic_whatsapp,
    tasa_contacto: tasaContacto(totales),
    canjes_30d: [...canjesPorOng.values()].reduce((a, b) => a + b, 0),
    negocios_top: topPorConteo(visitasPorNegocio).map(([nombre, visitas]) => ({ nombre, visitas })),
    ong_top: topPorConteo(canjesPorOng).map(([ong, canjes]) => ({ ong, canjes })),
  }
}

type ConvenioKpi ={ id: string; codigo: string; titulo: string; estado: string; desde: string; ong: string }

/**
 * KPI del panel de métricas de un negocio. La franja horaria y la hora de más visitas se ven desde el plan Plata
 * (métricas detalladas); la tasa de contacto, los cupones y las campañas, en todos los planes con convenios.
 * - ultimos30: eventos de los últimos 30 días. visitasLargas: visitas de los últimos DIAS_EVENTOS_CAMPANAS días.
 */
export function kpisNegocio(nivel: string, totales: Record<EventoKpi['tipo'], number>, ultimos30: EventoKpi[], visitasLargas: EventoKpi[],
  convenios: ConvenioKpi[], canjes: { convenio_id: string; ocurrido_en: string }[], desde30: string, ahora = Date.now()) {
  const detalle = nivel !== 'basicas', hoy = new Date(ahora).toISOString().slice(0, 10)
  const canjesDe = (c: ConvenioKpi) => canjes.filter(k => k.convenio_id === c.id)
  return {
    tasa_contacto: tasaContacto(totales),
    por_franja: detalle ? porFranja(ultimos30) : [],
    hora_peak: detalle ? horaPeak(ultimos30) : null,
    // Códigos de descuento: cuántas veces se canjeó cada uno en los últimos 30 días (los activos aunque no tengan canjes).
    cupones: convenios.map(c => ({ codigo: c.codigo, titulo: c.titulo, ong: c.ong, activo: c.estado === 'activo', canjes_30d: canjesDe(c).filter(k => k.ocurrido_en > desde30).length }))
      .filter(c => c.activo || c.canjes_30d > 0)
      .sort((a, b) => b.canjes_30d - a.canjes_30d || a.codigo.localeCompare(b.codigo)),
    campanas: convenios.filter(c => campanaMedible(c, hoy))
      .map(c => ({ titulo: c.titulo, ong: c.ong, codigo: c.codigo, desde: c.desde, ...impactoCampana(visitasLargas, c.desde, ahora), canjes: canjesDe(c).length }))
      .sort((a, b) => b.desde.localeCompare(a.desde) || a.titulo.localeCompare(b.titulo)),
  }
}
