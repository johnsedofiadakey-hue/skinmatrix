// Firebase for both the public website and the admin. The web config is public by design:
// what protects the data is firestore.rules, not this key.
import { initializeApp } from 'firebase/app'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite'

// Local testing only (npm run dev with VITE_USE_EMULATORS=1): a throwaway demo project on the emulators.
const emulated = Boolean(import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS)

const config = {
  apiKey: 'AIzaSyAfEJVeqXLbpwasVeB2Voo5G_xAjq0oR1A',
  authDomain: 'skinmatrixgh.firebaseapp.com',
  projectId: emulated ? 'demo-skinmatrix' : 'skinmatrixgh',
  storageBucket: 'skinmatrixgh.firebasestorage.app',
  messagingSenderId: '888263966565',
  appId: '1:888263966565:web:b6674902acbce05c4fab8c',
}

export const app = initializeApp(config)
export const db = getFirestore(app)
if (emulated) connectFirestoreEmulator(db, '127.0.0.1', 8080)
