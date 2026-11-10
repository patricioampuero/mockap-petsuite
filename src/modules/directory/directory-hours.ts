export type OpenStatus = { known: boolean; open: boolean; text: string; minutesToOpen?: number }
export type ScheduledLocation = { horario?: Record<string, string> | null }
export type ScheduledBusiness = ScheduledLocation & { sucursales?: ({ nombre: string } & ScheduledLocation)[] | null }

const CHILE_TIME_ZONE = 'America/Santiago'
const weekDays = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const chileClock = new Intl.DateTimeFormat('en-US', { timeZone: CHILE_TIME_ZONE, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const weekdayNumber: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const normalKey = (value: string) => value.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '')
const keysForDay: Record<number, string[]> = {
  0: ['domingo', 'dom'], 1: ['lunes', 'lun'], 2: ['martes', 'mar'], 3: ['miercoles', 'mie'],
  4: ['jueves', 'jue'], 5: ['viernes', 'vie'], 6: ['sabado', 'sab'],
}
const timeRanges = (value: string) => [...value.matchAll(/(\d{1,2})[:.](\d{2})\s*(?:-|–|—|a)\s*(\d{1,2})[:.](\d{2})/gi)].flatMap(match => {
  const startHour = Number(match[1]), startMinute = Number(match[2]), endHour = Number(match[3]), endMinute = Number(match[4])
  if (startHour > 23 || startMinute > 59 || endHour > 24 || endMinute > 59 || endHour === 24 && endMinute !== 0) return []
  const start = startHour * 60 + startMinute
  let end = endHour * 60 + endMinute
  if (end <= start) end += 24 * 60
  return [{ start, end }]
}).sort((a, b) => a.start - b.start)

function scheduleForDay(schedule: Record<string, string>, weekday: number) {
  const entries = Object.entries(schedule || {}).map(([key, value]) => [normalKey(key), value] as const)
  const individual = entries.find(([key]) => keysForDay[weekday].includes(key))
  if (individual) return individual[1]
  if (weekday >= 1 && weekday <= 5) return entries.find(([key]) => ['lun-vie', 'lunesaviernes', 'lunesviernes'].includes(key))?.[1] || ''
  if (weekday === 6) return entries.find(([key]) => ['sab', 'sabado'].includes(key))?.[1] || ''
  return entries.find(([key]) => ['dom', 'domingo'].includes(key))?.[1] || ''
}

const formatClock = (minute: number) => {
  const hour = Math.floor((minute % 1440) / 60), mins = minute % 60
  return new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.UTC(2020, 0, 1, hour, mins)))
}
const chileParts = (date: Date) => {
  const parts = Object.fromEntries(chileClock.formatToParts(date).map(part => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: weekdayNumber[parts.weekday] }
}
const dateOffset = (year: number, month: number, day: number, offset: number) => {
  const date = new Date(Date.UTC(year, month - 1, day + offset))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() }
}

export function statusForSchedule(schedule: Record<string, string> | null | undefined, now: Date): OpenStatus {
  const entries = Object.values(schedule || {}).map(value => value?.trim() || '')
  if (!entries.some(Boolean)) return { known: false, open: false, text: 'Horario no informado' }
  const today = chileParts(now)
  const todayRanges = timeRanges(scheduleForDay(schedule || {}, today.weekday))
  // Si el horario de ayer cruza medianoche, la atención continúa después de las 00:00.
  const yesterday = dateOffset(today.year, today.month, today.day, -1)
  const yesterdayRanges = timeRanges(scheduleForDay(schedule || {}, yesterday.weekday))
  const pastMidnight = yesterdayRanges.find(range => range.end > 1440 && today.minute < range.end - 1440)
  if (pastMidnight) return { known: true, open: true, text: `Abierto · cierra a las ${formatClock(pastMidnight.end - 1440)}` }
  const currentRange = todayRanges.find(range => today.minute >= range.start && today.minute < range.end)
  if (currentRange) {
    const closesTomorrow = currentRange.end >= 1440
    return { known: true, open: true, text: `Abierto · cierra ${closesTomorrow ? 'mañana ' : ''}a las ${formatClock(currentRange.end)}` }
  }
  const nextToday = todayRanges.find(range => range.start > today.minute)
  if (nextToday) return { known: true, open: false, text: `Cerrado · abre hoy a las ${formatClock(nextToday.start)}`, minutesToOpen: nextToday.start - today.minute }
  for (let offset = 1; offset <= 7; offset++) {
    const nextDate = dateOffset(today.year, today.month, today.day, offset)
    const nextRange = timeRanges(scheduleForDay(schedule || {}, nextDate.weekday))[0]
    if (nextRange) return { known: true, open: false, text: `Cerrado · abre el ${weekDays[nextDate.weekday]} a las ${formatClock(nextRange.start)}`, minutesToOpen: offset * 1440 - today.minute + nextRange.start }
  }
  return { known: true, open: false, text: 'Cerrado' }
}

export function statusForBusiness(place: ScheduledBusiness, now: Date): OpenStatus {
  const main = statusForSchedule(place.horario, now)
  const branches = (place.sucursales || []).map(branch => ({ branch, status: statusForSchedule(branch.horario, now) }))
  const openBranch = branches.find(row => row.status.open)
  if (main.open) return main
  if (openBranch) return { known: true, open: true, text: `Abierto · ${openBranch.branch.nombre} · ${openBranch.status.text.replace(/^Abierto · /, '')}` }
  if (main.known) return main
  const nextBranch = branches.filter(row => row.status.known).sort((a, b) => (a.status.minutesToOpen ?? Infinity) - (b.status.minutesToOpen ?? Infinity))[0]
  return nextBranch?.status || main
}

export const isOpenNow = (place: ScheduledBusiness, now: Date) => statusForBusiness(place, now).open

/**
 * Ruta en Google Maps hasta el negocio. Con coordenadas válidas va al punto exacto; sin ellas, a la dirección escrita
 * (algunas fichas con información pública no tienen un punto confiable, y un punto aproximado llevaría a otra cuadra).
 */
export const directionsUrl = (lat: string | null | undefined, lng: string | null | undefined, direccion?: string | null) => {
  const latitude = lat?.trim() ? Number(lat) : NaN, longitude = lng?.trim() ? Number(lng) : NaN
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
  }
  return direccion?.trim() ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${direccion.trim()}, Chile`)}` : null
}
