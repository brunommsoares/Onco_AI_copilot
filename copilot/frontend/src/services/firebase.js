// src/services/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCvrPUTeEqWA41n016H2hhbSMU4IJ8Njfg",
  authDomain: "silvercancer-38551.firebaseapp.com",
  projectId: "silvercancer-38551",
  storageBucket: "silvercancer-38551.appspot.app",
  messagingSenderId: "333640994115",
  appId: "1:333640994115:web:535429d0aaf0be974bf3f6"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const dbSilver = getFirestore(app, "silver");
const dbConversations = getFirestore(app, "silver"); // Use silver database (same as users)

export { auth, dbSilver, dbConversations }