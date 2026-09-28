// SkinMatrix Cloud Functions: the trusted server behind the admin and the website checkout. Each staff callable
// checks the signed-in user's staff profile and runs its change in a Firestore transaction (see src/handlers.js).
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { setGlobalOptions } from 'firebase-functions/v2'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import * as handlers from './src/handlers.js'
import * as shifts from './src/shifts.js'
import * as settings from './src/settings.js'
import * as web from './src/web.js'
import { RuleError } from './src/core/rules.js'

initializeApp()
const db = getFirestore()
const auth = getAuth()

// Set with `firebase functions:secrets:set PAYSTACK_SECRET_KEY` (and ARKESEL_API_KEY for SMS). Never in the code.
const PAYSTACK_SECRET = defineSecret('PAYSTACK_SECRET_KEY')
const SMS_KEY = defineSecret('ARKESEL_API_KEY')
const SECRETS = [PAYSTACK_SECRET, SMS_KEY]
const readSecrets = () => ({ paystack: PAYSTACK_SECRET.value() || '', smsKey: SMS_KEY.value() || '' })

// Same region as Firestore. A few instances at most is plenty for one shop and keeps costs near zero.
setGlobalOptions({ region: 'europe-west2', maxInstances: 5, memory: '256MiB' })

const RULE_TO_HTTPS = {
  unauthenticated: 'unauthenticated',
  not_staff: 'permission-denied',
  account_disabled: 'permission-denied',
  forbidden: 'permission-denied',
  not_found: 'not-found',
}

function callable(module, name) {
  // Callables must be reachable by any browser; each handler checks who is calling itself.
  return onCall({ cors: true, invoker: 'public', secrets: SECRETS }, async (request) => {
    const context = { db, auth, uid: request.auth?.uid || null, email: request.auth?.token?.email || null, now: Date.now(), secrets: readSecrets() }
    try {
      return await module[name](context, request.data || {})
    } catch (error) {
      if (error instanceof RuleError || error?.name === 'RuleError') {
        throw new HttpsError(RULE_TO_HTTPS[error.code] || 'failed-precondition', error.message, { code: error.code, ...(error.details || {}) })
      }
      logger.error(`${name} failed`, error)
      throw new HttpsError('internal', 'Something went wrong on the server. Please try again.')
    }
  })
}

export const completeSale = callable(handlers, 'completeSale')
export const voidSale = callable(handlers, 'voidSale')
export const returnItems = callable(handlers, 'returnItems')
export const updateWebOrder = callable(handlers, 'updateWebOrder')
export const receiveDelivery = callable(handlers, 'receiveDelivery')
export const adjustStock = callable(handlers, 'adjustStock')
export const writeOffExpired = callable(handlers, 'writeOffExpired')
export const submitStockCount = callable(handlers, 'submitStockCount')
export const saveProductSetup = callable(handlers, 'saveProductSetup')
export const saveSupplier = callable(handlers, 'saveSupplier')
export const claimOwner = callable(handlers, 'claimOwner')
export const createStaff = callable(handlers, 'createStaff')
export const updateStaff = callable(handlers, 'updateStaff')
export const setMyPin = callable(handlers, 'setMyPin')
export const recordSignIn = callable(handlers, 'recordSignIn')

export const openShift = callable(shifts, 'openShift')
export const cashMovement = callable(shifts, 'cashMovement')
export const closeShift = callable(shifts, 'closeShift')
export const saveShopSettings = callable(settings, 'saveShopSettings')

// Website checkout (no sign-in).
export const placeWebOrder = callable(web, 'placeWebOrder')
export const verifyWebPayment = callable(web, 'verifyWebPayment')

// Paystack → Settings → API Keys & Webhooks → Webhook URL:
// https://europe-west2-skinmatrixgh.cloudfunctions.net/paystackWebhook
export const paystackWebhook = onRequest({ invoker: 'public', secrets: [PAYSTACK_SECRET, SMS_KEY] }, async (request, response) => {
  if (request.method !== 'POST') { response.status(405).send('POST only'); return }
  try {
    const status = await web.handlePaystackWebhook({ db, now: Date.now(), secrets: readSecrets() }, { rawBody: request.rawBody, signature: request.get('x-paystack-signature') })
    response.status(status).send(status === 200 ? 'ok' : 'refused')
  } catch (error) {
    logger.error('paystackWebhook failed', error)
    response.status(500).send('error')
  }
})
