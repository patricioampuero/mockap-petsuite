import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Clock3, Info, MapPin, MessageCircle, Navigation, Phone, ShieldCheck } from 'lucide-react'
import { api, errorText, getSession, type PymePerfil } from '../../shared/api'
import { FICHA_PUBLICA } from '../../shared/fichas'
import { Photo, fotoNegocio } from '../../shared/media'
import { ErrorState, LoadingState } from '../../shared/feedback'
import { ShareButton } from '../../shared/share'
import { CouponList } from '../promotions/promotions'
import { PublicFooter, PublicHeader } from '../landing/public-layout'
import { BranchList, BusinessCatalog, BusinessContactForm, diaLabel, trackEvento } from './directory'
import { directionsUrl, statusForBusiness } from './directory-hours'
import { ExploreMap, ultimaBusqueda } from './explore'
import { SELLO, rubroLabel } from './explore-search'

/** #local/<id> — perfil público del negocio. Cada visita cuenta en sus métricas; escribirle requiere cuenta. */
export function PublicBusiness({ id }: { id: string }) {
  const [pyme, setPyme] = useState<PymePerfil | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const load = useCallback(() => { setError(''); api<PymePerfil>(`/pymes/${id}`).then(setPyme).catch(e => setError(errorText(e))) }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [id])

  const volver = <a className="local-back" href={ultimaBusqueda()}><ArrowLeft size={16} aria-hidden="true" /> Volver a Explorar</a>
  if (!pyme) return <div className="public-site"><PublicHeader current="explorar" /><main className="local-main">{volver}{error ? <ErrorState message={error} onRetry={load} /> : <LoadingState label="Cargando el perfil del negocio" rows={2} />}</main><PublicFooter /></div>

  const status = statusForBusiness(pyme, now)
  const comoLlegar = directionsUrl(pyme.latitud, pyme.longitud, pyme.direccion && `${pyme.direccion}, ${pyme.comuna}`)
  const wa = pyme.whatsapp?.replace(/\D/g, '')
  const horario = Object.entries(pyme.horario || {}).filter(([, h]) => h?.trim())
  const conUbicacion = pyme.latitud != null && pyme.longitud != null

  return <div className="public-site">
    <PublicHeader current="explorar" />
    <main className="local-main">
      {volver}
      <header className="local-head">
        <div>
          <p className="eyebrow">{rubroLabel[pyme.rubro] || pyme.rubro} · {pyme.comuna}</p>
          <h1>{pyme.nombre_comercial}</h1>
          <div className="local-badges">
            {pyme.sin_reclamar
              ? <details className="local-seal is-unclaimed"><summary><Info size={16} aria-hidden="true" /> {FICHA_PUBLICA.etiqueta}</summary><p>{FICHA_PUBLICA.detalle}</p></details>
              : <details className="local-seal"><summary><ShieldCheck size={16} aria-hidden="true" /> {SELLO.nombre}</summary><p>{SELLO.detalle}</p></details>}
            <span className={`local-open${status.open ? ' is-open' : status.known ? ' is-closed' : ''}`}><Clock3 size={15} aria-hidden="true" /> {status.text}</span>
            {pyme.direccion && <span className="local-address"><MapPin size={15} aria-hidden="true" /> {pyme.direccion}</span>}
          </div>
        </div>
        <ShareButton hash={`#local/${id}`} title={pyme.nombre_comercial} text={`${pyme.nombre_comercial} en PetSuite: servicios, horario y cómo llegar.`} />
      </header>
      <Photo src={fotoNegocio(pyme)} nombre={pyme.nombre_comercial} className="local-cover" />

      <div className="local-layout">
        <div className="local-content">
          <section className="local-section"><h2>Sobre el negocio</h2><p>{pyme.descripcion || 'Este negocio aún no agrega una descripción.'}</p>
            {!!pyme.servicios?.length && <><h3>Servicios</h3><ul className="local-services">{pyme.servicios.map(s => <li key={s}>{s}</li>)}</ul></>}
          </section>
          {!!pyme.cupones?.length && <section className="local-section"><h2>Cupones con ONG aliadas</h2><p className="muted">Presenta el código al pagar: tu compra apoya a la organización.</p><CouponList cupones={pyme.cupones} por="ong" /></section>}
          {!pyme.sin_reclamar && <section className="local-section"><h2>Catálogo y precios</h2><p className="muted">Precios referenciales. La compra y el pago se coordinan directamente con el negocio.</p><BusinessCatalog items={pyme.catalogo} onView={itemId => trackEvento(id, 'vista_item', itemId)} /></section>}
          {!!pyme.sucursales?.length && <section className="local-section"><h2>Sucursales</h2><BranchList sucursales={pyme.sucursales} now={now} /></section>}
          {conUbicacion && <section className="local-section"><h2>Dónde está</h2>{pyme.direccion && <p className="muted">{pyme.direccion}</p>}<div className="local-map"><ExploreMap places={[pyme]} now={now} numbered={false} label={`Ubicación de ${pyme.nombre_comercial}`} /></div></section>}
        </div>

        <aside className="local-aside">
          <div className="local-card">
            <div className="local-card-status"><span className={`local-open${status.open ? ' is-open' : status.known ? ' is-closed' : ''}`}><Clock3 size={15} aria-hidden="true" /> {status.text}</span></div>
            {horario.length ? <dl className="local-hours">{horario.map(([dia, h]) => <div key={dia}><dt>{diaLabel[dia] || dia}</dt><dd>{h}</dd></div>)}</dl> : <p className="muted">Horario no informado.</p>}
            <div className="local-card-actions">
              {comoLlegar && <a className="primary" href={comoLlegar} target="_blank" rel="noopener noreferrer"><Navigation size={17} aria-hidden="true" /> Cómo llegar</a>}
              {pyme.telefono && <a className="secondary" href={`tel:${pyme.telefono}`} onClick={() => trackEvento(id, 'clic_contacto')}><Phone size={17} aria-hidden="true" /> Llamar</a>}
              {wa && <a className="secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" onClick={() => trackEvento(id, 'clic_whatsapp')}><MessageCircle size={17} aria-hidden="true" /> WhatsApp</a>}
            </div>
          </div>
          {pyme.sin_reclamar
            ? <div className="local-card local-card-login local-card-claim"><p className="muted">{FICHA_PUBLICA.sinConsultas}</p><h2>¿Es tu negocio?</h2><p className="muted">{FICHA_PUBLICA.reclamar}</p><a className="primary" href="#registro">Crear cuenta de Pyme</a></div>
            : getSession()
              ? <BusinessContactForm id={id} nombre={pyme.nombre_comercial} />
              : <div className="local-card local-card-login"><h2>Escríbele por PetSuite</h2><p className="muted">Crea una cuenta gratis o ingresa para enviarle una consulta y leer su respuesta.</p><a className="primary" href="#registro">Crear cuenta gratis</a><a className="text-button" href="#ingresar">Ya tengo cuenta</a></div>}
        </aside>
      </div>
    </main>
    <PublicFooter />
  </div>
}
