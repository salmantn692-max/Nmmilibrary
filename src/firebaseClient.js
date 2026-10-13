// Firebase project configuration.
// These values come from your Firebase project settings (Project settings → General →
// Your apps → SDK setup and configuration). They are safe to expose in client code —
// real protection comes from your Firestore/Storage security rules + Authentication,
// not from hiding this config. Still, we read them from a local .env file (gitignored)
// so you don't have to hardcode them in source control.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Firebase Storage is NOT used in this app (it requires the paid Blaze plan).
// Student profile photos are instead resized small client-side and stored as
// a data URI directly on the student's own Firestore document — works on the
// free Spark plan, no billing needed.
