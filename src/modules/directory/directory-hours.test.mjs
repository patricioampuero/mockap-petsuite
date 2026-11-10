import test from 'node:test'
import assert from 'node:assert/strict'
import { directionsUrl, statusForBusiness, statusForSchedule } from './directory-hours.ts'

test('uses Chile local time and reports a business open on Saturday', () => {
  const status = statusForSchedule({ 'lun-vie': '09:00-18:00', sab: '10:00-14:00' }, new Date('2026-10-24T13:30:00Z'))
  assert.deepEqual(status, { known: true, open: true, text: 'Abierto · cierra a las 14:00' })
})

test('a Sunday without hours is closed and points to the next Monday opening', () => {
  const status = statusForSchedule({ 'lun-vie': '09:00-18:00', sab: '10:00-14:00' }, new Date('2026-10-25T13:30:00Z'))
  assert.equal(status.open, false)
  assert.match(status.text, /^Cerrado · abre el lunes a las 09:00/)
})

test('a specific weekday schedule overrides the weekday group', () => {
  const status = statusForSchedule({ 'lun-vie': '09:00-18:00', lunes: 'Cerrado' }, new Date('2026-10-26T15:00:00Z'))
  assert.match(status.text, /^Cerrado · abre el martes a las 09:00/)
})

test('multiple daily time ranges are recognized', () => {
  const status = statusForSchedule({ sab: '09:00-13:00 y 15:00-18:00' }, new Date('2026-10-24T20:00:00Z'))
  assert.deepEqual(status, { known: true, open: true, text: 'Abierto · cierra a las 18:00' })
})

test('an open branch makes the business available in the open-now filter', () => {
  const place = {
    horario: { 'lun-vie': '09:00-10:00' },
    sucursales: [{ nombre: 'Sucursal Centro', horario: { lunes: '11:00-14:00' } }],
  }
  const status = statusForBusiness(place, new Date('2026-10-26T15:00:00Z'))
  assert.deepEqual(status, { known: true, open: true, text: 'Abierto · Sucursal Centro · cierra a las 14:00' })
})

test('unreported hours and invalid or missing coordinates are handled explicitly', () => {
  assert.deepEqual(statusForSchedule({}, new Date('2026-10-26T15:00:00Z')), { known: false, open: false, text: 'Horario no informado' })
  assert.equal(directionsUrl(null, null), null)
  assert.equal(directionsUrl('91', '-73'), null)
  assert.equal(directionsUrl('-40.5735', '-73.1335'), 'https://www.google.com/maps/dir/?api=1&destination=-40.5735,-73.1335')
  // Sin coordenadas confiables, la ruta va a la dirección escrita; las coordenadas válidas siempre tienen prioridad.
  assert.equal(directionsUrl(null, null, 'Zenteno 1615, Osorno'), 'https://www.google.com/maps/dir/?api=1&destination=Zenteno%201615%2C%20Osorno%2C%20Chile')
  assert.equal(directionsUrl('91', '-73', 'Zenteno 1615, Osorno'), 'https://www.google.com/maps/dir/?api=1&destination=Zenteno%201615%2C%20Osorno%2C%20Chile')
  assert.equal(directionsUrl('-40.5735', '-73.1335', 'Zenteno 1615, Osorno'), 'https://www.google.com/maps/dir/?api=1&destination=-40.5735,-73.1335')
  assert.equal(directionsUrl(null, null, '  '), null)
})
