// Pagos de los planes: textos y reglas compartidos por el mock, el API y el frontend.
// En la versión real se paga por transferencia y un asesor la confirma. Orcob está simulado: solo funciona en la demo
// (el mock) y en el API cuando ORCOB_SIMULADO=1 (pruebas), porque todavía no hay un convenio real con Orcob.

export type DatosTransferencia = { titular: string; rut: string; banco: string; tipo_cuenta: string; numero: string; correo: string }

/**
 * Cuenta de PetSuite para recibir las transferencias. Mientras sea null, la app y los correos dicen que un asesor
 * enviará los datos para transferir. Se completa con los datos reales de la cuenta.
 */
export const DATOS_TRANSFERENCIA: DatosTransferencia | null = null

export const ORCOB_NO_DISPONIBLE = 'El pago con Orcob todavía no está disponible: elige transferencia'
export const SOLO_ORCOB_CONFIRMA = 'Solo Orcob puede confirmar un pago'

const pesos = (monto: number) => `$${monto.toLocaleString('es-CL')}`

/** Cómo pagar por transferencia, en líneas de texto (para la app y los correos). */
export function instruccionesTransferencia(monto: number, negocio: string): string[] {
  if (!DATOS_TRANSFERENCIA) return [`Monto: ${pesos(monto)} al mes.`, 'Un asesor de PetSuite te escribirá con los datos de la cuenta para transferir.']
  const d = DATOS_TRANSFERENCIA
  return [
    `Monto: ${pesos(monto)} al mes.`,
    `Titular: ${d.titular} · RUT ${d.rut}`,
    `${d.banco} · ${d.tipo_cuenta} N.º ${d.numero}`,
    `En el comentario escribe «PetSuite ${negocio}» y envía el comprobante a ${d.correo}.`,
  ]
}

/** Correo a la Pyme cuando pide un plan pagado por transferencia (al darse de alta o al cambiar de plan). */
export function correoSolicitudPlan(negocio: string, plan: string, monto: number, conReferencia: boolean) {
  return {
    asunto: `Recibimos tu solicitud del plan ${plan}`,
    cuerpo: [
      `Hola:\n\nRecibimos la solicitud del plan ${plan} para ${negocio}.`,
      '',
      ...(conReferencia ? ['Registramos la referencia de tu transferencia. Un asesor la confirmará y te avisaremos por correo.'] : ['Para activarlo, transfiere el primer mes:', ...instruccionesTransferencia(monto, negocio)]),
      '',
      'El plan se activa cuando un asesor confirma el pago y, si es tu primera vez, verifica tu negocio.',
      '',
      'Equipo PetSuite',
    ].join('\n'),
  }
}

/** Aviso al equipo de PetSuite (asesores; si no hay, administradores) de una solicitud por revisar. */
export function avisoSolicitud(tipo: 'alta' | 'plan', negocio: string, rut: string, comuna: string, plan: string, monto: number, canal: 'transferencia' | 'orcob', referencia: string | null) {
  const pago = canal === 'orcob' ? 'con Orcob' : `por transferencia${referencia ? `, referencia «${referencia}»` : ', sin referencia todavía'}`
  return {
    asunto: tipo === 'alta' ? `Negocio por verificar: ${negocio}` : `Pago por confirmar: ${negocio} · plan ${plan}`,
    cuerpo: [
      tipo === 'alta' ? `${negocio} (RUT ${rut}, ${comuna}) pidió publicarse en PetSuite.` : `${negocio} (RUT ${rut}) pidió el plan ${plan}.`,
      monto > 0 ? `Plan ${plan}: ${pesos(monto)} ${pago}.` : 'Plan Gratis: no hay pago que confirmar.',
      'Revísalo en «Pymes y suscripciones».',
    ].join('\n'),
  }
}
