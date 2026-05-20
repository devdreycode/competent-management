// js/firebase.js
// Single source of truth for Firebase SDK version — everything imports from here.
// Version pinned to 10.7.1 across ALL files. Do not import firebase-auth or
// firebase-firestore directly from gstatic anywhere else in the codebase.

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyAbiHersDtAntTb3oWqyN1zZDYW3bzwrDU",
  authDomain:        "competent-management.firebaseapp.com",
  projectId:         "competent-management",
  storageBucket:     "competent-management.firebasestorage.app",
  messagingSenderId: "984767087244",
  appId:             "1:984767087244:web:47e86734d0e402878eb1a9"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered');
    } catch (err) {
      console.error('SW failed', err);
    }
  });
}

export const auth = getAuth(app);
export const db   = getFirestore(app);