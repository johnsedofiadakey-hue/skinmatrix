import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import MatrixScene from './MatrixScene'
import { AddIcon, Arrow, CartPanel, heroProducts, priceLabel, ProductVisual, SiteFooter, SiteHeader, useSite } from './storefront'
import { canBuy } from './cloud/site.js'

gsap.registerPlugin(ScrollTrigger)

const concerns = {
  Glow: { eyebrow: 'For glowing skin', line: 'Care for your skin from the inside and the outside.', items: ['Collagen', 'Vitamin C', 'Omega 3', 'Hyaluronic acid'] },
  Hair: { eyebrow: 'For stronger hair', line: 'Strong hair needs more than shampoo.', items: ['Biotin', 'Collagen', 'Zinc', 'Scalp care'] },
  Energy: { eyebrow: 'For more energy', line: 'Help your body keep going through the day.', items: ['Magnesium', 'Vitamin B', 'Omega 3', 'Iron'] },
  Sleep: { eyebrow: 'For better sleep', line: 'Good sleep starts before you go to bed.', items: ['Magnesium', 'Sleep tea', 'Lavender', 'Glycine'] },
  'Clear Skin': { eyebrow: 'For clear skin', line: 'Help your skin stay clear and calm.', items: ['Niacinamide', 'Zinc', 'Sunscreen', 'Omega 3'] },
  'Healthy Ageing': { eyebrow: 'For skin as you age', line: 'Keep your skin and body strong as you get older.', items: ['Collagen', 'Retinal', 'CoQ10', 'Vitamin C'] },
  "Women's Health": { eyebrow: 'For women', line: 'Care for every stage of a woman’s life.', items: ['Magnesium', 'Iron', 'Evening primrose', 'Omega 3'] },
  'Everyday Health': { eyebrow: 'For every day', line: 'The basics your body needs every day.', items: ['Multivitamin', 'Vitamin D3', 'Probiotics', 'Omega 3'] },
}

const HERO_IDS = ['collagen', 'magnesium', 'wellwoman', 'anua']
const heroShelfProducts = heroProducts.map((product, index) => ({ id: HERO_IDS[index], product, label: product.type }))

const heroFocuses = {
  'Whole self': { products: [], line: '' },
  Glow: { products: ['collagen', 'anua'], line: 'Collagen and a serum for dark spots, for skin that glows.' },
  Sleep: { products: ['magnesium'], line: 'Magnesium to help you relax in the evening.' },
  Energy: { products: ['magnesium'], line: 'Magnesium to help your body make energy.' },
  Hair: { products: ['collagen'], line: 'Collagen and biotin for hair, skin and nails.' },
  "Women’s Health": { products: ['wellwoman'], line: 'Vitamins made for women over 50.' },
}

const ingredients = [
  ['Vitamin C', 'Brightens skin', 'C'], ['Collagen', 'Firms skin', 'Co'], ['Hyaluronic acid', 'Keeps skin moist', 'HA'], ['Biotin', 'Helps hair and nails', 'B7'], ['Magnesium', 'Helps you relax', 'Mg'], ['Omega 3', 'Feeds skin and heart', 'O3'],
]

const ages = {
  '18–29': { tag: 'Start', result: 'Start good habits early.' },
  '30–39': { tag: 'Protect', result: 'Protect your skin and keep it moist.' },
  '40–49': { tag: 'Support', result: 'Give your skin and body more support.' },
  '50+': { tag: 'Renew', result: 'Care for your skin, bones and energy.' },
}

const RAIL_TONES = ['neocell', 'magnesium', 'wellwoman', 'anua']

function ShelfProduct({ item, active }) {
  const { product } = item
  return <article className={`shelf-product shelf-product--${item.id} ${active ? 'is-focus' : ''}`} data-shelf-product={item.id}>
    <div className="shelf-product-glow" />
    <img src={product.image} alt={`${product.brand} ${product.name}`} />
    <div className="shelf-product-copy"><span>{item.label}</span><b>{product.brand}</b><small>{product.name}</small></div>
  </article>
}

// "Your body\nis a" -> Your body<br />is a
const withBreaks = (text) => String(text).split('\n').flatMap((line, index) => index ? [<br key={index} />, line] : [line])

export default function App() {
  const app = useRef(null)
  const { content, products, cart, add } = useSite()
  const [activeConcern, setActiveConcern] = useState('Glow')
  const [activeNode, setActiveNode] = useState('Skin')
  const [activeAge, setActiveAge] = useState('30–39')
  const [heroFocus, setHeroFocus] = useState('Whole self')
  const current = concerns[activeConcern]
  const currentHeroFocus = heroFocuses[heroFocus]
  const { home } = content

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

  const focusButtons = Object.keys(heroFocuses).filter((name) => name !== 'Whole self').map((name) => <button key={name} className={heroFocus === name ? 'active' : ''} onClick={() => setHeroFocus(heroFocus === name ? 'Whole self' : name)} aria-pressed={heroFocus === name}>{name}</button>)

  return <main ref={app}>
    <SiteHeader />

    <section className="hero matrix-shelf-hero" id="top">
      <div className={`hero-sticky ${heroFocus !== 'Whole self' ? 'focus-active' : ''}`} data-focus={heroFocus}>
        <div className="hero-atmosphere" aria-hidden="true"><i className="atmosphere-a" /><i className="atmosphere-b" /><i className="atmosphere-c" /><span className="atmosphere-grain" /></div>
        <div className="eyebrow hero-kicker">SkinMatrix · Skincare and supplements</div>
        <div className="hero-copy">
          <div className="hero-intro-copy">
            <h1>{withBreaks(home.heroTitle)} <em>{home.heroAccent}</em></h1>
            <p>{heroFocus === 'Whole self' ? home.heroText : currentHeroFocus.line}</p>
            <div className="hero-actions"><a href="/shop" className="button dark">Shop now <Arrow /></a><a href="#concerns" className="button ghost">Find by need <Arrow /></a></div>
            <div className="mobile-focus-controls" role="group" aria-label="Show products for a need">{focusButtons}</div>
            <span className="hero-proof">Trusted brands · Delivered to you</span>
          </div>
          <div className="hero-payoff"><span className="eyebrow">Pick what you need</span><h2>Care that<br /><em>fits you.</em></h2><p>{currentHeroFocus.line || 'Tap a need to see the products that help.'}</p><div className="hero-focus-controls" role="group" aria-label="Show products for a need">{focusButtons}</div><a href="/shop" className="button light hero-payoff-shop">Shop now <Arrow /></a></div>
        </div>
        <div className="hero-shelf-stage" aria-label="Some of our products">
          <div className="shelf-aurora" /><div className="shelf-ring shelf-ring-a" /><div className="shelf-ring shelf-ring-b" />
          <div className="shelf-plinth shelf-plinth-top" /><div className="shelf-plinth shelf-plinth-bottom" />
          <div className="hero-threads" aria-hidden="true">{heroShelfProducts.map(item => <i key={item.id} className={`matrix-thread matrix-thread--${item.id} ${heroFocus === 'Whole self' || currentHeroFocus.products.includes(item.id) ? 'is-active' : ''}`} />)}</div>
          <div className="matrix-shelf">{heroShelfProducts.map(item => <ShelfProduct item={item} active={heroFocus === 'Whole self' || currentHeroFocus.products.includes(item.id)} key={item.id} />)}</div>
        </div>
        <span className="scroll-prompt">Scroll down <i /></span><span className="hero-scroll-note">It all <em>works together.</em></span>
      </div>
    </section>

    <section className="inside-outside">
      <div className="io-heading reveal"><span className="eyebrow">Two kinds of care</span><h2>What you <em>take.</em><br />What you <em>apply.</em></h2><p>Both matter.</p></div>
      <div className="io-worlds reveal">
        <article className="io-panel nutrition"><span>01 / Inside</span><h3>Supplements</h3><p>Vitamins and minerals that help your skin, hair and body from the inside.</p><a href="/shop?category=Supplements">Shop supplements <Arrow /></a><div className="pill-art"><i /><i /><i /></div></article>
        <article className="io-panel skincare"><span>02 / Outside</span><h3>Skincare</h3><p>Serums and creams for your skin, as it is today.</p><a href="/shop?category=Skincare">Shop skincare <Arrow /></a><div className="drop-art" /></article>
      </div>
    </section>

    <section className="concern-section" id="concerns">
      <div className="section-top reveal"><span className="eyebrow">Find by need</span><h2>What do you<br /><em>need help with?</em></h2><p>Pick a need. We show you what can help.</p></div>
      <div className="concern-layout reveal">
        <div className="concern-list">{Object.keys(concerns).map((name, index) => <button className={activeConcern === name ? 'active' : ''} onClick={() => setActiveConcern(name)} key={name} aria-pressed={activeConcern === name}><small>0{index + 1}</small>{name}<Arrow /></button>)}</div>
        <aside className="concern-detail"><span className="eyebrow">{current.eyebrow}</span><h3>{activeConcern}</h3><p>{current.line}</p><div className="recommendations">{current.items.map((item, i) => <span key={item}><b>0{i + 1}</b>{item}</span>)}</div><a href="/shop" className="button dark">See products <Arrow /></a></aside>
      </div>
    </section>

    <section className="matrix-explorer" id="matrix">
      <div className="matrix-copy reveal"><span className="eyebrow">Everything is connected</span><h2>Your body is<br /><em>connected.</em></h2><p>Pick an area. We show you the care that goes with it.</p><div className="matrix-response"><span className="eyebrow">{activeNode}</span><h3>Care for your {activeNode.toLowerCase()}.</h3><p>Supplements and skincare that work well together.</p><a href="/shop">Shop now <Arrow /></a></div></div>
      <div className="matrix-map reveal"><div className="map-core"><MatrixScene compact /><span>YOU</span></div>{['Skin', 'Hair', 'Body', 'Energy', 'Sleep', 'Ageing'].map((node, i) => <button onClick={() => setActiveNode(node)} className={`map-node map-${i} ${activeNode === node ? 'selected' : ''}`} key={node} aria-pressed={activeNode === node}>{node}</button>)}</div>
    </section>

    <section className="product-exhibition" id="products">
      <div className="product-heading reveal"><span className="eyebrow">Our products</span><h2>Shop our <em>favourites.</em></h2><p>Trusted brands, chosen by us.</p><img className="product-heading-art" src="/assets/matrix-products.png" alt="" /></div>
      <div className="product-rail reveal">{products.map((product, index) => <article className={`product-slide actual-${RAIL_TONES[index % RAIL_TONES.length]}`} key={product.id} onClick={() => { window.location.href = '/shop' }}><div className="product-index">{String(index + 1).padStart(2, '0')} <span> / {String(products.length).padStart(2, '0')}</span></div><ProductVisual product={product} className="exhibition-product" /><div className="product-caption"><span>{product.brand}</span><h3>{product.name}</h3><p>{product.description}</p><div><b>{priceLabel(product)}</b>{canBuy(product) ? <button onClick={(event) => { event.stopPropagation(); add(product) }} aria-label={`Add ${product.name} to cart${cart[product.id] ? ` (${cart[product.id]} in cart)` : ''}`}><AddIcon /></button> : null}</div></div></article>)}</div>
    </section>

    <section className="ingredient-universe" id="ingredients">
      <div className="ingredient-top reveal"><span className="eyebrow">What is inside</span><h2>Ingredients that<br /><em>work.</em></h2><p>Six ingredients you will find in our products, and what they do.</p></div>
      <div className="ingredient-grid reveal">{ingredients.map(([name, detail, symbol], i) => <a href="/shop" className={`ingredient ingredient-${i}`} key={name}><div className="ingredient-sphere"><i>{symbol}</i></div><span>{name}</span><small>{detail}</small><Arrow /></a>)}</div>
    </section>

    <section className="real-section"><div className="real-image reveal"><img src="/assets/editorial-portrait.png" alt="A smiling woman with healthy skin" /><span>Real skin.<br />Real life.</span></div><div className="real-copy reveal"><span className="eyebrow">For every age</span><h2>Different ages.<br /><em>Different needs.</em></h2><p>Your skin changes as you get older. Pick your age to see where to start.</p><div className="age-switcher">{Object.keys(ages).map(age => <button onClick={() => setActiveAge(age)} className={age === activeAge ? 'active' : ''} key={age} aria-pressed={age === activeAge}><b>{age}</b><span>{ages[age].tag}</span></button>)}</div><div className="age-result"><span className="eyebrow">Age {activeAge}</span><h3>{ages[activeAge].result}</h3><a href="/shop">See products <Arrow /></a></div></div></section>

    <section className="brand-edit" id="edit"><div className="edit-title reveal"><span className="eyebrow">Brands we sell</span><h2>Brands you can <em>trust.</em></h2><p>We only sell products we trust.</p></div><div className="edit-brands reveal"><span>NEOCELL</span><span>NOW</span><span>VITABIOTICS</span><span>ANUA</span><span>OLAPLEX</span></div><a className="text-link reveal" href="/shop">Shop all brands <Arrow /></a></section>

    <section className="closing"><div className="closing-scene"><MatrixScene /><div className="closing-glow" /></div><div className="closing-copy"><span className="eyebrow">SkinMatrix</span><h2>Start your<br /><em>routine.</em></h2><p>Find the right care for you.</p><div><a href="/shop" className="button light">Shop now <Arrow /></a><a href="#concerns" className="button outline">Find by need <Arrow /></a></div></div></section>
    <SiteFooter />
    <CartPanel />
  </main>
}
