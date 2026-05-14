// admin.js

// FIREBASE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const firebaseConfig = {
  apiKey: "AIzaSyAbiHersDtAntTb3oWqyN1zZDYW3bzwrDU",
  authDomain: "competent-management.firebaseapp.com",
  projectId: "competent-management",
  storageBucket: "competent-management.firebasestorage.app",
  messagingSenderId: "984767087244",
  appId: "1:984767087244:web:47e86734d0e402878eb1a9"
};

// INIT FIREBASE
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);


// YOUR OWNER EMAIL
const ownerEmail = "Audreywilliams07110909@gmail.com";


// AUTH CHECK
onAuthStateChanged(auth, (user) => {

  if(!user){

    window.location.href = "login.html";
    return;

  }

  // BLOCK NON ADMINS
  if(user.email !== ownerEmail){

    alert("Access Denied");

    window.location.href = "dashboard.html";

    return;

  }

  console.log("Owner Access Granted");

});


// LOGOUT
document.getElementById("logoutBtn")
.addEventListener("click", async () => {

  await signOut(auth);

  window.location.href = "login.html";

});