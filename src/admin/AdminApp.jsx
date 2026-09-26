import { useState } from 'react'
import { OpsProvider } from './OpsContext.jsx'
import { useHashRoute, useNow, useOps } from './hooks.js'
import { can } from './lib/permissions.js'
import { orderAttention } from './lib/attention.js'
import { expiryStatus } from './lib/stock.js'
import { Dialog, Icon } from './components/ui.jsx'
import { fmtFull, ROLE_LABEL } from './components/format.js'
import SignIn from './views/SignIn.jsx'
import Overview from './views/Overview.jsx'
import Pos from './views/Pos.jsx'
import Orders from './views/Orders.jsx'
import OrderDetail from './views/OrderDetail.jsx'
import Inventory from './views/Inventory.jsx'
import Payments from './views/Payments.jsx'
import Ledger from './views/Ledger.jsx'
import Audit from './views/Audit.jsx'
import Customers from './views/Customers.jsx'
import Products from './views/Products.jsx'
import Deliveries from './views/Deliveries.jsx'
import Staff from './views/Staff.jsx'

const NAV = [
  { path: 'overview', label: 'Overview', icon: 'overview', allowed: () => true },
  { path: 'pos', label: 'Point of sale', icon: 'pos', allowed: (staff) => can(staff, 'pos') },
  { path: 'orders', label: 'Orders', icon: 'orders', allowed: (staff) => can(staff, 'viewOrders') },
  { path: 'inventory', label: 'Stock', icon: 'inventory', allowed: (staff) => can(staff, 'viewInventory') },
  { path: 'customers', label: 'Customers', icon: 'customers', allowed: (staff) => can(staff, 'viewCustomers') },
  { path: 'products', label: 'Products', icon: 'products', allowed: (staff) => can(staff, 'manageCatalog') || can(staff, 'viewCosts') },
  { path: 'deliveries', label: 'Deliveries', icon: 'delivery', allowed: (staff) => can(staff, 'receiveDeliveries') },
  { path: 'payments', label: 'Payments', icon: 'payments', allowed: (staff) => can(staff, 'viewPayments') },
  { path: 'ledger', label: 'Sales', icon: 'ledger', allowed: (staff) => can(staff, 'viewLedger') },
  { path: 'staff', label: 'Staff', icon: 'staff', allowed: (staff) => can(staff, 'manageStaff') },
  { path: 'audit', label: 'Audit log', icon: 'audit', allowed: (staff) => can(staff, 'viewAudit') },
]

export default function AdminApp() {
  return <OpsProvider><Shell /></OpsProvider>
}

function DemoBanner() {
  const { resetDemo, staff } = useOps()
  const [confirming, setConfirming] = useState(false)
  return <div className="demo-banner" role="note">
    <span className="demo-flag">Demo prototype</span>
    <span className="demo-text">Local sample data stored in this browser only. No real payments, stock, orders or staff accounts.</span>
    {staff ? confirming
      ? <span className="demo-confirm">Discard all demo changes? <button type="button" onClick={() => { resetDemo(); setConfirming(false) }}>Reset</button><button type="button" onClick={() => setConfirming(false)}>Cancel</button></span>
      : <button type="button" className="demo-reset" onClick={() => setConfirming(true)}><Icon name="reset" size={14} />Reset demo data</button>
      : null}
  </div>
}

function Shell() {
  const { staff, state, branchIds, inScope } = useOps()
  const parts = useHashRoute()
  const now = useNow(30000)
  const [navOpen, setNavOpen] = useState(false)

  if (!staff) return <div className="ops"><DemoBanner /><SignIn /></div>

  const allowedNav = NAV.filter((item) => item.allowed(staff))
  const [section = 'overview', id] = parts
  const current = NAV.find((item) => item.path === section)
  const permitted = current ? current.allowed(staff) : false

  const scopedOrders = state.orders.filter((order) => inScope(order.branchId))
  const badges = {
    orders: scopedOrders.filter((order) => orderAttention(order, now)).length,
    payments: state.exceptions.filter((exception) => exception.status === 'open' && inScope(exception.branchId)).length,
    inventory: can(staff, 'adjustStock') ? state.batches.filter((batch) => branchIds.includes(batch.branchId) && batch.quantity > 0 && expiryStatus(batch.expiresOn, now) === 'expired').length : 0,
  }

  let page = null
  if (!current) page = <NotFound />
  else if (!permitted) page = <NotAllowed />
  else if (section === 'overview') page = <Overview />
  else if (section === 'pos') page = <Pos />
  else if (section === 'orders') page = id ? <OrderDetail orderId={decodeURIComponent(id)} /> : <Orders />
  else if (section === 'inventory') page = <Inventory tab={id} />
  else if (section === 'customers') page = <Customers customerKey={id} />
  else if (section === 'products') page = <Products />
  else if (section === 'deliveries') page = <Deliveries />
  else if (section === 'payments') page = <Payments />
  else if (section === 'ledger') page = <Ledger />
  else if (section === 'staff') page = <Staff />
  else if (section === 'audit') page = <Audit />

  return <div className="ops">
    <DemoBanner />
    <div className={`frame ${section === 'pos' ? 'is-pos' : ''}`}>
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand-row">
          <a href="#/overview" className="brand-mark" onClick={() => setNavOpen(false)}>
            <span className="brand-name">SkinMatrix</span>
            <span className="brand-sub">Shop operations</span>
          </a>
          <button type="button" className="icon-button nav-toggle" aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} onClick={() => setNavOpen((open) => !open)}><Icon name={navOpen ? 'close' : 'menu'} /></button>
        </div>
        <nav aria-label="Operations">
          {allowedNav.map((item) => <a key={item.path} href={`#/${item.path}`} className={section === item.path ? 'active' : ''} aria-current={section === item.path ? 'page' : undefined} onClick={() => setNavOpen(false)}>
            <Icon name={item.icon} />
            <span className="nav-label">{item.label}</span>
            {badges[item.path] ? <span className="nav-badge" aria-label={`${badges[item.path]} need attention`}>{badges[item.path]}</span> : null}
          </a>)}
        </nav>
        <StaffCard />
      </aside>
      <div className="workspace">
        <TopBar title={current?.label || 'Not found'} />
        <main className="page" id="main">{page}</main>
      </div>
    </div>
  </div>
}

function TopBar({ title }) {
  const { staff, state, branchFilter, setBranchFilter, multiBranch } = useOps()
  const now = useNow(30000)
  return <header className="topbar">
    <div>
      <h1>{title}</h1>
      <p className="topbar-date">{fmtFull(now)} · Ghana time</p>
    </div>
    {multiBranch ? <div className="context">
      {can(staff, 'crossBranch')
        ? <label className="branch-select">
          <span>Branch view</span>
          <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value="all">All branches</option>
            {state.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        : <div className="branch-fixed"><span>Branch</span><b>{state.branches.find((branch) => branch.id === staff.branchId)?.short}</b><Icon name="lock" size={13} /></div>}
    </div> : <div className="shop-chip">{state.branches[0].name}</div>}
  </header>
}

function StaffCard() {
  const { staff, signOut, switchUser } = useOps()
  const [changingPin, setChangingPin] = useState(false)
  return <div className="staff-card">
    <div className="avatar" aria-hidden="true">{staff.name.slice(0, 1)}</div>
    <div className="staff-meta">
      <b>{staff.name}</b>
      <span>{ROLE_LABEL[staff.role]}</span>
      <span className="staff-links"><button type="button" onClick={switchUser}>Switch user</button> · <button type="button" onClick={() => setChangingPin(true)}>My PIN</button></span>
    </div>
    <button type="button" className="icon-button" onClick={signOut} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
    {changingPin ? <ChangePinDialog onClose={() => setChangingPin(false)} /> : null}
  </div>
}

function ChangePinDialog({ onClose }) {
  const { staff, run } = useOps()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const valid = /^\d{4,6}$/.test(pin) && pin === confirm
  const submit = async (event) => {
    event.preventDefault()
    if (!valid) return
    if (await run((store) => store.setStaffPin(staff, { staffId: staff.id, pin }), 'Your PIN was changed.')) onClose()
  }
  return <Dialog title="Change my PIN" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="field-row">
        <label className="field"><span>New PIN (4–6 digits)</span><input data-autofocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label className="field"><span>Repeat PIN</span><input type="password" inputMode="numeric" value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
      </div>
      {confirm && pin !== confirm ? <p className="bad-text small">The two PINs don't match.</p> : null}
      <div className="row end"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!valid}>Save PIN</button></div>
    </form>
  </Dialog>
}

function NotAllowed() {
  return <div className="empty large"><b>Not available for your role</b><p>Ask the owner if you need access to this area.</p><a className="btn primary" href="#/overview">Back to overview</a></div>
}

function NotFound() {
  return <div className="empty large"><b>Page not found</b><a className="btn primary" href="#/overview">Back to overview</a></div>
}
