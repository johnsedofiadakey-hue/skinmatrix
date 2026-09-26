import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { OpsContext } from './hooks.js'
import { createOpsStore } from './demo/opsStore.js'
import { can, canAccessBranch, visibleBranchIds } from './lib/permissions.js'
import { ApprovalDialog, PinDialog } from './components/pin.jsx'

const SESSION_KEY = 'skinmatrix-ops-demo-session'

function safeStorage(kind) {
  try {
    const storage = window[kind]
    const probe = '__ops_probe__'
    storage.setItem(probe, probe)
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

function readSession(storage) {
  try { return JSON.parse(storage?.getItem(SESSION_KEY) || 'null') } catch { return null }
}

export function OpsProvider({ children }) {
  const [store] = useState(() => createOpsStore({ storage: safeStorage('localStorage'), latencyMs: 150 }))
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const sessionStorage = useRef(safeStorage('sessionStorage'))
  const [session, setSession] = useState(() => readSession(sessionStorage.current))
  const [toasts, setToasts] = useState([])
  const [approvalRequest, setApprovalRequest] = useState(null) // { message, resolve }
  const [switching, setSwitching] = useState(false)

  // A deactivated account loses its session immediately.
  const found = session ? state.staff.find((member) => member.id === session.staffId) : null
  const staff = found && found.active !== false ? found : null
  const branchFilter = staff && session?.branchFilter && canAccessBranch(staff, session.branchFilter) ? session.branchFilter : 'all'

  const saveSession = useCallback((next) => {
    setSession(next)
    try {
      if (next) sessionStorage.current?.setItem(SESSION_KEY, JSON.stringify(next))
      else sessionStorage.current?.removeItem(SESSION_KEY)
    } catch { /* session persistence is a convenience only */ }
  }, [])

  // Stands in for the payment provider's scheduled expiry sweep.
  useEffect(() => {
    const timer = setInterval(() => { store.sweepExpiredHolds() }, 5000)
    return () => clearInterval(timer)
  }, [store])

  const toast = useCallback((text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 4800)
  }, [])

  // Runs a store command, surfacing refusals as toasts. Resolves to the result, or null on refusal.
  // When the server answers "approval required", a manager enters their PIN on this screen and the command is sent
  // again with that approval attached; the server checks the PIN and the approver's own permission.
  const run = useCallback(async (command, success) => {
    const attempt = async (approval) => {
      const result = await command(store, approval)
      if (success) toast(typeof success === 'function' ? success(result) : success)
      return result
    }
    try {
      return await attempt(undefined)
    } catch (error) {
      if (error?.code === 'approval_required') {
        // A wrong PIN or approver asks again instead of dropping the sale; Cancel still backs out.
        for (;;) {
          const approval = await new Promise((resolve) => setApprovalRequest({ message: error.message, resolve }))
          setApprovalRequest(null)
          if (!approval) return null
          try {
            return await attempt(approval)
          } catch (retryError) {
            toast(retryError?.message || 'Something went wrong.', 'error')
            if (retryError?.code !== 'bad_pin' && retryError?.code !== 'bad_approval') return null
          }
        }
      }
      toast(error?.message || 'Something went wrong.', 'error')
      if (error?.name !== 'OpsError') console.error(error)
      return null
    }
  }, [store, toast])

  const signIn = useCallback(async (staffId, pin) => {
    try {
      const member = await store.signIn(staffId, pin)
      saveSession({ staffId: member.id, branchFilter: 'all' })
      return member
    } catch (error) {
      toast(error.message, 'error')
      return null
    }
  }, [store, saveSession, toast])

  const value = useMemo(() => {
    const branchIds = staff ? visibleBranchIds(staff, state.branches, branchFilter) : []
    return {
      state,
      store,
      staff,
      run,
      toast,
      branchFilter,
      branchIds,
      multiBranch: state.branches.length > 1,
      shopId: state.branches[0].id,
      // Whether a record belongs in the current view. Orders with no branch yet (waiting for stock) are visible to
      // managers and the owner only.
      inScope: (branchId) => (branchId ? branchIds.includes(branchId) : Boolean(staff && can(staff, 'crossBranch') && branchFilter === 'all')),
      branchName: (id) => state.branches.find((branch) => branch.id === id)?.short || 'Not assigned',
      staffName: (id) => state.staff.find((member) => member.id === id)?.name || '—',
      signIn,
      signOut: () => saveSession(null),
      switchUser: () => setSwitching(true),
      setBranchFilter: (id) => saveSession({ ...session, branchFilter: id }),
      resetDemo: () => { store.resetDemo(); toast('Demo data reset to its starting state.') },
    }
  }, [state, store, staff, run, toast, branchFilter, session, saveSession, signIn])

  return <OpsContext.Provider value={value}>
    {children}
    {approvalRequest ? <ApprovalDialog message={approvalRequest.message} staff={state.staff} currentId={staff?.id} onDone={approvalRequest.resolve} /> : null}
    {switching ? <PinDialog title="Switch user" staff={state.staff} onClose={() => setSwitching(false)} onSubmit={async (staffId, pin) => { const member = await signIn(staffId, pin); if (member) { setSwitching(false); toast(`${member.name} is now signed in.`) } }} /> : null}
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.text}</div>)}
    </div>
  </OpsContext.Provider>
}
