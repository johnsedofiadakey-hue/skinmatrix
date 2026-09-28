import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { OpsContext } from './hooks.js'
import { auth, callFunction, liveDb, readError } from './live/firebase.js'
import { can } from '../../functions/src/core/rules.js'
import { ApprovalDialog } from './components/approval.jsx'

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
  const signedInOnce = useRef(false)

  const setup = useCollectionMap('catalogOps', true)
  const stock = useCollectionMap('stock', true)
  const staffMap = useCollectionMap('staff', true)
  const costs = useCollectionMap('catalogCosts', can(me.role, 'costs'))

  useEffect(() => onSnapshot(doc(liveDb, 'site', 'catalog'), (snap) => setCatalog(Array.isArray(snap.data()?.products) ? snap.data().products : []), () => setCatalog([])), [])
  useEffect(() => onSnapshot(doc(liveDb, 'site', 'content'), (snap) => setShop(snap.data()?.shop || {}), () => {}), [])
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
      online,
      call,
      toast,
      signOut: () => signOut(auth),
    }
  }, [user, me, catalog, setup, stock, costs, staffMap, shop, online, call, toast])

  return <OpsContext.Provider value={value}>
    {children}
    {approval ? <ApprovalDialog message={approval.message} error={approval.error} approvers={value.staffList.filter((member) => member.active !== false && member.uid !== me.uid && can(member.role, 'approve'))} onDone={approval.resolve} /> : null}
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.text}</div>)}
    </div>
  </OpsContext.Provider>
}
