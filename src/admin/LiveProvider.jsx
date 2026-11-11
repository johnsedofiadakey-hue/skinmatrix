import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { OpsContext } from './hooks.js'
import { auth, callFunction, liveDb, readError } from './live/firebase.js'
import { can } from '../../functions/src/core/rules.js'
import { DEFAULT_TAX } from '../../functions/src/core/tax.js'
import { ApprovalDialog } from './components/approval.jsx'
import { isConnectionProblem, readPending, readQueue, salePayload, writePending, writeQueue } from './live/offlineSales.js'
import { backupAvailable, logOffline, logRow, readUnsentCopy, saveUnsentCopy } from './till/backup.js'

const DEFAULT_SETTINGS = { tax: DEFAULT_TAX, sms: { enabled: false, senderId: 'SkinMatrix', orderPlaced: true, orderUpdates: true, saleReceipt: false } }
const SYNC_EVERY = 30000
const CLOCK_EVERY = 30 * 60 * 1000

// Everything the screens share: who is signed in, their role, and live copies of the catalogue, product
// codes, stock levels and the staff list. Every change goes through call(), which asks the server.
export function useAccount() {
  const [state, setState] = useState({ status: 'loading', user: null, me: null })
  useEffect(() => {
    let stopProfile = () => {}
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopProfile()
      if (!user) { setState({ status: 'signedOut', user: null, me: null }); return }
      stopProfile = onSnapshot(doc(liveDb, 'staff', user.uid), async (snap) => {
        if (snap.exists()) {
          const me = { uid: user.uid, ...snap.data() }
          setState({ status: me.active === false ? 'disabled' : 'ready', user, me })
          return
        }
        // Not on the staff list yet: someone already allowed to edit the website can set the shop up as owner.
        let editor = false
        try { editor = (await getDoc(doc(liveDb, 'admins', user.uid))).exists() } catch { editor = false }
        setState({ status: editor ? 'setup' : 'notStaff', user, me: null })
      }, () => setState({ status: 'notStaff', user, me: null }))
    })
    return () => { stopProfile(); stopAuth() }
  }, [])
  return state
}

function useCollectionMap(path, enabled) {
  const [map, setMap] = useState(() => new Map())
  useEffect(() => {
    if (!enabled) return undefined
    return onSnapshot(collection(liveDb, path), (snap) => setMap(new Map(snap.docs.map((item) => [item.id, { id: item.id, ...item.data() }]))), () => {})
  }, [path, enabled])
  return map
}

export function LiveProvider({ account, children }) {
  const { user, me } = account
  const [catalog, setCatalog] = useState(null)
  const [shop, setShop] = useState({})
  const [toasts, setToasts] = useState([])
  const [online, setOnline] = useState(() => navigator.onLine)
  const [approval, setApproval] = useState(null) // { message, error, resolve }
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [myShift, setMyShift] = useState(null)
  const [offlineSales, setOfflineSales] = useState(() => readQueue(me.uid))
  const syncing = useRef(false)
  const signedInOnce = useRef(false)
  // The copy on this computer's disk (desktop till app only): { available, savedAt, error, restored }
  const [backup, setBackup] = useState(() => ({ available: backupAvailable(), savedAt: null, error: null, restored: 0 }))
  const backupChain = useRef(Promise.resolve())
  // How far this computer's clock is from the real time (ms, + = ahead). Offline sales take their time from it.
  const [clockSkew, setClockSkew] = useState(0)

  const setup = useCollectionMap('catalogOps', true)
  const stock = useCollectionMap('stock', true)
  const staffMap = useCollectionMap('staff', true)
  const costs = useCollectionMap('catalogCosts', can(me.role, 'costs'))

  useEffect(() => onSnapshot(doc(liveDb, 'site', 'catalog'), (snap) => setCatalog(Array.isArray(snap.data()?.products) ? snap.data().products : []), () => setCatalog([])), [])
  useEffect(() => onSnapshot(doc(liveDb, 'site', 'content'), (snap) => setShop(snap.data()?.shop || {}), () => {}), [])
  useEffect(() => onSnapshot(doc(liveDb, 'settings', 'shop'), (snap) => {
    const data = snap.data() || {}
    setSettings({ tax: { ...DEFAULT_SETTINGS.tax, ...(data.tax || {}) }, sms: { ...DEFAULT_SETTINGS.sms, ...(data.sms || {}) } })
  }, () => {}), [])
  useEffect(() => {
    if (!me.openShiftId) { setMyShift(null); return undefined }
    return onSnapshot(doc(liveDb, 'shifts', me.openShiftId), (snap) => setMyShift(snap.exists() ? { id: snap.id, ...snap.data() } : null), () => setMyShift(null))
  }, [me.openShiftId])
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  useEffect(() => {
    if (signedInOnce.current) return
    signedInOnce.current = true
    callFunction('recordSignIn', {}).catch(() => {})
  }, [])

  const toast = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), tone === 'error' ? 7000 : 4500)
  }, [])

  // Ask the browser not to clear this site's storage when the disk is nearly full.
  useEffect(() => { navigator.storage?.persist?.().catch(() => {}) }, [])

  // The real time from the website's server (the Date header), compared with this computer's clock.
  useEffect(() => {
    if (!online) return undefined
    let stopped = false
    const check = async () => {
      try {
        const before = Date.now()
        const response = await fetch(`/admin/index.html?clock=${before}`, { method: 'HEAD', cache: 'no-store' })
        const after = Date.now()
        const server = Date.parse(response.headers.get('date') || '')
        // The header is in whole seconds, so the real time is on average half a second later.
        if (!stopped && Number.isFinite(server) && after - before < 10000) setClockSkew(Math.round((before + after) / 2 - (server + 500)))
      } catch { /* try again later */ }
    }
    check()
    const timer = setInterval(check, CLOCK_EVERY)
    return () => { stopped = true; clearInterval(timer) }
  }, [online])

  // ── Disk copy of offline sales (desktop/lib/backup.js) ──
  // Writes the current unsent sales and pending records. Runs one at a time, always with the latest list.
  const saveCopy = useCallback(async () => {
    if (!backupAvailable()) return
    try {
      const result = await saveUnsentCopy(me.uid, me.name, readQueue(me.uid), readPending(me.uid))
      const failed = result?.failed?.length ? `The second backup folder could not be written (${result.failed.map((item) => item.folder).join(', ')}). Plug it in or choose another in Till setup.` : null
      setBackup((state) => ({ ...state, savedAt: result?.savedAt || Date.now(), error: failed }))
    } catch (error) {
      setBackup((state) => ({ ...state, error: error.message || 'The backup on this computer could not be saved.' }))
    }
  }, [me.uid, me.name])
  const mirror = useCallback(() => { backupChain.current = backupChain.current.then(saveCopy) }, [saveCopy])
  const log = useCallback((rows) => {
    if (!backupAvailable() || !rows.length) return
    backupChain.current = backupChain.current.then(() => logOffline(rows).catch((error) => setBackup((state) => ({ ...state, error: error.message }))))
  }, [])

  // On start: if the app's own storage lost sales that the disk copy still has (data cleared, profile reset…),
  // put them back so they are sent. Done before any other write, so an empty list never replaces a good copy.
  useEffect(() => {
    if (!backupAvailable()) return
    backupChain.current = backupChain.current.then(async () => {
      const copy = await readUnsentCopy(me.uid).catch(() => null)
      if (copy) {
        const have = new Set(readQueue(me.uid).map((entry) => entry.requestId))
        const missing = copy.sales.filter((entry) => entry?.requestId && !have.has(entry.requestId)).map((entry) => ({ ...entry, status: 'waiting', error: null, restored: true }))
        const havePending = new Set(readPending(me.uid).map((entry) => entry?.data?.requestId))
        const missingPending = copy.pending.filter((entry) => entry?.name && entry?.data?.requestId && !havePending.has(entry.data.requestId))
        if (missing.length) {
          const next = [...readQueue(me.uid), ...missing]
          if (writeQueue(me.uid, next)) setOfflineSales(next)
          else setBackup((state) => ({ ...state, error: 'Offline sales were found in the backup but this device cannot store them. Restart the till app.' }))
        }
        if (missingPending.length) {
          const next = [...readPending(me.uid), ...missingPending]
          if (writePending(me.uid, next)) setPending(next)
        }
        if (missing.length) {
          setBackup((state) => ({ ...state, restored: missing.length }))
          toast(`${missing.length} offline sale(s) were brought back from the backup on this computer. They will be sent when the internet is on.`)
          await logOffline(missing.map((entry) => logRow('restored', entry, { cashier: me.name, note: 'brought back from the disk backup' }))).catch(() => {})
        }
      }
    }).then(saveCopy)
  }, [me.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sends one command to the server. If it needs a manager's approval, the PIN dialog opens on this screen and
  // the same command is sent again with the approval. Resolves to the result, or null if it was refused.
  const call = useCallback(async (name, data, { success, quiet } = {}) => {
    let approvalData
    let approvalMessage = ''
    for (;;) {
      try {
        const result = await callFunction(name, approvalData ? { ...data, approval: approvalData } : data)
        if (success) toast(typeof success === 'function' ? success(result) : success)
        return result
      } catch (raw) {
        const error = readError(raw)
        const pinProblem = approvalData && ['bad_pin', 'pin_locked', 'no_pin', 'bad_approval'].includes(error.code)
        if (error.code === 'approval_required' || pinProblem) {
          if (error.code === 'approval_required') approvalMessage = error.message
          const given = await new Promise((resolve) => setApproval({ message: approvalMessage, error: pinProblem ? error.message : null, resolve }))
          setApproval(null)
          if (!given) return null
          approvalData = given
          continue
        }
        if (!quiet) toast(error.message, 'error')
        if (!quiet) return null
        const failure = new Error(error.message)
        failure.code = error.code
        failure.details = error.details
        throw failure
      }
    }
  }, [toast])

  // ── Offline sales ──
  // The device's storage is the source of truth; the state just mirrors it for the screens.
  const saveQueue = useCallback((update) => {
    const next = update(readQueue(me.uid))
    const ok = writeQueue(me.uid, next)
    if (ok) setOfflineSales(next)
    if (ok) mirror()
    return ok
  }, [me.uid, mirror])

  const queueSale = useCallback((entry) => {
    const known = readQueue(me.uid).some((item) => item.requestId === entry.requestId)
    const ok = saveQueue((list) => (list.some((item) => item.requestId === entry.requestId) ? list : [...list, { ...entry, status: 'waiting', error: null }]))
    if (ok && !known) log([logRow('made', entry, { cashier: me.name })])
    return ok
  }, [me.uid, me.name, saveQueue, log])

  // Sends waiting offline sales one by one. Stops at the first connection problem; anything the server refuses
  // is kept as a problem for a manager to look at (it stays on this device until someone deals with it).
  const syncOffline = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return
    syncing.current = true
    try {
      for (const entry of readQueue(me.uid).filter((item) => item.status === 'waiting')) {
        try {
          const result = await callFunction('completeSale', salePayload(entry))
          saveQueue((list) => list.filter((item) => item.requestId !== entry.requestId))
          log([logRow('sent', entry, { cashier: me.name, saleNumber: result.sale.number })])
          toast(`Offline sale ${entry.localNumber} sent: now sale ${result.sale.number}.`)
        } catch (raw) {
          const error = readError(raw)
          if (isConnectionProblem(error.code)) break
          saveQueue((list) => list.map((item) => (item.requestId === entry.requestId ? { ...item, status: 'problem', error: error.message, code: error.code } : item)))
          log([logRow('problem', entry, { cashier: me.name, note: error.message })])
          toast(`Offline sale ${entry.localNumber} was not accepted: ${error.message}`, 'error')
        }
      }
    } finally { syncing.current = false }
  }, [me.uid, me.name, saveQueue, toast, log])

  useEffect(() => {
    if (!offlineSales.some((item) => item.status === 'waiting')) return undefined
    if (online) syncOffline()
    const timer = setInterval(syncOffline, SYNC_EVERY)
    return () => clearInterval(timer)
  }, [online, offlineSales, syncOffline])

  // A person tries a refused offline sale again (for example after receiving stock), with the approval dialog if needed.
  const retryOffline = useCallback(async (requestId) => {
    const entry = readQueue(me.uid).find((item) => item.requestId === requestId)
    if (!entry) return null
    const result = await call('completeSale', salePayload(entry), { success: (done) => `Offline sale ${entry.localNumber} sent: now sale ${done.sale.number}.` })
    if (result) {
      saveQueue((list) => list.filter((item) => item.requestId !== requestId))
      log([logRow('sent', entry, { cashier: me.name, saleNumber: result.sale.number })])
    }
    return result
  }, [call, me.uid, me.name, saveQueue, log])

  // Records that can wait for the internet (e.g. recordNoSale). Sent now if possible, otherwise kept and retried.
  const [pending, setPending] = useState(() => readPending(me.uid))
  const sendPending = useCallback(async () => {
    if (!navigator.onLine) return
    for (const entry of readPending(me.uid)) {
      try {
        await callFunction(entry.name, entry.data)
      } catch (raw) {
        const error = readError(raw)
        if (isConnectionProblem(error.code)) return
        toast(`A record made offline was not accepted: ${error.message}`, 'error')
      }
      const next = readPending(me.uid).filter((item) => item.data.requestId !== entry.data.requestId)
      writePending(me.uid, next)
      setPending(next)
      mirror()
    }
  }, [me.uid, toast, mirror])
  const queueCall = useCallback((name, data) => {
    const next = [...readPending(me.uid), { name, data, at: Date.now() }]
    writePending(me.uid, next)
    setPending(next)
    mirror()
    sendPending()
  }, [me.uid, sendPending, mirror])
  useEffect(() => {
    if (!pending.length) return undefined
    if (online) sendPending()
    const timer = setInterval(sendPending, SYNC_EVERY)
    return () => clearInterval(timer)
  }, [online, pending.length, sendPending])

  const dropOffline = useCallback((requestId) => {
    const entry = readQueue(me.uid).find((item) => item.requestId === requestId)
    const ok = saveQueue((list) => list.filter((item) => item.requestId !== requestId))
    if (ok && entry) log([logRow('removed', entry, { cashier: me.name, note: `removed from the till by ${me.name}${entry.error ? ` (${entry.error})` : ''}` })])
    return ok
  }, [me.uid, me.name, saveQueue, log])

  const value = useMemo(() => {
    const products = (catalog || []).map((product) => ({ ...product, setup: setup.get(product.id) || {}, stock: stock.get(product.id) || null, cost: costs.get(product.id)?.cost ?? null }))
    const staffList = [...staffMap.values()].map((member) => ({ uid: member.id, ...member }))
    return {
      user,
      me,
      role: me.role,
      can: (action) => can(me.role, action),
      catalogLoaded: catalog !== null,
      products,
      productById: new Map(products.map((product) => [product.id, product])),
      staffList,
      shop,
      settings,
      myShift,
      online,
      offlineSales,
      backup,
      clockSkew,
      queueSale,
      syncOffline,
      retryOffline,
      dropOffline,
      queueCall,
      call,
      toast,
      signOut: () => signOut(auth),
    }
  }, [user, me, catalog, setup, stock, costs, staffMap, shop, settings, myShift, online, offlineSales, backup, clockSkew, queueSale, syncOffline, retryOffline, dropOffline, queueCall, call, toast])

  return <OpsContext.Provider value={value}>
    {children}
    {approval ? <ApprovalDialog message={approval.message} error={approval.error} approvers={value.staffList.filter((member) => member.active !== false && member.uid !== me.uid && can(member.role, 'approve'))} onDone={approval.resolve} /> : null}
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.text}</div>)}
    </div>
  </OpsContext.Provider>
}
