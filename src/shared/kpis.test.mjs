// KPI de negocio con horas y fechas fijas: franja horaria en la hora de Chile, hora de más visitas, tasa de
// contacto, impacto de una campaña con una ONG y orden de los cupones.
import assert from 'node:assert/strict'
import test from 'node:test'
import { horaChile, horaPeak, impactoCampana, kpisNegocio, kpisPlataforma, porFranja, tasaContacto } from './kpis.ts'

const visita = iso => ({ tipo: 'visita_perfil', ocurrido_en: iso })

test('la hora se cuenta en Chile, con horario de verano e invierno', () => {
  assert.equal(horaChile('2026-11-13T15:30:00.000Z'), 12, 'en noviembre Chile está en UTC-3')
  assert.equal(horaChile('2026-07-10T15:30:00.000Z'), 11, 'en julio Chile está en UTC-4')
  assert.equal(horaChile('2026-11-13T03:10:00.000Z'), 0)
})

test('franja horaria, hora de más visitas y tasa de contacto', () => {
  const eventos = [visita('2026-11-13T12:00:00.000Z'), visita('2026-11-13T13:00:00.000Z'), visita('2026-11-13T22:00:00.000Z'), visita('2026-11-13T22:30:00.000Z'), visita('2026-11-13T22:45:00.000Z'), { tipo: 'clic_contacto', ocurrido_en: '2026-11-13T22:00:00.000Z' }]
  assert.deepEqual(porFranja(eventos).map(f => f.visitas), [0, 2, 0, 3], '9 y 10 h en la mañana; 19 h en la noche')
  assert.equal(horaPeak(eventos), 19)
  assert.equal(horaPeak([]), null)
  assert.equal(tasaContacto({ visita_perfil: 40, vista_item: 0, clic_contacto: 3, clic_whatsapp: 7 }), 25)
  assert.equal(tasaContacto({ visita_perfil: 0, vista_item: 0, clic_contacto: 0, clic_whatsapp: 0 }), null)
})

test('impacto de una campaña: mismos días antes y después del inicio, hasta 14', () => {
  const ahora = Date.parse('2026-11-13T15:00:00.000Z')
  // Campaña desde el 10 de noviembre: lleva 4 días (10, 11, 12 y parte del 13), así que compara 4 días antes.
  const eventos = [visita('2026-11-05T15:00:00.000Z'), visita('2026-11-07T15:00:00.000Z'), visita('2026-11-11T15:00:00.000Z'), visita('2026-11-11T16:00:00.000Z'), visita('2026-11-12T15:00:00.000Z'), visita('2026-11-13T14:00:00.000Z')]
  assert.deepEqual(impactoCampana(eventos, '2026-11-10', ahora), { dias: 4, visitas_antes: 1, visitas_despues: 4, variacion_pct: 300 })
  assert.equal(impactoCampana(eventos, '2026-08-01', ahora).dias, 14)
  assert.equal(impactoCampana([], '2026-11-10', ahora).variacion_pct, null)
})

test('cupones ordenados por canjes, campañas medibles y la franja solo desde Plata', () => {
  const ahora = Date.parse('2026-11-13T15:00:00.000Z')
  const convenios = [
    { id: 'a', codigo: 'PATITAS10', titulo: 'Patitas', estado: 'activo', desde: '2026-11-01', ong: 'Patitas del Sur' },
    { id: 'b', codigo: 'GATOS15', titulo: 'Gatos', estado: 'finalizado', desde: '2026-06-01', ong: 'Refugio' },
    { id: 'c', codigo: 'HUELLA5', titulo: 'Huella', estado: 'activo', desde: '2026-12-01', ong: 'Huella' },
  ]
  const canjes = [{ convenio_id: 'a', ocurrido_en: '2026-11-12T10:00:00.000Z' }, { convenio_id: 'b', ocurrido_en: '2026-11-02T10:00:00.000Z' }, { convenio_id: 'b', ocurrido_en: '2026-11-03T10:00:00.000Z' }]
  const totales = { visita_perfil: 4, vista_item: 0, clic_contacto: 1, clic_whatsapp: 0 }
  const k = kpisNegocio('detalladas', totales, [visita('2026-11-12T15:00:00.000Z')], [], convenios, canjes, '2026-10-14T15:00:00.000Z', ahora)
  assert.deepEqual(k.cupones.map(c => [c.codigo, c.canjes_30d]), [['GATOS15', 2], ['PATITAS10', 1], ['HUELLA5', 0]])
  assert.deepEqual(k.campanas.map(c => c.codigo), ['PATITAS10'], 'una campaña de hace más de 90 días o que no empieza no se mide')
  assert.equal(k.tasa_contacto, 25)
  assert.equal(k.por_franja.length, 4)
  assert.deepEqual(kpisNegocio('basicas', totales, [], [], [], [], '', ahora).por_franja, [])
})

test('KPI de la plataforma: top de negocios y ONG con empate por nombre', () => {
  const k = kpisPlataforma({ visita_perfil: 10, vista_item: 2, clic_contacto: 1, clic_whatsapp: 1 }, new Map([['Zoo', 3], ['Arca', 3], ['Huellitas', 4]]), new Map([['Patitas', 2]]))
  assert.deepEqual(k.negocios_top.map(n => n.nombre), ['Huellitas', 'Arca', 'Zoo'])
  assert.deepEqual([k.visitas_30d, k.contactos_30d, k.tasa_contacto, k.canjes_30d], [10, 2, 20, 2])
})
