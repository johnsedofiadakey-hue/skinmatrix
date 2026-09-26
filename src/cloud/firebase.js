// Firebase for both the public website and the admin. The web config is public by design:
// what protects the data is firestore.rules, not this key.
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore/lite'

const config = {
  apiKey: 'AIzaSyAfEJVeqXLbpwasVeB2Voo5G_xAjq0oR1A',
  authDomain: 'skinmatrixgh.firebaseapp.com',
  projectId: 'skinmatrixgh',
  storageBucket: 'skinmatrixgh.firebasestorage.app',
  messagingSenderId: '888263966565',
  appId: '1:888263966565:web:b6674902acbce05c4fab8c',
}

export const app = initializeApp(config)
export const db = getFirestore(app)
