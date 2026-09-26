import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import MatrixScene from './MatrixScene'
import { Arrow, BagPanel, ProductVisual, SiteFooter, SiteHeader, products, useBag } from './storefront'

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

const heroShelfProducts = [
  { id: 'collagen', product: products[0], label: 'Beauty support' },
  { id: 'magnesium', product: products[1], label: 'Rest + restore' },
  { id: 'wellwoman', product: products[2], label: "Women's wellbeing" },
  { id: 'anua', product: products[3], label: 'Targeted skincare' },
]

const heroFocuses = {
  'Whole self': { products: [], line: 'Skin. Sleep. Energy. Women’s wellness. One considered edit for the whole you.' },
  Glow: { products: ['collagen', 'anua'], line: 'Collagen support and targeted skincare, brought into the same glow ritual.' },
  Sleep: { products: ['magnesium'], line: 'A slower evening starts with a considered magnesium ritual.' },
  Energy: { products: ['magnesium'], line: 'A focused daily essential for the rhythm behind your day.' },
  Hair: { products: ['collagen'], line: 'Beauty support that considers strength, structure and the long view.' },
  "Women’s Wellness": { products: ['wellwoman'], line: 'An edit centred on women’s wellbeing at every changing stage.' },
}

const ingredients = [
  ['Vitamin C', 'Brighten + protect', 'C'], ['Collagen', 'Structure + strength', 'Co'], ['Hyaluronic Acid', 'Bind + hydrate', 'HA'], ['Biotin', 'Support + grow', 'B7'], ['Magnesium', 'Rest + restore', 'Mg'], ['Omega 3', 'Nourish + balance', 'Ω3'],
]

function ShelfProduct({ item, active }) {
  const { product } = item
  return <article className={`shelf-product shelf-product--${item.id} ${active ? 'is-focus' : ''}`} data-shelf-product={item.id}>
    <div className="shelf-product-glow" />
    <img src={product.image} alt={`${product.brand} ${product.name}`} />
    <div className="shelf-product-copy"><span>{product.no} / {item.label}</span><b>{product.brand}</b><small>{product.name}</small></div>
  </article>
}

export default function App() {
  const app = useRef(null)
  const [activeConcern, setActiveConcern] = useState('Glow')
  const [activeNode, setActiveNode] = useState('Skin')
  const [activeAge, setActiveAge] = useState('30–39')
  const [bagOpen, setBagOpen] = useState(false)
  const { bag, count: cartCount, add: addProduct, remove: removeProduct } = useBag()
  const [heroFocus, setHeroFocus] = useState('Whole self')
  const current = concerns[activeConcern]
  const currentHeroFocus = heroFocuses[heroFocus]

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.hero-shelf-stage', { scale: 0.94, opacity: 0, duration: 1.25, ease: 'power3.out' })
      gsap.utils.toArray('.reveal').forEach((item) => gsap.from(item, { scrollTrigger: { trigger: item, start: 'top 83%' }, y: 32, opacity: 0, duration: 0.8, ease: 'power3.out' }))
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        gsap.to('.shelf-product--collagen img', { y: -18, rotation: -3, duration: 3.9, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.shelf-product--magnesium img', { y: 16, rotation: 4, duration: 4.7, delay: 0.4, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.shelf-product--wellwoman img', { y: -13, rotation: -2, duration: 4.3, delay: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.shelf-product--anua img', { y: 17, rotation: 5, duration: 3.6, delay: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.shelf-ring-a', { rotation: 340, duration: 26, ease: 'none', repeat: -1 })
        gsap.to('.shelf-ring-b', { rotation: -330, duration: 32, ease: 'none', repeat: -1 })
        gsap.to('.shelf-aurora', { scale: 1.08, opacity: 0.78, duration: 4.5, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.hero-atmosphere .atmosphere-a', { xPercent: 12, yPercent: -9, scale: 1.12, duration: 9, ease: 'sine.inOut', repeat: -1, yoyo: true })
        gsap.to('.hero-atmosphere .atmosphere-b', { xPercent: -13, yPercent: 9, scale: 1.08, duration: 11, ease: 'sine.inOut', repeat: -1, yoyo: true })

        if (window.innerWidth > 760) {
          const scatteredSlots = gsap.utils.shuffle([
            { left: '5%', top: '10%', rotation: -7 },
            { left: '69%', top: '9%', rotation: 6 },
            { left: '7%', top: '57%', rotation: -5 },
            { left: '70%', top: '58%', rotation: 7 },
          ])
          const shelfProducts = gsap.utils.toArray('.shelf-product')
          shelfProducts.forEach((product, index) => gsap.set(product, { ...scatteredSlots[index], right: 'auto', bottom: 'auto', transformOrigin: '50% 65%' }))
        }
      }
    }, app)
    return () => ctx.revert()
  }, [])

  return <main ref={app}>
    <SiteHeader bagCount={cartCount} onBag={() => setBagOpen(true)} />

    <section className="hero matrix-shelf-hero" id="top">
      <div className={`hero-sticky ${heroFocus !== 'Whole self' ? 'focus-active' : ''}`} data-focus={heroFocus}>
        <div className="hero-atmosphere" aria-hidden="true"><i className="atmosphere-a" /><i className="atmosphere-b" /><i className="atmosphere-c" /><span className="atmosphere-grain" /></div>
        <div className="eyebrow hero-kicker">SkinMatrix / skincare + supplements</div>
        <div className="hero-copy">
          <div className="hero-intro-copy"><h1>Your body<br />is a <em>system.</em></h1><p>Skin. Sleep. Energy. Women’s wellness.<br />One considered edit for the whole you.</p><div className="hero-actions"><a href="/shop" className="button dark">Shop now <Arrow /></a><a href="#concerns" className="button ghost">Explore the matrix <Arrow /></a></div><div className="mobile-focus-controls" role="tablist" aria-label="Choose a SkinMatrix focus">{Object.keys(heroFocuses).filter((name) => name !== 'Whole self').map(name => <button key={name} className={heroFocus === name ? 'active' : ''} onClick={() => setHeroFocus(name)} role="tab" aria-selected={heroFocus === name}>{name}</button>)}</div><span className="hero-proof">The real edit · for your whole routine</span></div>
          <div className="hero-payoff"><span className="eyebrow">Choose your focus</span><h2>Build care<br /><em>around you.</em></h2><p>{currentHeroFocus.line}</p><div className="hero-focus-controls" role="tablist" aria-label="Choose a SkinMatrix focus">{Object.keys(heroFocuses).filter((name) => name !== 'Whole self').map(name => <button key={name} className={heroFocus === name ? 'active' : ''} onClick={() => setHeroFocus(name)} role="tab" aria-selected={heroFocus === name}>{name}</button>)}</div><a href="/shop" className="button light hero-payoff-shop">Shop this edit <Arrow /></a></div>
        </div>
        <div className="hero-shelf-stage" aria-label="The SkinMatrix product edit">
          <div className="shelf-aurora" /><div className="shelf-ring shelf-ring-a" /><div className="shelf-ring shelf-ring-b" />
          <div className="shelf-plinth shelf-plinth-top" /><div className="shelf-plinth shelf-plinth-bottom" />
          <div className="hero-threads" aria-hidden="true">{heroShelfProducts.map(item => <i key={item.id} className={`matrix-thread matrix-thread--${item.id} ${heroFocus === 'Whole self' || currentHeroFocus.products.includes(item.id) ? 'is-active' : ''}`} />)}</div>
          <div className="matrix-shelf">{heroShelfProducts.map(item => <ShelfProduct item={item} active={heroFocus === 'Whole self' || currentHeroFocus.products.includes(item.id)} key={item.id} />)}</div>
        </div>
        <span className="scroll-prompt">Scroll to discover <i /></span><span className="hero-scroll-note">The edit comes <em>together.</em></span>
      </div>
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
      <div className="product-rail reveal">{products.map((product) => <article className={`product-slide actual-${product.tone}`} key={product.name} onClick={() => { window.location.href = '/shop' }}><div className="product-index">{product.no} <span> / 0{products.length}</span></div><ProductVisual product={product} className="exhibition-product" /><div className="product-caption"><span>{product.brand}</span><h3>{product.name}</h3><p>{product.note}</p><div><b>{product.price}</b><button onClick={(event) => { event.stopPropagation(); addProduct(product) }} aria-label={`Save ${product.name} to your edit`}>+</button></div></div></article>)}</div>
    </section>

    <section className="ingredient-universe" id="ingredients">
      <div className="ingredient-top reveal"><span className="eyebrow">The universe within</span><h2>Ingredients with<br /><em>intention.</em></h2><p>Six essentials. Countless moments of care.</p></div>
      <div className="ingredient-grid reveal">{ingredients.map(([name, detail, symbol], i) => <button className={`ingredient ingredient-${i}`} key={name}><div className="ingredient-sphere"><i>{symbol}</i></div><span>{name}</span><small>{detail}</small><Arrow /></button>)}</div>
    </section>

    <section className="real-section"><div className="real-image reveal"><img src="/assets/editorial-portrait.png" alt="SkinMatrix editorial portrait celebrating real skin" /><span>Real skin.<br />Real life.</span></div><div className="real-copy reveal"><span className="eyebrow">Nutrition for every age</span><h2>Different skin.<br /><em>Different needs.</em></h2><p>There is no one routine that fits every decade. Choose a starting point that meets you where you are.</p><div className="age-switcher">{['18–29', '30–39', '40–49', '50+'].map(age => <button onClick={() => setActiveAge(age)} className={age === activeAge ? 'active' : ''} key={age}><b>{age}</b><span>{age === '18–29' ? 'Build' : age === '30–39' ? 'Protect' : age === '40–49' ? 'Support' : 'Renew'}</span></button>)}</div><div className="age-result"><span className="eyebrow">Your {activeAge}</span><h3>{activeAge === '18–29' ? 'Build a lasting base.' : activeAge === '30–39' ? 'Protect. Hydrate. Maintain.' : activeAge === '40–49' ? 'Support what matters.' : 'Renew with intention.'}</h3><a href="#products">See your edit <Arrow /></a></div></div></section>

    <section className="brand-edit" id="edit"><div className="edit-title reveal"><span className="eyebrow">Curated, never crowded</span><h2>The SkinMatrix <em>Edit.</em></h2><p>We don’t stock everything. We select what deserves to be here.</p></div><div className="edit-brands reveal"><span>NEOCELL</span><span>NOW</span><span>VITABIOTICS</span><span>ANUA</span><span>OLAPLEX</span></div><a className="text-link reveal" href="#products">Explore all brands <Arrow /></a></section>

    <section className="closing"><div className="closing-scene"><MatrixScene /><div className="closing-glow" /></div><div className="closing-copy"><span className="eyebrow">SkinMatrix</span><h2>Build your<br /><em>matrix.</em></h2><p>Care can be more connected.</p><div><a href="#concerns" className="button light">Shop by concern <Arrow /></a><a href="#products" className="button outline">Explore everything <Arrow /></a></div></div></section>
    <SiteFooter />
    <BagPanel open={bagOpen} onClose={() => setBagOpen(false)} bag={bag} onRemove={removeProduct} />
  </main>
}
