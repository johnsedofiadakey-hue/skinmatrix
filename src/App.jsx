import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import MatrixScene from './MatrixScene'

gsap.registerPlugin(ScrollTrigger)

const concerns = {
  Glow: { eyebrow: 'Inside + outside', line: 'Radiance is a daily system.', items: ['Collagen', 'Vitamin C', 'Omega 3', 'Hyaluronic Acid'] },
  Hair: { eyebrow: 'Strength + density', line: 'Stronger hair begins with more than shampoo.', items: ['Biotin', 'Collagen', 'Zinc', 'Scalp Care'] },
  Energy: { eyebrow: 'Daily vitality', line: 'Support the rhythm behind your day.', items: ['Magnesium', 'B Complex', 'Omega 3', 'Iron Support'] },
  Sleep: { eyebrow: 'Rest + restore', line: 'Night-time care begins long before bed.', items: ['Magnesium', 'Sleep Tea', 'Lavender Mist', 'Glycine'] },
  'Clear Skin': { eyebrow: 'Balance + clarity', line: 'A clearer routine, from within.', items: ['Niacinamide', 'Zinc', 'SPF 50', 'Omega 3'] },
  'Healthy Ageing': { eyebrow: 'Support + renew', line: 'Build what time should not take away.', items: ['Collagen', 'Retinal', 'CoQ10', 'Vitamin C'] },
  "Women's Wellness": { eyebrow: 'Cycle + strength', line: 'Care tuned to every changing phase.', items: ['Magnesium', 'Iron Support', 'Evening Primrose', 'Omega 3'] },
  'Everyday Health': { eyebrow: 'The daily base', line: 'Small rituals make a resilient system.', items: ['Multivitamin', 'Vitamin D3', 'Probiotics', 'Omega 3'] },
}

const products = [
  { no: '01', name: 'Collagen Complex', category: 'Inside', type: 'Beauty from within', note: 'Skin elasticity · hair · nails', price: 'GHS 340', tone: 'rose' },
  { no: '02', name: 'Barrier Serum', category: 'On the surface', type: 'Skin intelligence', note: 'Hydration · glow · balance', price: 'GHS 285', tone: 'lilac' },
  { no: '03', name: 'Magnesium Night', category: 'Inside', type: 'Restore gently', note: 'Sleep · calm · recovery', price: 'GHS 190', tone: 'gold' },
]

const ingredients = [
  ['Vitamin C', 'Brighten + protect', 'C'], ['Collagen', 'Structure + strength', 'Co'], ['Hyaluronic Acid', 'Bind + hydrate', 'HA'], ['Biotin', 'Support + grow', 'B7'], ['Magnesium', 'Rest + restore', 'Mg'], ['Omega 3', 'Nourish + balance', 'Ω3'],
]

function Arrow() { return <span aria-hidden="true">↗</span> }

function ProductObject({ tone, large = false }) {
  return <div className={`product-object ${tone} ${large ? 'large' : ''}`} aria-hidden="true">
    <i className="orb orb-a" /><i className="orb orb-b" /><i className="capsule" />
    <div className="bottle"><div className="bottle-cap" /><div className="bottle-label">SKIN<br />MATRIX</div></div>
  </div>
}

function ShopPanel({ open, mode, onClose, cart, onAdd, onRemove }) {
  const [filter, setFilter] = useState('All')
  const [selected, setSelected] = useState(products[0])
  const visible = filter === 'All' ? products : products.filter((product) => product.category === filter)
  const cartItems = products.filter((product) => cart[product.name])

  return <aside className={`shop-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
    <button className="panel-backdrop" onClick={onClose} aria-label="Close shop" />
    <div className="panel-sheet" role="dialog" aria-modal="true" aria-label={mode === 'bag' ? 'Your bag' : 'Shop SkinMatrix'}>
      <div className="panel-top"><span className="eyebrow">{mode === 'bag' ? 'Your selected rituals' : 'The SkinMatrix selection'}</span><button onClick={onClose} className="panel-close" aria-label="Close">×</button></div>
      {mode === 'bag' ? <div className="bag-view"><h2>Your <em>bag.</em></h2>{cartItems.length ? <><div className="bag-items">{cartItems.map(product => <div className="bag-item" key={product.name}><ProductObject tone={product.tone} /><div><span>{product.type}</span><h3>{product.name}</h3><p>{cart[product.name]} × {product.price}</p></div><button onClick={() => onRemove(product.name)} aria-label={`Remove ${product.name}`}>−</button></div>)}</div><div className="bag-total"><span>Total</span><b>GHS {cartItems.reduce((total, item) => total + Number(item.price.replace(/[^0-9]/g, '')) * cart[item.name], 0)}</b></div><button className="button dark checkout">Continue to checkout <Arrow /></button></> : <p className="empty-state">Nothing selected yet. Start with a goal, then add what your routine needs.</p>}<a className="text-link" href="#concerns" onClick={onClose}>Shop by concern <Arrow /></a></div> : <div className="shop-view"><div className="shop-title"><h2>Find your<br /><em>ritual.</em></h2><p>Thoughtful care, from within and on the surface.</p></div><div className="shop-filters">{['All', 'Inside', 'On the surface'].map(item => <button key={item} onClick={() => setFilter(item)} className={filter === item ? 'active' : ''}>{item}</button>)}</div><div className="shop-products">{visible.map(product => <article key={product.name} className={selected.name === product.name ? 'selected' : ''} onClick={() => setSelected(product)}><div className="shop-product-art"><ProductObject tone={product.tone} /></div><div><span>{product.type}</span><h3>{product.name}</h3><p>{product.note}</p><b>{product.price}</b></div></article>)}</div><div className="quick-product"><ProductObject tone={selected.tone} /><div><span className="eyebrow">{selected.type}</span><h3>{selected.name}</h3><p>{selected.note}. A considered daily essential for your wider system.</p><div><b>{selected.price}</b><button className="button dark" onClick={() => onAdd(selected)}>Add to bag <Arrow /></button></div></div></div></div>}
    </div>
  </aside>
}

export default function App() {
  const app = useRef(null)
  const [activeConcern, setActiveConcern] = useState('Glow')
  const [activeNode, setActiveNode] = useState('Skin')
  const [activeAge, setActiveAge] = useState('30–39')
  const [panelMode, setPanelMode] = useState(null)
  const [cart, setCart] = useState({})
  const current = concerns[activeConcern]
  const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0)
  const addProduct = (product) => setCart((items) => ({ ...items, [product.name]: (items[product.name] || 0) + 1 }))
  const removeProduct = (name) => setCart((items) => ({ ...items, [name]: Math.max(0, (items[name] || 1) - 1) }))

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-copy > *', { y: 34, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out', delay: 0.15 })
      gsap.from('.hero-stage', { scale: 0.9, opacity: 0, duration: 1.2, ease: 'power3.out' })
      gsap.utils.toArray('.reveal').forEach((item) => gsap.from(item, { scrollTrigger: { trigger: item, start: 'top 83%' }, y: 32, opacity: 0, duration: 0.8, ease: 'power3.out' }))
      gsap.to('.hero-stage', { scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 }, yPercent: 16, rotate: 4, scale: 0.86 })
    }, app)
    return () => ctx.revert()
  }, [])

  return <main ref={app}>
    <header className="site-header">
      <a href="#top" className="brand"><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix — Nutrition for Every Age" /></a>
      <nav><a href="#concerns">Discover</a><button onClick={() => setPanelMode('shop')}>Shop</button><a href="#ingredients">Ingredients</a><a href="#edit">The Edit</a></nav>
      <div className="header-actions"><button aria-label="Search">⌕</button><button onClick={() => setPanelMode('bag')} aria-label="Open shopping bag">Bag <sup>{cartCount}</sup></button><button className="menu" aria-label="Open menu">☰</button></div>
    </header>

    <section className="hero" id="top">
      <div className="eyebrow hero-kicker">SkinMatrix / Beauty + Wellness</div>
      <div className="hero-copy">
        <h1>Your body<br /><em>is a system.</em></h1>
        <p>Beauty, nutrition, rest, and ritual—designed to work together.</p>
        <a href="#matrix" className="button dark">Explore the matrix <Arrow /></a>
      </div>
      <div className="hero-stage"><MatrixScene /><div className="node node-skin">Skin</div><div className="node node-hair">Hair</div><div className="node node-sleep">Sleep</div><div className="node node-energy">Energy</div><div className="node node-nutrition">Nutrition</div><div className="node node-ageing">Ageing</div></div>
      <p className="hero-note">Take care of the<br />whole matrix.</p>
      <span className="scroll-prompt">Scroll to enter <i /></span>
    </section>

    <section className="inside-outside">
      <div className="io-heading reveal"><span className="eyebrow">One considered approach</span><h2>What you put <em>in.</em><br />What you put <em>on.</em></h2><p>Both matter.</p></div>
      <div className="io-worlds reveal">
        <article className="io-panel nutrition"><span>01 / From within</span><h3>Nutrition</h3><p>The intelligent daily essentials that support every visible ritual.</p><a href="#products">Shop nutrition <Arrow /></a><div className="pill-art"><i /><i /><i /></div></article>
        <article className="io-panel skincare"><span>02 / On the surface</span><h3>Skincare</h3><p>Focused formulas that meet your skin where it is today.</p><a href="#products">Shop skincare <Arrow /></a><div className="drop-art" /></article>
      </div>
    </section>

    <section className="concern-section" id="concerns">
      <div className="section-top reveal"><span className="eyebrow">Shop the change</span><h2>What would you<br /><em>like to feel?</em></h2><p>Start with what matters to you—not a category.</p></div>
      <div className="concern-layout reveal">
        <div className="concern-list">{Object.keys(concerns).map((name, index) => <button className={activeConcern === name ? 'active' : ''} onClick={() => setActiveConcern(name)} key={name}><small>0{index + 1}</small>{name}<Arrow /></button>)}</div>
        <aside className="concern-detail"><span className="eyebrow">{current.eyebrow}</span><h3>{activeConcern}</h3><p>{current.line}</p><div className="recommendations">{current.items.map((item, i) => <span key={item}><b>0{i + 1}</b>{item}</span>)}</div><a href="#products" className="button dark">Build my routine <Arrow /></a></aside>
      </div>
    </section>

    <section className="matrix-explorer" id="matrix">
      <div className="matrix-copy reveal"><span className="eyebrow">A more connected way to shop</span><h2>Meet your<br /><em>matrix.</em></h2><p>Choose a place to begin. We connect the care around it.</p><div className="matrix-response"><span className="eyebrow">{activeNode} matrix</span><h3>{activeNode === 'Hair' ? 'More than shampoo.' : activeNode === 'Sleep' ? 'Rest is part of your ritual.' : 'Care that connects.'}</h3><p>Targeted selections across nutrition and skincare, designed to work with your whole system.</p><a href="#products">Shop {activeNode} Matrix <Arrow /></a></div></div>
      <div className="matrix-map reveal"><div className="map-core"><MatrixScene compact /><span>YOU</span></div>{['Skin', 'Hair', 'Body', 'Energy', 'Sleep', 'Ageing'].map((node, i) => <button onClick={() => setActiveNode(node)} className={`map-node map-${i} ${activeNode === node ? 'selected' : ''}`} key={node}>{node}</button>)}</div>
    </section>

    <section className="product-exhibition" id="products">
      <div className="product-heading reveal"><span className="eyebrow">The SkinMatrix selection</span><h2>Objects of <em>care.</em></h2><p>Designed to live on your shelf, and in your routine.</p><img className="product-heading-art" src="/assets/matrix-products.png" alt="SkinMatrix product and serum composition" /></div>
      <div className="product-rail reveal">{products.map((product, i) => <article className="product-slide" key={product.name} onClick={() => setPanelMode('shop')}><div className="product-index">{product.no} <span> / 03</span></div><ProductObject tone={product.tone} large={i === 0} /><div className="product-caption"><span>{product.type}</span><h3>{product.name}</h3><p>{product.note}</p><div><b>{product.price}</b><button onClick={(event) => { event.stopPropagation(); addProduct(product) }} aria-label={`Add ${product.name} to bag`}>+</button></div></div></article>)}</div>
    </section>

    <section className="ingredient-universe" id="ingredients">
      <div className="ingredient-top reveal"><span className="eyebrow">The universe within</span><h2>Ingredients with<br /><em>intention.</em></h2><p>Six essentials. Countless moments of care.</p></div>
      <div className="ingredient-grid reveal">{ingredients.map(([name, detail, symbol], i) => <button className={`ingredient ingredient-${i}`} key={name}><div className="ingredient-sphere"><i>{symbol}</i></div><span>{name}</span><small>{detail}</small><Arrow /></button>)}</div>
    </section>

    <section className="real-section"><div className="real-image reveal"><img src="/assets/editorial-portrait.png" alt="SkinMatrix editorial portrait celebrating real skin" /><span>Real skin.<br />Real life.</span></div><div className="real-copy reveal"><span className="eyebrow">Nutrition for every age</span><h2>Different skin.<br /><em>Different needs.</em></h2><p>There is no one routine that fits every decade. Choose a starting point that meets you where you are.</p><div className="age-switcher">{['18–29', '30–39', '40–49', '50+'].map(age => <button onClick={() => setActiveAge(age)} className={age === activeAge ? 'active' : ''} key={age}><b>{age}</b><span>{age === '18–29' ? 'Build' : age === '30–39' ? 'Protect' : age === '40–49' ? 'Support' : 'Renew'}</span></button>)}</div><div className="age-result"><span className="eyebrow">Your {activeAge}</span><h3>{activeAge === '18–29' ? 'Build a lasting base.' : activeAge === '30–39' ? 'Protect. Hydrate. Maintain.' : activeAge === '40–49' ? 'Support what matters.' : 'Renew with intention.'}</h3><a href="#products">See your edit <Arrow /></a></div></div></section>

    <section className="brand-edit" id="edit"><div className="edit-title reveal"><span className="eyebrow">Curated, never crowded</span><h2>The SkinMatrix <em>Edit.</em></h2><p>We don’t stock everything. We select what deserves to be here.</p></div><div className="edit-brands reveal"><span>WELLBEL</span><span>THE ORDINARY</span><span>VITAL PROTEINS</span><span>LA ROCHE-POSAY</span><span>OLAPLEX</span></div><a className="text-link reveal" href="#products">Explore all brands <Arrow /></a></section>

    <section className="closing"><div className="closing-scene"><MatrixScene /><div className="closing-glow" /></div><div className="closing-copy"><span className="eyebrow">SkinMatrix</span><h2>Build your<br /><em>matrix.</em></h2><p>Care can be more connected.</p><div><a href="#concerns" className="button light">Shop by concern <Arrow /></a><a href="#products" className="button outline">Explore everything <Arrow /></a></div></div></section>
    <footer><img src="/assets/skinmatrix-logo.png" alt="SkinMatrix" /><div><a href="#top">Instagram</a><a href="#top">Contact</a><a href="#top">Shipping & Returns</a></div><small>© 2026 SkinMatrix. Nutrition for every age.</small></footer>
    <ShopPanel open={Boolean(panelMode)} mode={panelMode} onClose={() => setPanelMode(null)} cart={cart} onAdd={addProduct} onRemove={removeProduct} />
  </main>
}
