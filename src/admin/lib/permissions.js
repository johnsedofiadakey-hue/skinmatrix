// Role capabilities. In production these come from verified Firebase Auth custom claims and are
// enforced by the server on every command; the UI uses the same table only to hide what a role cannot do.
//
// Staff run the till and the order queue. Anything that gives money back, lowers a price beyond the staff limit or
// changes stock needs a manager or the owner — either signed in themselves, or approving on the spot with their PIN.

const STAFF = {
  label: 'Staff',
  crossBranch: false,
  pos: true,
  viewOrders: true,
  progressOrders: true,
  cancelOpenOrders: false,
  voidSales: false,
  correctPosSales: false,
  returns: false,
  discountLimitPct: 10,
  approve: false,
  viewInventory: true,
  countStock: false,
  adjustStock: false,
  receiveDeliveries: false,
  viewLedger: false,
  viewCosts: false,
  viewAudit: false,
  viewPayments: false,
  resolveExceptions: false,
  viewCustomers: false,
  customerLookup: true,
  manageCatalog: false,
  manageStaff: false,
}

export const ROLES = {
  staff: STAFF,
  manager: {
    ...STAFF,
    label: 'Manager',
    crossBranch: true,
    cancelOpenOrders: true,
    voidSales: 'same_day',
    correctPosSales: 'same_day',
    returns: true,
    discountLimitPct: 100,
    approve: true,
    countStock: true,
    adjustStock: true,
    receiveDeliveries: true,
    viewLedger: true,
    viewCosts: true,
    viewAudit: true,
    viewPayments: true,
    resolveExceptions: true,
    viewCustomers: true,
  },
  owner: {
    ...STAFF,
    label: 'Owner',
    crossBranch: true,
    cancelOpenOrders: true,
    voidSales: 'any',
    correctPosSales: 'any',
    returns: true,
    discountLimitPct: 100,
    approve: true,
    countStock: true,
    adjustStock: true,
    receiveDeliveries: true,
    viewLedger: true,
    viewCosts: true,
    viewAudit: true,
    viewPayments: true,
    resolveExceptions: true,
    viewCustomers: true,
    manageCatalog: true,
    manageStaff: true,
  },
}

export const ROLE_ORDER = ['staff', 'manager', 'owner']

export function capability(staff, name) {
  return ROLES[staff?.role]?.[name] ?? false
}

export function can(staff, name) {
  return Boolean(capability(staff, name))
}

export function canAccessBranch(staff, branchId) {
  if (!staff || !branchId) return false
  return can(staff, 'crossBranch') || staff.branchId === branchId
}

// Branch ids a staff member may see. `selected` is the branch picker value ('all' or an id).
export function visibleBranchIds(staff, branches, selected = 'all') {
  if (!can(staff, 'crossBranch')) return [staff.branchId]
  if (selected && selected !== 'all') return [selected]
  return branches.map((branch) => branch.id)
}
