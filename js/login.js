// js/login.js
// All imports pinned to 10.7.1 — must match firebase.js exactly.

import { auth ,db } from "../app/js/core/firebase.js";
import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ─── Elements ───────────────────────────────────────────── */
const loginForm  = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const submitBtn  = loginForm?.querySelector(".submit-btn");

/* ─── Helpers ────────────────────────────────────────────── */
function showError(msg) {
  if (!loginError) return;
  loginError.textContent = msg;
  loginError.style.display = "block";
}

function clearError() {
  if (!loginError) return;
  loginError.textContent = "";
  loginError.style.display = "none";
}

/* ─── Login handler ──────────────────────────────────────── */
loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email    = loginForm.email.value.trim();
  const password = loginForm.password.value;

  const originalHTML   = submitBtn.innerHTML;
  submitBtn.disabled   = true;
  submitBtn.innerHTML  = "Signing In...";

  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    // Read role from Firestore — never trust client-side checks for routing.
    // The hardcoded email check has been removed; role is the source of truth.
    const snap = await getDoc(doc(db, "app_user", user.uid));
    const role = snap.exists() ? (snap.data().role || "user") : "user";

    if (role === "super_admin") {
      window.location.href = "admin.html";
    } else if (["owner", "manager"].includes(role)) {
      window.location.href = "/app/pages/index.html";
    } else {
      // Signed in but no dashboard access
      showError("Access denied. Manager account required.");
      submitBtn.disabled  = false;
      submitBtn.innerHTML = originalHTML;
    }

  } catch (error) {
    submitBtn.disabled  = false;
    submitBtn.innerHTML = originalHTML;

    const code = error.code;
    if (
      code === "auth/user-not-found"    ||
      code === "auth/wrong-password"    ||
      code === "auth/invalid-credential"
    ) {
      showError("Incorrect email or password.");
    } else if (code === "auth/too-many-requests") {
      showError("Too many attempts. Please try again later.");
    } else {
      showError("Login failed. Please try again.");
      // Log actual error for debugging but don't expose it to the user
      console.error("[login]", error.message);
    }
  }
});