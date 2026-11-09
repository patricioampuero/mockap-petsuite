// Fichas con información pública: negocios reales que aparecen en Explorar con datos públicos antes de inscribirse.
// Textos compartidos por el mock, el API y el frontend, para que digan siempre lo mismo.

export const FICHA_PUBLICA = {
  etiqueta: 'Información pública',
  detalle: 'Esta ficha se armó con datos públicos del negocio (nombre, dirección, teléfono y rubro). El negocio todavía no la administra y PetSuite no la ha validado.',
  reclamar: 'Crea tu cuenta de Pyme con este mismo nombre: un asesor de PetSuite revisará tus datos y unirá esta ficha a tu cuenta. También puedes pedir que la quitemos.',
  sinConsultas: 'Este negocio todavía no recibe consultas por PetSuite. Puedes llamarlo, escribirle por WhatsApp o ir a su local.',
}

/** Respuesta del API a una consulta enviada a una ficha pública. */
export const CONSULTAS_NO_DISPONIBLES = 'Este negocio todavía no recibe consultas por PetSuite'
/** Respuesta del API al intentar validar una ficha pública. */
export const FICHA_PUBLICA_SIN_DUENO = 'Una ficha con información pública se valida cuando su dueño la reclama'
