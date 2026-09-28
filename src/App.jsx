import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { AddIcon, Arrow, heroProducts, priceLabel, ProductVisual, SiteFooter, SiteHeader, useSite } from './storefront'
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
  const audienceStage = useRef(null)
  const { content, products, cart, add, openProduct } = useSite()
  const [activeConcern, setActiveConcern] = useState('Glow')
  const [activeAge, setActiveAge] = useState('30–39')
  const [heroFocus, setHeroFocus] = useState('Whole self')
  const [activeShopPath, setActiveShopPath] = useState('Women')
  const current = concerns[activeConcern]
  const currentHeroFocus = heroFocuses[heroFocus]
  const { home } = content
  const skincareHighlights = products.filter((product) => product.category === 'Skincare').slice(0, 3)
  const currentShopPath = home.audiencePaths.find((path) => path.id === activeShopPath) || home.audiencePaths[0]

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      // Sections rise into view; the items inside them follow one after another.
      // fromTo with explicit end values: never read the "end" state from the page, which CSS transitions can catch mid-fade.
      const shown = { opacity: 1, x: 0, y: 0 }
      gsap.utils.toArray('.reveal').forEach((item) => gsap.fromTo(item, { y: 80, opacity: 0 }, { ...shown, scrollTrigger: { trigger: item, start: 'top 88%' }, duration: 1.1, ease: 'power4.out' }))
      const staggered = [
        ['.io-worlds', ':scope > article', { y: 90 }],
        ['.home-path-picker', ':scope > button', { y: 42 }],
        ['.home-path-strip', ':scope > span', { y: 28 }],
        ['.concern-list', ':scope > button', { x: -40, y: 0 }],
        ['.product-rail', ':scope > article', { x: 140, y: 0 }],
        ['.age-switcher', ':scope > button', { y: 30 }],
        ['.edit-brands', ':scope > span', { y: 40 }],
      ]
      staggered.forEach(([group, children, from]) => {
        const node = document.querySelector(group)
        if (!node) return
        gsap.fromTo(node.querySelectorAll(children), { opacity: 0, ...from }, { ...shown, scrollTrigger: { trigger: node, start: 'top 85%' }, duration: 0.9, ease: 'power3.out', stagger: 0.09 })
      })
      const careWorlds = document.querySelector('.io-worlds')
      if (careWorlds) {
        gsap.fromTo(careWorlds.querySelectorAll('.io-product'), { y: 56, scale: 0.82, opacity: 0 }, {
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 1.05,
          ease: 'back.out(1.35)',
          stagger: 0.12,
          scrollTrigger: { trigger: careWorlds, start: 'top 78%' },
        })
        gsap.fromTo(careWorlds.querySelector('.io-connection-line'), { scaleX: 0, opacity: 0 }, {
          scaleX: 1,
          opacity: 1,
          duration: 1.25,
          ease: 'power3.out',
          scrollTrigger: { trigger: careWorlds, start: 'top 76%' },
        })
        gsap.to(careWorlds.querySelector('.io-connection b'), { scale: 1.12, duration: 1.55, ease: 'sine.inOut', repeat: -1, yoyo: true })
      }
      gsap.fromTo('.real-image img', { scale: 1.18 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.real-section', start: 'top bottom', end: 'bottom top', scrub: true } })

      // Desktop: the four products start in a random scatter around the headline.
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

      // Opening: headline, text and buttons rise in turn; the products pop in.
      gsap.fromTo('.hero-shelf-stage', { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.25, ease: 'power3.out' })
      gsap.fromTo('.hero-intro-copy > *', { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power4.out', stagger: 0.12, delay: 0.15 })
      gsap.fromTo('.shelf-product', { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.1, ease: 'back.out(1.6)', stagger: 0.14, delay: 0.35, clearProps: 'opacity' }) // so tapping a need can dim the others again

      // Always moving: products float, rings turn, the background glow drifts.
      gsap.to('.shelf-product--collagen img', { y: -30, rotation: -5, duration: 3.9, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.shelf-product--magnesium img', { y: 28, rotation: 6, duration: 4.7, delay: 0.4, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.shelf-product--wellwoman img', { y: -24, rotation: -4, duration: 4.3, delay: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.shelf-product--anua img', { y: 28, rotation: 7, duration: 3.6, delay: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.shelf-ring-a', { rotation: 340, duration: 26, ease: 'none', repeat: -1 })
      gsap.to('.shelf-ring-b', { rotation: -330, duration: 32, ease: 'none', repeat: -1 })
      gsap.to('.shelf-aurora', { scale: 1.08, opacity: 0.78, duration: 4.5, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.hero-atmosphere .atmosphere-a', { xPercent: 12, yPercent: -9, scale: 1.12, duration: 9, ease: 'sine.inOut', repeat: -1, yoyo: true })
      gsap.to('.hero-atmosphere .atmosphere-b', { xPercent: -13, yPercent: 9, scale: 1.08, duration: 11, ease: 'sine.inOut', repeat: -1, yoyo: true })
    }, app)
    return () => ctx.revert()
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !audienceStage.current) return
    const activeCard = audienceStage.current.querySelector('.home-path-active')
    if (!activeCard) return
    const tween = gsap.fromTo(activeCard, { opacity: 0, y: 24, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .62, ease: 'power3.out' })
    return () => tween.kill()
  }, [activeShopPath])

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
            <div className="hero-payment-trust" aria-label="Accepted payment methods"><span>Secure checkout via <b>Paystack</b></span><div><i>MTN MoMo</i><i>Telecel Cash</i><i>AirtelTigo Money</i><i>Cards</i><i>Bank transfer</i></div></div>
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

    <section className={`home-shop-paths home-shop-paths--${currentShopPath.tone}`} aria-labelledby="shop-paths-title">
      <div className="home-shop-paths-intro reveal"><span className="eyebrow">{home.audienceKicker}</span><h2 id="shop-paths-title">{home.audienceTitle}<br /><em>{home.audienceAccent}</em></h2><p>{home.audienceText}</p></div>
      <div className="home-path-picker reveal" role="tablist" aria-label="Choose who you are shopping for">
        {home.audiencePaths.map((path) => <button type="button" key={path.id} role="tab" aria-selected={activeShopPath === path.id} className={activeShopPath === path.id ? 'active' : ''} onClick={() => setActiveShopPath(path.id)}><small>{path.number}</small><b>{path.tab}</b><i /></button>)}
      </div>
      <div className="home-path-stage reveal" ref={audienceStage}>
        <article className={`home-path-active home-path-active--${currentShopPath.tone}`} key={currentShopPath.id}>
          <div className="home-path-copy"><span className="eyebrow">{currentShopPath.number} / {currentShopPath.eyebrow}</span><h3>{currentShopPath.title}<br /><em>{currentShopPath.accent}</em></h3><p>{currentShopPath.description}</p><div className="home-path-tags">{currentShopPath.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><a className="button light" href={currentShopPath.href}>{currentShopPath.action} <Arrow /></a></div>
          <div className="home-path-art" aria-hidden="true">
            <span className="path-orbit path-orbit-a" /><span className="path-orbit path-orbit-b" /><span className="path-orbit path-orbit-c" />
            {currentShopPath.image ? <div className="path-product"><span>{currentShopPath.imageLabel}</span><img src={currentShopPath.image} alt="" referrerPolicy="no-referrer" /></div> : null}
            {currentShopPath.visual === 'children' ? <div className="path-age-orbit"><b>6m–4</b><b>4–12</b><b>13–19</b><i>grow</i></div> : null}
            {currentShopPath.visual === 'goals' ? <div className="path-goal-dial"><b>GAIN</b><i>↔</i><b>LOSS</b><span>your<br />goal</span></div> : null}
          </div>
        </article>
      </div>
      <div className="home-path-strip reveal" aria-label="All shopping paths">{home.audiencePaths.map((path) => <span key={path.id}><b>{path.tab}</b><small>{path.tags.slice(0, 2).join(' · ')}</small></span>)}</div>
      <a className="text-link home-shop-all reveal" href="/shop">Browse everything <Arrow /></a>
    </section>

    <section className="inside-outside" aria-labelledby="care-directions-title">
      <div className="io-heading reveal"><span className="eyebrow">{home.careKicker}</span><h2 id="care-directions-title">{home.careTitle}<br /><em>{home.careAccent}</em></h2><p>{home.careText}</p></div>
      <div className="io-worlds reveal">
        <article className="io-panel nutrition">
          <div className="io-panel-copy"><span>01 / Inside</span><h3>{home.supplementsTitle}</h3><p>{home.supplementsText}</p><div className="io-benefits"><small>Collagen</small><small>Magnesium</small><small>Women’s vitality</small></div><a href="/shop?category=Supplements">{home.supplementsAction} <Arrow /></a></div>
          <div className="io-product-stage io-supplement-stage" aria-label="Supplement highlights">
            {heroProducts.slice(0, 3).map((product, index) => <button type="button" className={`io-product io-product-${index + 1}`} onClick={() => openProduct(product.id)} key={product.id} aria-label={`View ${product.brand} ${product.name}`}><span className="io-product-glow" /><img src={product.image} alt="" /></button>)}
          </div>
        </article>
        <div className="io-connection" aria-hidden="true"><span className="io-connection-line" /><i>inside</i><b>↔</b><i>outside</i></div>
        <article className="io-panel skincare">
          <div className="io-panel-copy"><span>02 / Outside</span><h3>{home.skincareTitle}</h3><p>{home.skincareText}</p><div className="io-benefits"><small>Dark spots</small><small>Even tone</small><small>Barrier care</small></div><a href="/shop?category=Skincare">{home.skincareAction} <Arrow /></a></div>
          <div className="io-product-stage io-skincare-stage" aria-label="Skincare highlights">
            {skincareHighlights.map((product) => <button type="button" className={`io-product io-product-${product.id}`} onClick={() => openProduct(product.id)} key={product.id} aria-label={`View ${product.brand} ${product.name}`}><span className="io-product-glow" /><img src={product.image} alt="" /></button>)}
            <span className="io-serum-orbit" /><span className="io-serum-light" />
          </div>
        </article>
      </div>
    </section>

    <section className="concern-section" id="concerns">
      <div className="section-top reveal"><span className="eyebrow">{home.concernKicker}</span><h2>{home.concernTitle}<br /><em>{home.concernAccent}</em></h2><p>{home.concernText}</p></div>
      <div className="concern-layout reveal">
        <div className="concern-list">{Object.keys(concerns).map((name, index) => <button className={activeConcern === name ? 'active' : ''} onClick={() => setActiveConcern(name)} key={name} aria-pressed={activeConcern === name}><small>0{index + 1}</small>{name}<Arrow /></button>)}</div>
        <aside className="concern-detail"><span className="eyebrow">{current.eyebrow}</span><h3>{activeConcern}</h3><p>{current.line}</p><div className="recommendations">{current.items.map((item, i) => <span key={item}><b>0{i + 1}</b>{item}</span>)}</div><a href="/shop" className="button dark">See products <Arrow /></a></aside>
      </div>
    </section>


    <section className="product-exhibition" id="products">
      <div className="product-heading reveal"><span className="eyebrow">{home.productsKicker}</span><h2>{home.productsTitle} <em>{home.productsAccent}</em></h2><p>{home.productsText}</p><img className="product-heading-art" src={home.productArt} alt="" referrerPolicy="no-referrer" /></div>
      <div className="product-rail reveal">{products.map((product, index) => <article className={`product-slide actual-${RAIL_TONES[index % RAIL_TONES.length]}`} key={product.id} onClick={() => openProduct(product.id)}><div className="product-index">{String(index + 1).padStart(2, '0')} <span> / {String(products.length).padStart(2, '0')}</span></div><ProductVisual product={product} className="exhibition-product" /><div className="product-caption"><span>{product.brand}</span><h3>{product.name}</h3><p>{product.description}</p><div><b>{priceLabel(product)}</b>{canBuy(product) ? <button onClick={(event) => { event.stopPropagation(); add(product) }} aria-label={`Add ${product.name} to cart${cart[product.id] ? ` (${cart[product.id]} in cart)` : ''}`}><AddIcon /></button> : null}</div></div></article>)}</div>
    </section>


    <section className="real-section"><div className="real-image reveal"><img src={home.editorialImage} alt="A smiling woman with healthy skin" referrerPolicy="no-referrer" /><span>Real skin.<br />Real life.</span></div><div className="real-copy reveal"><span className="eyebrow">{home.ageKicker}</span><h2>{home.ageTitle}<br /><em>{home.ageAccent}</em></h2><p>{home.ageText}</p><div className="age-switcher">{Object.keys(ages).map(age => <button onClick={() => setActiveAge(age)} className={age === activeAge ? 'active' : ''} key={age} aria-pressed={age === activeAge}><b>{age}</b><span>{ages[age].tag}</span></button>)}</div><div className="age-result"><span className="eyebrow">Age {activeAge}</span><h3>{ages[activeAge].result}</h3><a href="/shop">See products <Arrow /></a></div></div></section>

    <section className="brand-edit" id="edit"><div className="edit-title reveal"><span className="eyebrow">{home.brandsKicker}</span><h2>{home.brandsTitle} <em>{home.brandsAccent}</em></h2><p>{home.brandsText}</p></div><div className="brand-logo-marquee reveal" aria-label="Brands we carry"><div className="brand-logo-track">{Array.from({ length: 4 }, (_, set) => home.brandLogos.map((brand) => <div className="brand-logo-mark" key={`${brand.name}-${set}`} aria-hidden={set > 0 ? true : undefined}><img src={brand.image} alt={set === 0 ? brand.name : ''} referrerPolicy="no-referrer" /></div>))}</div></div><a className="text-link reveal" href="/shop">Shop all brands <Arrow /></a></section>

    <SiteFooter />
  </main>
}
