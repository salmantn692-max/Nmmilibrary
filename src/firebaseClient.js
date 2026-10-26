// Firebase setup. Values come from the VITE_FIREBASE_* variables
// (GitHub repo secrets at build time). They are safe to ship in client code;
// real protection comes from Firestore rules + sign-in.
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
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

// Keep a copy of the data on the device, so books, students and the public
// catalog still open when there is no internet. Changes made offline sync
// automatically once the connection is back.
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  firestore = getFirestore(app);
}
export const db = firestore;
export const auth = getAuth(app);

// Student photos are stored as small images on the student's own Firestore
// document, so Firebase Storage (paid Blaze plan) is not used.
