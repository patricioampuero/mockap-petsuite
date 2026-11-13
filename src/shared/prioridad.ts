// Animal prioritario de una ONG: reglas y textos compartidos por el mock, el API y la interfaz.
// Cada ONG destaca a lo más un animal disponible; aparece primero en Adopciones con la etiqueta «Prioritario».
export const MAX_PRIORITARIOS_POR_ONG = 1
export const PRIORIDAD_SOLO_DISPONIBLES = 'Solo un animal disponible para adopción puede quedar como prioritario'
export const PRIORIDAD_AYUDA = 'Destaca a un animal a la vez: aparece primero en Adopciones. Úsalo para un caso urgente o para quien lleva más tiempo esperando.'

/** Orden del catálogo público: el prioritario de cada ONG primero; después, los más recientes. */
export const ordenAdopciones = (a: { prioritario?: boolean; publicado_en: string }, b: { prioritario?: boolean; publicado_en: string }) =>
  Number(!!b.prioritario) - Number(!!a.prioritario) || b.publicado_en.localeCompare(a.publicado_en)
