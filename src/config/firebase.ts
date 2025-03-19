import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCkN3rezqlDnqrlA0wRw5owiD5zZl8b2Lw",
  authDomain: "wordle-ermadi.firebaseapp.com",
  projectId: "wordle-ermadi",
  storageBucket: "wordle-ermadi.firebasestorage.app",
  messagingSenderId: "184540601852",
  appId: "1:184540601852:web:9956d7cd45319159a3e679"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app); 