import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAhC8eHX90pVrP86YW9eckquizW-0ygIoA",
  authDomain: "carfleet-6ce4f.firebaseapp.com",
  projectId: "carfleet-6ce4f",
  storageBucket: "carfleet-6ce4f.firebasestorage.app",
  messagingSenderId: "269895810283",
  appId: "1:269895810283:web:727dc086b1eba8130412ae",
  measurementId: "G-2DH65DEVC9"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);