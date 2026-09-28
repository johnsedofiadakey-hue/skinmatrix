// SkinMatrix Cloud Functions: the trusted server behind the admin. Each callable checks the signed-in user's
// staff profile and runs its change in a Firestore transaction (see src/handlers.js).
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import * as handlers from './src/handlers.js'
import { RuleError } from './src/core/rules.js'

initializeApp()
const db = getFirestore()
const auth = getAuth()

// Same region as Firestore. One instance at a time is plenty for one shop and keeps costs near zero.
setGlobalOptions({ region: 'europe-west2', maxInstances: 5, memory: '256MiB' })

const RULE_TO_HTTPS = {
  unauthenticated: 'unauthenticated',
  not_staff: 'permission-denied',
  account_disabled: 'permission-denied',
  forbidden: 'permission-denied',
  not_found: 'not-found',
}

function callable(name) {
  // Callables must be reachable by any browser; each handler checks the caller's staff account itself.
  return onCall({ cors: true, invoker: 'public' }, async (request) => {
    const context = { db, auth, uid: request.auth?.uid || null, email: request.auth?.token?.email || null, now: Date.now() }
    try {
      return await handlers[name](context, request.data || {})
    } catch (error) {
      if (error instanceof RuleError || error?.name === 'RuleError') {
        throw new HttpsError(RULE_TO_HTTPS[error.code] || 'failed-precondition', error.message, { code: error.code, ...(error.details || {}) })
      }
      logger.error(`${name} failed`, error)
      throw new HttpsError('internal', 'Something went wrong on the server. Please try again.')
    }
  })
}

export const completeSale = callable('completeSale')
export const voidSale = callable('voidSale')
export const returnItems = callable('returnItems')
export const updateWebOrder = callable('updateWebOrder')
export const receiveDelivery = callable('receiveDelivery')
export const adjustStock = callable('adjustStock')
export const writeOffExpired = callable('writeOffExpired')
export const submitStockCount = callable('submitStockCount')
export const saveProductSetup = callable('saveProductSetup')
export const saveSupplier = callable('saveSupplier')
export const claimOwner = callable('claimOwner')
export const createStaff = callable('createStaff')
export const updateStaff = callable('updateStaff')
export const setMyPin = callable('setMyPin')
export const recordSignIn = callable('recordSignIn')
