// Cuentas de demostración en la versión real (backend/db/demo-presentacion.mjs): todas usan este dominio, así se
// reconocen, no reciben correos reales y se borran juntas cuando termina la presentación.
export const DOMINIO_DEMO = 'demo.petsuite.space'
export const esCorreoDemo = (correo: string | null | undefined) => String(correo ?? '').trim().toLowerCase().endsWith(`@${DOMINIO_DEMO}`)
/** Se agrega al nombre de cada negocio y ONG de demostración, para que nadie los confunda con negocios reales. */
export const SUFIJO_DEMO = ' (demo)'
