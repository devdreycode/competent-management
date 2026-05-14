/**
 * certifications.js
 * Manages the master certification list for a company.
 * Reads/writes to: companies/{companyId}/schedule_settings/config → masterCerts[]
 */

import { auth, db } from "./firebase.js";
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* ─── State ─────────────────────────────────────────────────────────────── */
let companyId = null;

/* ─── DOM refs (safe — elements may not exist on every page) ─────────────── */
const certInput  = document.getElementById("newCertInput");
const addCertBtn = document.getElementById("addCertBtn");
const certList   = document.getElementById("masterCertList");

/* ─── Auth: wait for companyId before doing anything ────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // other modules handle the redirect

  try {
    const snap = await getDoc(doc(db, "app_user", user.uid));
    if (!snap.exists()) return;

    companyId = snap.data()?.companyId;
    if (!companyId) return;

    // Initial load — show any existing certs right away
    await loadMasterCerts();
  } catch (err) {
    console.error("certifications.js — auth setup failed:", err);
  }
});

/* ─── Add cert ───────────────────────────────────────────────────────────── */
addCertBtn?.addEventListener("click", async () => {
  const name = certInput?.value?.trim();
  if (!name) return;

  if (!companyId) {
    alert("Still loading — please wait a moment and try again.");
    return;
  }

  const configRef = doc(db, "companies", companyId, "schedule_settings", "config");

  try {
    await updateDoc(configRef, {
      masterCerts: arrayUnion(name),
      updatedAt:   serverTimestamp()
    });

    certInput.value = "";
    await loadMasterCerts();
    showToast(`✅ "${name}" added to certifications.`);
  } catch (err) {
    console.error("Error adding certification:", err);
    alert("Failed to add certification. Check console for details.");
  }
});

/* Allow pressing Enter in the input field to add */
certInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCertBtn?.click();
});

/* ─── Load & render list ─────────────────────────────────────────────────── */
async function loadMasterCerts() {
  if (!certList || !companyId) return;

  certList.innerHTML = `<li style="color:var(--text-muted,#6b7280);font-size:.85rem;padding:8px 0;">Loading…</li>`;

  try {
    const configRef = doc(db, "companies", companyId, "schedule_settings", "config");
    const snap = await getDoc(configRef);

    certList.innerHTML = "";

    const certs = snap.exists() ? (snap.data().masterCerts || []) : [];

    if (certs.length === 0) {
      certList.innerHTML = `<li style="color:var(--text-muted,#6b7280);font-size:.85rem;padding:8px 0;">No certifications added yet.</li>`;
      return;
    }

    certs.forEach((cert) => {
      const li = document.createElement("li");
      li.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        color: var(--text, #f1f5f9);
        font-size: .875rem;
      `;

      const label = document.createElement("span");
      label.textContent = cert;

      const del = document.createElement("button");
      del.textContent = "🗑";
      del.title = `Remove "${cert}"`;
      del.style.cssText = `
        background: none;
        border: none;
        cursor: pointer;
        color: var(--red, #dc2626);
        font-size: 1rem;
        padding: 0 4px;
        line-height: 1;
        opacity: .7;
        transition: opacity .15s;
      `;
      del.onmouseenter = () => (del.style.opacity = "1");
      del.onmouseleave = () => (del.style.opacity = ".7");
      del.onclick      = () => deleteCert(cert);

      li.appendChild(label);
      li.appendChild(del);
      certList.appendChild(li);
    });
  } catch (err) {
    console.error("Error loading certifications:", err);
    certList.innerHTML = `<li style="color:#ef4444;font-size:.85rem;padding:8px 0;">Failed to load certifications.</li>`;
  }
}

/* ─── Delete cert ────────────────────────────────────────────────────────── */
async function deleteCert(name) {
  if (!confirm(`Remove "${name}" from company certifications?`)) return;

  const configRef = doc(db, "companies", companyId, "schedule_settings", "config");

  try {
    await updateDoc(configRef, {
      masterCerts: arrayRemove(name),
      updatedAt:   serverTimestamp()
    });

    await loadMasterCerts();
    showToast(`🗑 "${name}" removed.`);
  } catch (err) {
    console.error("Error deleting certification:", err);
    alert("Failed to remove certification.");
  }
}

/* ─── Toast helper (lightweight, no dependencies) ───────────────────────── */
function showToast(msg, duration = 2800) {
  // Reuse existing toast if the page already has one
  let toast = document.getElementById("_certToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "_certToast";
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: #f1f5f9;
      padding: 10px 18px;
      border-radius: 10px;
      font-size: .85rem;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,.4);
      z-index: 9999;
      transition: opacity .25s;
      opacity: 0;
      pointer-events: none;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.style.opacity = "1";

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = "0";
  }, duration);
}