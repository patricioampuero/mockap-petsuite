// Aviso al tutor cuando alguien escribe desde la ficha pública de su mascota (medalla QR).
// Lo comparten el mock y el API, así el correo es el mismo en la demo y en la versión real.

export type MensajeQr = { mensaje: string; nombre?: string; contacto?: string; latitud?: number; longitud?: number }

/**
 * detalles es el bloque con el mensaje y los datos de quien escribió. El API real lo envía solo al tutor:
 * la copia que guarda la bandeja lo reemplaza, porque son datos personales de un tercero.
 */
export function correoAvisoQr(tutor: string, mascota: string, m: MensajeQr, base: string) {
  const lineas = [
    `«${m.mensaje}»`,
    '',
    `Nombre: ${m.nombre || 'no lo indicó'}`,
    `Contacto: ${m.contacto || 'no lo indicó'}`,
  ]
  if (m.latitud != null && m.longitud != null) {
    lineas.push(`Ubicación aproximada: https://www.openstreetmap.org/?mlat=${m.latitud}&mlon=${m.longitud}#map=17/${m.latitud}/${m.longitud}`)
  }
  const detalles = lineas.join('\n')
  return {
    asunto: `Mensaje sobre ${mascota}: alguien escaneó su medalla`,
    cuerpo: `Hola, ${tutor}:\n\nAlguien escaneó la medalla QR de ${mascota} y te dejó este mensaje:\n\n${detalles}\n\n`
      + `Esa persona no vio tus datos. Puedes revisar y marcar el aviso en la ficha de ${mascota}, en PetSuite: ${base}\n\nEquipo PetSuite`,
    detalles,
  }
}
