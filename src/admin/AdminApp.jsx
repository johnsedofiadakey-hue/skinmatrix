import { lazy, Suspense, useState } from 'react'
import { signOut } from 'firebase/auth'
import { LiveProvider, useAccount } from './LiveProvider.jsx'
import { useHashRoute, useNow, useOps } from './hooks.js'
import { auth, callFunction, readError } from './live/firebase.js'
import { ROLE_LABEL } from '../../functions/src/core/rules.js'
import { Dialog, Icon } from './components/ui.jsx'
import { fmtFull } from './components/format.js'
import SignIn from './views/SignIn.jsx'
import Home from './views/Home.jsx'
import Sell from './views/Sell.jsx'
import WebsiteOrders, { needsAction, useWebOrders } from './views/WebsiteOrders.jsx'

// Pages used less often load when first opened, so the till starts quickly.
const Sales = lazy(() => import('./views/Sales.jsx'))
const Drawer = lazy(() => import('./views/Drawer.jsx'))
const Stock = lazy(() => import('./views/Stock.jsx'))
const Reports = lazy(() => import('./views/Reports.jsx'))
const Setup = lazy(() => import('./views/Setup.jsx'))
const Team = lazy(() => import('./views/Team.jsx'))
const Website = lazy(() => import('./views/Website.jsx'))
const Settings = lazy(() => import('./views/Settings.jsx'))
const Account = lazy(() => import('./views/Account.jsx'))
const Help = lazy(() => import('./views/Help.jsx'))

// Every page, who may open it, and where it sits: in the phone bar at the bottom (tab) or under More.
const PAGES = [
  { path: 'home', label: 'Home', icon: 'home', tab: true },
  { path: 'sell', label: 'POS', icon: 'pos', action: 'sell', tab: true },
  { path: 'sales', label: 'POS history', short: 'History', icon: 'sale', action: 'viewSales', tab: true },
  { path: 'orders', label: 'Website orders', short: 'Web orders', icon: 'cart', action: 'webOrders', tab: true },
  { path: 'drawer', label: 'Cash drawer', icon: 'drawer', action: 'sell' },
  { path: 'stock', label: 'Stock', icon: 'inventory', action: 'viewStock' },
  { path: 'reports', label: 'Reports', icon: 'ledger', action: 'reports' },
  { path: 'setup', label: 'Products', icon: 'products', action: 'products' },
  { path: 'team', label: 'Team', icon: 'staff', action: 'staff' },
  { path: 'website', label: 'Website editor', icon: 'globe', action: 'website' },
  { path: 'settings', label: 'Settings', icon: 'settings', action: 'settings' },
  { path: 'account', label: 'Account', icon: 'user' },
  { path: 'help', label: 'Help', icon: 'help' },
]

export default function AdminApp() {
  const account = useAccount()
  if (account.status === 'loading') return <div className="ops"><main className="admin-auth-state"><span className="eyebrow">SkinMatrix</span><p>Checking your sign-in…</p></main></div>
  if (account.status === 'signedOut') return <div className="ops"><SignIn /></div>
  if (account.status === 'setup') return <div className="ops"><FirstSetup email={account.user.email} /></div>
  if (account.status === 'notStaff' || account.status === 'disabled') return <div className="ops"><NoAccess account={account} /></div>
  return <div className="ops"><LiveProvider account={account}><Shell /></LiveProvider></div>
}

function AuthPanel({ eyebrow, title, children }) {
  return <main className="signin-clean">
    <a className="signin-back" href="/">← Back to SkinMatrix</a>
    <section className="signin-panel signin-panel--clean">
      <div className="signin-brand"><span className="brand-name">SkinMatrix</span><span className="brand-sub">Shop system</span></div>
      <div className="signin-intro"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>
      {children}
    </section>
  </main>
}

function FirstSetup({ email }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const claim = async () => {
    setBusy(true); setError('')
    try { await callFunction('claimOwner', {}) } catch (cause) { setError(readError(cause).message); setBusy(false) }
  }
  return <AuthPanel eyebrow="First-time setup" title="Set up the shop.">
    <div className="stack">
      <p>You are signed in as <b>{email}</b>, a website editor. The shop has no owner yet.</p>
      <p className="muted">Press the button to become the owner. You can then add managers and staff, each with their own sign-in.</p>
      {error ? <p className="bad-text" role="alert">{error}</p> : null}
      <button type="button" className="btn primary block" disabled={busy} onClick={claim}>{busy ? 'Setting up…' : 'Set up the shop as owner'}</button>
      <button type="button" className="btn ghost block" onClick={() => signOut(auth)}>Use another account</button>
    </div>
  </AuthPanel>
}

function NoAccess({ account }) {
  const disabled = account.status === 'disabled'
  return <AuthPanel eyebrow="No access" title={disabled ? 'This account is turned off.' : 'This account is not on the team.'}>
    <div className="stack">
      <p>{disabled ? 'Ask the owner to turn your account back on.' : <>{account.user?.email} is signed in, but the owner has not added it to the team. Ask the owner to add this email in Team.</>}</p>
      <button type="button" className="btn primary block" onClick={() => signOut(auth)}>Use another account</button>
    </div>
  </AuthPanel>
}

function Shell() {
  const { can, me, online, offlineSales, signOut: leave } = useOps()
  const parts = useHashRoute()
  const now = useNow(30000)
  const [more, setMore] = useState(false)
  const orders = useWebOrders()
  const allowed = PAGES.filter((page) => !page.action || can(page.action))
  const [section = 'home', sub] = parts
  const current = PAGES.find((page) => page.path === section)
  const permitted = current && allowed.includes(current)
  const badges = { orders: (orders || []).filter(needsAction).length }
  const tabs = allowed.filter((page) => page.tab)
  const moreActive = current && !current.tab

  let page = <Missing />
  if (current && !permitted) page = <Missing text="Your role cannot open this page. Ask the owner if you need it." />
  else if (section === 'home') page = <Home />
  else if (section === 'sell') page = <Sell />
  else if (section === 'sales') page = <Sales />
  else if (section === 'orders') page = <WebsiteOrders />
  else if (section === 'drawer') page = <Drawer />
  else if (section === 'stock') page = <Stock tab={sub} />
  else if (section === 'reports') page = <Reports />
  else if (section === 'setup') page = <Setup />
  else if (section === 'team') page = <Team />
  else if (section === 'website') page = <Website />
  else if (section === 'settings') page = <Settings />
  else if (section === 'account') page = <Account />
  else if (section === 'help') page = <Help />

  return <>
    {!online ? <div className="offline-bar" role="status">No internet. You can still sell: sales are kept on this till and sent when it is back{offlineSales.length ? ` (${offlineSales.length} waiting)` : ''}. Don’t reload this page. Other changes must wait.</div> : null}
    <div className={`frame ${section === 'sell' ? 'is-sell' : ''}`}>
      <aside className="sidebar">
        <a href="#/home" className="brand-mark"><span className="brand-name">SkinMatrix</span><span className="brand-sub">Shop system</span></a>
        <nav aria-label="Main">
          {allowed.map((item) => <a key={item.path} href={`#/${item.path}`} className={section === item.path ? 'active' : ''} aria-current={section === item.path ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span className="nav-label">{item.label}</span>
            {badges[item.path] ? <span className="nav-badge" aria-label={`${badges[item.path]} new`}>{badges[item.path]}</span> : null}
          </a>)}
        </nav>
        <div className="staff-card">
          <div className="avatar" aria-hidden="true">{me.name.slice(0, 1)}</div>
          <div className="staff-meta"><b>{me.name}</b><span>{ROLE_LABEL[me.role]}</span></div>
          <button type="button" className="icon-button" onClick={leave} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <h1>{current?.label || 'Not found'}</h1>
            <p className="topbar-date">{fmtFull(now)}</p>
          </div>
          <div className="topbar-actions">
            <a className="icon-button" href="#/help" aria-label="Help"><Icon name="help" /></a>
            <a className="avatar small mobile-only" href="#/account" aria-label="My account">{me.name.slice(0, 1)}</a>
          </div>
        </header>
        <main className="page" id="main"><Suspense fallback={<p className="muted">Loading…</p>}>{page}</Suspense></main>
      </div>
    </div>
    <nav className="bottom-nav" aria-label="Main">
      {tabs.map((item) => <a key={item.path} href={`#/${item.path}`} className={section === item.path ? 'active' : ''} aria-current={section === item.path ? 'page' : undefined}>
        <span className="bottom-icon"><Icon name={item.icon} size={22} />{badges[item.path] ? <span className="nav-badge">{badges[item.path]}</span> : null}</span>
        <span>{item.short || item.label}</span>
      </a>)}
      <button type="button" className={moreActive ? 'active' : ''} onClick={() => setMore(true)}><span className="bottom-icon"><Icon name="menu" size={22} /></span><span>More</span></button>
    </nav>
    {more ? <Dialog title="More" onClose={() => setMore(false)} sheet>
      <div className="more-grid">
        {allowed.filter((item) => !item.tab).map((item) => <a key={item.path} href={`#/${item.path}`} className={section === item.path ? 'active' : ''} onClick={() => setMore(false)}><Icon name={item.icon} size={22} /><span>{item.label}</span></a>)}
      </div>
      <button type="button" className="btn ghost block" onClick={leave}><Icon name="logout" size={16} /> Sign out ({me.name})</button>
    </Dialog> : null}
  </>
}

function Missing({ text = 'This page does not exist.' }) {
  return <div className="empty large"><b>Nothing here</b><p>{text}</p><a className="btn primary" href="#/home">Go to Home</a></div>
}
