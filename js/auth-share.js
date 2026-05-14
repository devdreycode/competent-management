// js/auth-share.js
// Central auth guard for all manager dashboard pages.
// - Validates Firebase auth session
// - Reads companyId and role from Firestore (never from URL or localStorage)
// - Dispatches "authReady" with verified data
// - Syncs company settings from Firestore to localStorage on login
// - Handles logout

import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export { db, auth };

/* ─── State ─────────────────────────────────────────────── */
let dispatched = false;

/* ─── Error banner ───────────────────────────────────────── */
function showError(msg) {
  console.error("[auth-share]", msg);
  let box = document.getElementById("globalError");
  if (!box) {
    box = document.createElement("div");
    box.id = "globalError";
    Object.assign(box.style, {
      position: "fixed", top: "20px", right: "20px",
      background: "#ffebee", color: "#b71c1c",
      padding: "12px 16px", borderRadius: "10px",
      fontFamily: "sans-serif", zIndex: "9999",
      boxShadow: "0 4px 12px rgba(0,0,0,.2)"
    });
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 4000);
}

/* ─── Settings sync ──────────────────────────────────────── */
// Pull company settings from Firestore and merge into localStorage.
// localStorage is still used as the fast read cache — Firestore is truth.
async function syncSettingsFromFirestore(companyId) {
  try {
    const snap = await getDoc(
      doc(db, "companies", companyId, "settings", "config")
    );
    if (snap.exists()) {
      const remote = snap.data();
      // Merge remote over any local values so Firestore always wins
      const local = JSON.parse(localStorage.getItem("appSettings") || "{}");
      localStorage.setItem("appSettings", JSON.stringify({ ...local, ...remote }));
    }
  } catch (err) {
    // Non-fatal — app still works with local settings
    console.warn("[auth-share] settings sync failed:", err);
  }
}

/* ─── Logout ─────────────────────────────────────────────── */
function bindLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "true";
  btn.addEventListener("click", async () => {
    try {
      // Clear sensitive cached data on logout
      localStorage.removeItem("uid");
      localStorage.removeItem("companyId");
      await signOut(auth);
      window.location.href = "login.html";
    } catch (err) {
      console.error("Logout failed:", err);
      showError("Logout failed. Try again.");
    }
  });
}

document.addEventListener("DOMContentLoaded", bindLogout);

/* ─── Auth guard ─────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  if (dispatched) return;

  try {
    const uid = user.uid;

    // ALWAYS read companyId and role from Firestore — never from URL or localStorage.
    // This is the security boundary: client cannot spoof their company.
    const snap = await getDoc(doc(db, "app_user", uid));

    if (!snap.exists()) {
      showError("User profile not found. Contact your administrator.");
      await signOut(auth);
      return;
    }

    const data       = snap.data() || {};
    const companyId  = data.companyId || data.company_id || null;
    const role       = data.role  || "user";
    const tier       = data.tier  || "free";

    if (!companyId) {
      showError("No company assigned to this account.");
      await signOut(auth);
      return;
    }

    // Role guard — only owner/manager can access the dashboard
    if (!["owner", "manager"].includes(role)) {
      showError("Access denied. Manager account required.");
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    const displayName = data.fullName || user.email?.split("@")[0] || "Manager";
    const companyName = data.companyName || data.company_name || "";

    // Cache uid only — companyId intentionally NOT written to localStorage
    // so it cannot be tampered with. All reads go through auth state.
    localStorage.setItem("uid", uid);

    // Expose on window for modules that need it (companyId comes from auth, not storage)
    window.appState = { uid, companyId, displayName, companyName, tier, role };

    // Sync Firestore settings down before dispatching authReady
    await syncSettingsFromFirestore(companyId);

    dispatched = true;

    window.dispatchEvent(new CustomEvent("authReady", {
      detail: { uid, companyId, displayName, companyName, tier, role }
    }));

    console.log("🔥 authReady dispatched", { uid, companyId, role });

  } catch (err) {
    console.error("[auth-share] failed:", err);
    showError("Authentication failed. Please refresh.");
  }
});