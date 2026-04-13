// firebase/config.js
// ⚠️ GANTI dengan konfigurasi Firebase project kamu sendiri
// Cara dapat config: Firebase Console → Project Settings → Your Apps → Web App

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB79YuBbAXWndOlxwncxGiAmT2lnxjblz0",
  authDomain: "form-produksi.firebaseapp.com",
  projectId: "form-produksi",
  storageBucket: "form-produksi.firebasestorage.app",
  messagingSenderId: "107500184910",
  appId: "1:107500184910:web:b2b0b4a485d4fed7c8aa1f",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
