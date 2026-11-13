// Catálogo único de planes de suscripción Pyme. Lo usan el mock (para hacer cumplir los límites)
// y las pantallas (para mostrarlos). Cambiar un límite aquí lo cambia en toda la suite.
// null = sin límite. Las ONG no pagan: ver ONG_CUPOS.

export type PlanCodigo = 'gratis' | 'bronce' | 'plata' | 'oro'

export type Limites = {
  items: number | null        // ítems de catálogo publicados
  sucursales: number | null   // locales, incluida la casa matriz
  usuarios: number | null     // cuentas de equipo (jefes de local, personal clínico); el dueño no cuenta
  ofertas: number | null      // ofertas vigentes al mismo tiempo
  banners: number | null      // banners publicitarios activos o en revisión
  convenios: number | null    // convenios con ONG activos o en trámite
}

export type Beneficios = {
  portada: boolean            // foto de portada propia en el directorio
  perfil_sucursal: boolean    // descripción, servicios y horario propios por sucursal
  destacado: 0 | 1 | 2        // prioridad en el buscador: 2 aparece primero con insignia
  metricas: 'basicas' | 'completas' | 'avanzadas'
  soporte: string
}

export type Plan = { id: number; codigo: PlanCodigo; nombre: string; precio_mensual_clp: number; resumen: string; limites: Limites; beneficios: Beneficios }

export const PLANES: Plan[] = [
  {
    id: 1, codigo: 'gratis', nombre: 'Gratis', precio_mensual_clp: 0, resumen: 'Para aparecer en el directorio y probar PetSuite.',
    limites: { items: 5, sucursales: 1, usuarios: 0, ofertas: 0, banners: 0, convenios: 0 },
    beneficios: { portada: false, perfil_sucursal: false, destacado: 0, metricas: 'basicas', soporte: 'Autogestión y centro de ayuda' },
  },
  {
    id: 2, codigo: 'bronce', nombre: 'Bronce', precio_mensual_clp: 10_000, resumen: 'Para el local de barrio que quiere vender más.',
    limites: { items: 20, sucursales: 1, usuarios: 1, ofertas: 2, banners: 0, convenios: 1 },
    beneficios: { portada: true, perfil_sucursal: false, destacado: 0, metricas: 'basicas', soporte: 'Correo con respuesta en 48 h hábiles' },
  },
  {
    id: 3, codigo: 'plata', nombre: 'Plata', precio_mensual_clp: 15_000, resumen: 'Para negocios con varias sucursales y equipo.',
    limites: { items: 60, sucursales: 3, usuarios: 5, ofertas: 10, banners: 1, convenios: 3 },
    beneficios: { portada: true, perfil_sucursal: true, destacado: 1, metricas: 'completas', soporte: 'Asesor PetSuite asignado' },
  },
  {
    id: 4, codigo: 'oro', nombre: 'Oro', precio_mensual_clp: 25_000, resumen: 'Para cadenas: máxima visibilidad y sin topes prácticos.',
    limites: { items: 200, sucursales: 10, usuarios: 20, ofertas: null, banners: 3, convenios: null },
    beneficios: { portada: true, perfil_sucursal: true, destacado: 2, metricas: 'avanzadas', soporte: 'Asesor prioritario y revisión mensual' },
  },
]

export const PLAN_GRATIS = PLANES[0]
export const planPorId = (id: number | null | undefined) => PLANES.find(p => p.id === id) ?? PLAN_GRATIS

// Las ONG participan sin costo; su cupo de difusión es fijo y siempre pasa por el asesor.
export const ONG_CUPOS = { banners: 1, convenios: null as number | null }

// Reglas de cobro (RN-SUS): días de gracia tras el vencimiento y umbral para derivar a cobranza externa (Orcob).
export const DIAS_GRACIA = 5
export const DIAS_DERIVAR_COBRANZA = 30
export const DIAS_PERIODO = 30

export const limiteTexto = (n: number | null) => n === null ? 'Sin límite' : n === 0 ? 'No incluye' : String(n)
/** Frase del cupo de un plan: «incluye 3 banners activos», «no incluye cuentas de equipo» o «incluye convenios sin límite». */
export const cupoTexto = (n: number | null, singular: string, plural: string) => n === null ? `incluye ${plural} sin límite` : n === 0 ? `no incluye ${plural}` : `incluye ${n} ${n === 1 ? singular : plural}`
export const dentroDelLimite = (usados: number, limite: number | null) => limite === null || usados < limite

export const etiquetasLimite: Record<keyof Limites, string> = {
  items: 'Ítems de catálogo', sucursales: 'Sucursales', usuarios: 'Cuentas de equipo', ofertas: 'Ofertas vigentes', banners: 'Banners publicitarios', convenios: 'Convenios con ONG',
}
export const metricasTexto: Record<Beneficios['metricas'], string> = { basicas: 'Visitas y contactos', completas: 'Más canales e ítems más vistos', avanzadas: 'Comparativos y sucursales' }
// El orden de Explorar es igual para todos: el plan solo decide el bloque aparte «Patrocinado».
export const destacadoTexto = ['Orden igual para todos', 'Bloque «Patrocinado»', 'Primero en «Patrocinado»'] as const
