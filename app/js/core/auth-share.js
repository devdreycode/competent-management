// js/auth-share.js
// Central auth guard for all manager dashboard pages.
// - Validates Firebase auth session
// - Reads companyId and role from Firestore (never from URL or localStorage)
// - Dispatches "authReady" with verified data
// - Syncs company settings from Firestore to localStorage on login
// - Handles logout

import { auth, db } from "/app/js/core/firebase.js";
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


function showTrialBanner(daysLeft) {
  const banner = document.createElement("div");
  banner.id = "trialBanner";
  banner.style.cssText = `
    position: 0; top: 0; left: 0; right: 0; z-index: 9999;
    background: #466fd1; color: white; text-align: center;
    padding: 10px 16px; font-size: .85rem; font-family: 'DM Sans', sans-serif;
    height: 40px; display: flex; align-items: center; justify-content: center;
  `;
  banner.innerHTML = `
    ⏳ <strong>${daysLeft} day${daysLeft !== 1 ? "s" : ""} left </strong>  on your free trial.
    <a href="/pricing.html" style="color:#7eb4f8; margin-left:8px; font-weight:700;">Upgrade →</a>
  `;
  document.body.prepend(banner);

  // Push the sticky header down so it clears the banner
  const topHeader = document.querySelector(".top-header");
  if (topHeader) topHeader.style.top = "40px";
}
/* ─── Settings sync ──────────────────────────────────────── */
async function syncSettingsFromFirestore(companyId) {
  try {
    const snap = await getDoc(
      doc(db, "companies", companyId, "settings", "config")
    );
    if (snap.exists()) {
      const remote = snap.data();
      const local = JSON.parse(localStorage.getItem("appSettings") || "{}");
      localStorage.setItem("appSettings", JSON.stringify({ ...local, ...remote }));
    }
  } catch (err) {
    console.warn("[auth-share] settings sync failed:", err);
  }
}

/* ─── Logout ─────────────────────────────────────────────── */
async function bindLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn || btn.dataset.bound) return;

  btn.dataset.bound = "true";

  btn.addEventListener("click", async () => {
    try {
      localStorage.removeItem("uid");
      localStorage.removeItem("companyId");
      await signOut(auth);
      window.location.href = "../../login.html";
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

    const snap = await getDoc(doc(db, "app_user", uid));

    if (!snap.exists()) {
      showError("User profile not found. Contact your administrator.");
      await signOut(auth);
      return;
    }

    const data        = snap.data() || {};
    const companyId   = data.companyId || data.company_id || null;
    const role        = data.role  || "user";
    const tier        = data.tier  || "free";
    const trialEndsAt = data.trialEndsAt || null;

    if (!companyId) {
      showError("No company assigned to this account.");
      await signOut(auth);
      return;
    }

    if (!["owner", "manager"].includes(role)) {
      showError("Access denied. Manager account required.");
      await signOut(auth);
      window.location.href = "login.html";
      return;
    }

    const displayName = data.fullName || user.email?.split("@")[0] || "";
    const companyName = data.companyName || data.company_name || "";
    localStorage.setItem("uid", uid);

    window.appState = { uid, companyId, displayName, companyName, tier, role };

    await syncSettingsFromFirestore(companyId);

    // Show trial banner if on free tier and trial is active
    if (tier === "free" && trialEndsAt) {
      const trialEnd = trialEndsAt.toDate ? trialEndsAt.toDate() : new Date(trialEndsAt);
      const daysLeft = Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft > 0) {
        showTrialBanner(daysLeft);
      }
    }

    dispatched = true;

    window.dispatchEvent(new CustomEvent("authReady", {
      detail: {
        role,
        companyId,
        tier,
        trialEndsAt: trialEndsAt || null
      }
    }));

    console.log("🔥 authReady dispatched", { uid, companyId, role, tier });

  } catch (err) {
    console.error("[auth-share] failed:", err);
    showError("Authentication failed. Please refresh.");
  }
});