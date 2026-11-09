import { useEffect, useState } from 'react'
import { ArrowRight, Heart, HeartHandshake, Home, MapPinned, Pause, PawPrint, Play, QrCode, Search, ShieldCheck, Store } from 'lucide-react'
import { api, errorText, iniciales, type Comuna, type PymeResumen } from '../../shared/api'
import { Photo, assetUrl, fotoNegocio } from '../../shared/media'
import { ErrorState } from '../../shared/feedback'
import { BannerStrip } from '../promotions/promotions'
import { categoriaIcono } from '../directory/explore'
import { CATEGORIAS, SELLO, hashCategoria, hashExplorar, patrocinados, rubroLabel } from '../directory/explore-search'
import { PublicFooter, PublicHeader } from './public-layout'

// Contenido fijo del carrusel hasta que exista su editor en Admin (FE-20). La foto va a la derecha.
const DIAPOSITIVAS = [
  { foto: '/img/vet-2.jpg', sobre: 'Explora sin crear cuenta', titulo: 'Veterinarias, tiendas y peluquerías de tu comuna', texto: 'Compara servicios y horarios, mira en el mapa qué está abierto ahora y llega sin perderte.', accion: ['Explorar ahora', '#explorar'] },
  { foto: '/img/perro-retrato.jpg', sobre: 'Ficha de salud y QR', titulo: 'Si se pierde, su QR lo ayuda a volver a casa', texto: 'Crea gratis la ficha de tu mascota. Quien la encuentre ve sus alergias y te avisa sin ver tus datos.', accion: ['Crear la ficha gratis', '#registro'] },
  { foto: '/img/mujer-abraza.jpg', sobre: 'Adopción responsable', titulo: 'Adopta y apoya a las organizaciones de rescate', texto: 'Conoce a los animales que buscan hogar y compra con cupones que ayudan a las ONG de tu zona.', accion: ['Ver adopciones', '#adopciones'] },
] as const

type OngResumen = { id: string; nombre: string; tipo: string; comuna: string; mision: string | null; animales: number; cupones: number }
const tipoOng: Record<string, string> = { refugio: 'Refugio', rescatista_independiente: 'Rescatista independiente', agrupacion: 'Agrupación' }
const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Carrusel() {
  const [actual, setActual] = useState(0)
  const [pausado, setPausado] = useState(sinMovimiento)
  const [encima, setEncima] = useState(false)
  useEffect(() => {
    if (pausado || encima) return
    const timer = window.setInterval(() => setActual(a => (a + 1) % DIAPOSITIVAS.length), 7000)
    return () => window.clearInterval(timer)
  }, [pausado, encima])
  return <section className="landing-hero" aria-roledescription="carrusel" aria-label="Lo que puedes hacer en PetSuite" onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)} onFocus={() => setEncima(true)} onBlur={() => setEncima(false)}>
    <div className="landing-hero-inner">
      {DIAPOSITIVAS.map((d, i) => <div key={d.titulo} className={i === actual ? 'landing-slide is-active' : 'landing-slide'} role="group" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${DIAPOSITIVAS.length}`}>
        <div className="landing-slide-copy"><p className="landing-slide-eyebrow">{d.sobre}</p><h2>{d.titulo}</h2><p>{d.texto}</p><a className="landing-slide-cta" href={d.accion[1]}>{d.accion[0]} <ArrowRight size={17} aria-hidden="true" /></a></div>
        <div className="landing-slide-photo" aria-hidden="true" style={{ backgroundImage: `url(${assetUrl(d.foto)})` }} />
      </div>)}
      <div className="landing-hero-controls">
        {DIAPOSITIVAS.map((d, i) => <button key={d.titulo} type="button" className={i === actual ? 'landing-dot active' : 'landing-dot'} aria-label={`Ver diapositiva ${i + 1}: ${d.sobre}`} aria-current={i === actual ? 'true' : undefined} onClick={() => setActual(i)} />)}
        <button type="button" className="landing-pause" aria-label={pausado ? 'Reanudar el carrusel' : 'Pausar el carrusel'} onClick={() => setPausado(!pausado)}>{pausado ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>
      </div>
    </div>
  </section>
}

function Buscador({ comunas }: { comunas: Comuna[] }) {
  const [q, setQ] = useState('')
  const [comuna, setComuna] = useState('')
  return <div className="landing-search-wrap">
    <form className="search-pill landing-search" role="search" aria-label="Buscar servicios Pet-Care" onSubmit={e => { e.preventDefault(); window.location.hash = hashExplorar({ q, comuna }) }}>
      <label className="search-pill-field search-pill-what"><span>¿Qué necesita tu mascota?</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Baño, vacunación, veterinaria o un negocio" /></label>
      <label className="search-pill-field search-pill-where"><span>Comuna</span><select value={comuna} onChange={e => setComuna(e.target.value)}><option value="">Todas las comunas</option>{comunas.map(c => <option key={c.id} value={c.nombre}>{c.nombre}</option>)}</select></label>
      <button className="primary search-pill-button"><Search size={20} aria-hidden="true" /><span>Buscar</span></button>
    </form>
    <nav className="landing-categories" aria-label="Buscar por categoría">{CATEGORIAS.map(c => { const Icon = categoriaIcono[c.id] ?? Search; return <a key={c.id} className="landing-category" href={hashCategoria(c, comuna)}><span><Icon size={24} strokeWidth={1.7} aria-hidden="true" /></span>{c.label}</a> })}</nav>
  </div>
}

function NegocioDestacado({ p }: { p: PymeResumen }) {
  return <a className="landing-business" href={`#local/${p.id}`}>
    <div className="explore-card-media"><Photo src={fotoNegocio(p)} nombre={p.nombre_comercial} className="explore-card-photo" /><span className="explore-flag is-sponsored">Patrocinado</span></div>
    <strong>{p.nombre_comercial}</strong>
    <span>{rubroLabel[p.rubro] || p.rubro} · {p.comuna}</span>
    {!!p.servicios?.length && <small>{p.servicios.slice(0, 3).join(' · ')}</small>}
  </a>
}

function Aliados({ items }: { items: { id: string; nombre: string; tipo: string; href: string }[] }) {
  const [pausado, setPausado] = useState(sinMovimiento)
  return <section className="landing-partners" aria-labelledby="landing-partners-title">
    <div className="landing-section-head"><div><p className="eyebrow">Red PetSuite</p><h2 id="landing-partners-title">Negocios y organizaciones en PetSuite</h2></div><button type="button" className="text-button" onClick={() => setPausado(!pausado)}>{pausado ? <><Play size={14} aria-hidden="true" /> Mover</> : <><Pause size={14} aria-hidden="true" /> Pausar</>}</button></div>
    <div className={pausado ? 'landing-marquee is-paused' : 'landing-marquee'}><ul>{[...items, ...items].map((a, i) => { const copia = i >= items.length; return <li key={`${a.id}-${i}`} aria-hidden={copia || undefined}><a href={a.href} tabIndex={copia ? -1 : undefined}><span className="landing-partner-mark">{iniciales(a.nombre)}</span><span><strong>{a.nombre}</strong><small>{a.tipo}</small></span></a></li> })}</ul></div>
  </section>
}

/** Página de inicio para visitantes: buscar es lo primero; crear una cuenta es opcional. */
export function Landing() {
  const [comunas, setComunas] = useState<Comuna[]>([])
  const [pymes, setPymes] = useState<PymeResumen[] | null>(null)
  const [ongs, setOngs] = useState<OngResumen[] | null>(null)
  const [error, setError] = useState('')
  const load = () => {
    setError('')
    api<PymeResumen[]>('/pymes').then(setPymes).catch(e => setError(errorText(e)))
    api<OngResumen[]>('/ongs').then(setOngs).catch(e => setError(errorText(e)))
  }
  useEffect(() => { load(); api<Comuna[]>('/comunas').then(setComunas).catch(() => undefined) }, [])

  const destacados = pymes ? patrocinados(pymes, 3) : []
  const conAnimales = (ongs ?? []).filter(o => o.animales > 0 || o.cupones > 0).slice(0, 3)
  const aliados = [...(pymes ?? []).map(p => ({ id: p.id, nombre: p.nombre_comercial, tipo: rubroLabel[p.rubro] || p.rubro, href: `#local/${p.id}` })), ...(ongs ?? []).map(o => ({ id: o.id, nombre: o.nombre, tipo: 'ONG', href: `#ong/${o.id}` }))]

  return <div className="public-site landing-site">
    <PublicHeader current="inicio" />
    <main id="contenido">
      <h1 className="sr-only">PetSuite: servicios Pet-Care de tu comuna, ficha de salud con QR y comunidad</h1>
      <Carrusel />
      <Buscador comunas={comunas} />
      <div className="landing-body">
        {error && <ErrorState message={error} onRetry={load} />}
        <BannerStrip ubicacion="inicio" onPyme={id => { window.location.hash = `#local/${id}` }} />

        {!!destacados.length && <section className="landing-section">
          <div className="landing-section-head"><div><p className="eyebrow">Patrocinado</p><h2>Negocios destacados</h2><p className="muted">Negocios con plan Plata u Oro. En Explorar, los resultados se ordenan igual para todos.</p></div><a className="text-button" href="#explorar">Ver todos <ArrowRight size={15} aria-hidden="true" /></a></div>
          <div className="landing-business-grid">{destacados.map(p => <NegocioDestacado key={p.id} p={p} />)}</div>
        </section>}

        <section className="landing-section">
          <div className="landing-section-head"><div><p className="eyebrow">Cómo funciona</p><h2>Encuentra lo que necesitas, sin registrarte</h2></div></div>
          <ol className="landing-steps">
            <li><span><Search size={22} aria-hidden="true" /></span><strong>Busca</strong><p>Escribe un servicio o el nombre de un negocio, o elige una categoría.</p></li>
            <li><span><MapPinned size={22} aria-hidden="true" /></span><strong>Compara</strong><p>Revisa en el mapa horarios, servicios, precios referenciales y cómo llegar.</p></li>
            <li><span><ShieldCheck size={22} aria-hidden="true" /></span><strong>Elige con confianza</strong><p>«{SELLO.nombre}» indica que revisamos sus datos de registro. Los patrocinados siempre van marcados.</p></li>
          </ol>
        </section>

        {!!conAnimales.length && <section className="landing-section">
          <div className="landing-section-head"><div><p className="eyebrow">Comunidad</p><h2>Organizaciones que puedes apoyar</h2><p className="muted">Rescatan, cuidan y buscan hogar para animales. Participan en PetSuite sin costo.</p></div><a className="text-button" href="#adopciones">Ver adopciones <ArrowRight size={15} aria-hidden="true" /></a></div>
          <div className="landing-ongs">{conAnimales.map(o => <a key={o.id} className="landing-ong" href={`#ong/${o.id}`}><span className="landing-ong-mark"><Heart size={22} aria-hidden="true" /></span><strong>{o.nombre}</strong><small>{tipoOng[o.tipo] || o.tipo} · {o.comuna}</small>{o.mision && <p>{o.mision}</p>}<span className="landing-ong-stats">{o.animales > 0 && <span>{o.animales} {o.animales === 1 ? 'animal' : 'animales'} en adopción</span>}{o.cupones > 0 && <span>{o.cupones} {o.cupones === 1 ? 'cupón' : 'cupones'} con negocios</span>}</span></a>)}</div>
        </section>}

        {aliados.length >= 3 && <Aliados items={aliados} />}

        <section className="landing-section">
          <div className="landing-section-head"><div><p className="eyebrow">Quiénes somos</p><h2>Una red para cuidar mejor a las mascotas</h2></div></div>
          <div className="landing-about">
            <article><Store size={22} aria-hidden="true" /><h3>Misión</h3><p>Conectar a tutores con servicios Pet-Care de su comuna y dar a cada mascota una ficha de salud que la proteja en una emergencia.</p></article>
            <article><PawPrint size={22} aria-hidden="true" /><h3>Visión</h3><p>Ser el lugar donde tutores, negocios y organizaciones de cada comuna se encuentran para cuidar a sus animales.</p></article>
            <article><HeartHandshake size={22} aria-hidden="true" /><h3>Apoyo a las ONG</h3><p>Las organizaciones de rescate usan PetSuite sin costo: publican animales en adopción y reciben apoyo con cupones de negocios aliados.</p></article>
          </div>
        </section>

        <section className="landing-cta">
          <article><QrCode size={26} aria-hidden="true" /><div><h2>¿Tienes una mascota?</h2><p>Crea gratis su ficha de salud y su QR de emergencia.</p></div><a className="primary" href="#registro">Crear cuenta gratis</a></article>
          <article><Home size={26} aria-hidden="true" /><div><h2>¿Tienes un negocio Pet-Care?</h2><p>Aparece gratis en Explorar una vez validado. Con un plan sumas sucursales, ofertas y más visibilidad.</p></div><a className="secondary" href="#planes">Ver planes</a></article>
        </section>
      </div>
    </main>
    <PublicFooter />
  </div>
}
