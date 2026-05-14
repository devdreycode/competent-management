// js/main.js
import { db, auth } from "./firebase.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection, addDoc, deleteDoc, onSnapshot,
  doc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
let companyId = null;
let uid = null;
let remindersUnsub = null;

/* ─────────────────────────────────────────
   AUTH READY
───────────────────────────────────────── */
window.addEventListener("authReady", (e) => {
  const { uid: u, companyId: c, displayName, companyName } = e.detail;
  uid = u;
  companyId = c;

  const nameEl    = document.getElementById("sidebarName");
  const uidEl     = document.getElementById("displayUID");
  const avatarEl  = document.getElementById("sidebarAvatar");
  const companyEl = document.getElementById("companyNameDisplay");
  const welcomeEl = document.getElementById("welcome-msg");

  if (nameEl)    nameEl.textContent    = displayName || "Manager";
  if (uidEl)     uidEl.textContent     = u ? u.slice(0, 8) + "…" : "—";
  if (avatarEl)  avatarEl.textContent  = (displayName || "M")[0].toUpperCase();
  if (companyEl) companyEl.textContent = companyName || "Company";
  if (welcomeEl) welcomeEl.textContent = `Welcome, ${displayName || "Manager"}`;

  loadReminders();
});


/* ─────────────────────────────────────────
   SEARCH / FILTER LOGS
───────────────────────────────────────── */
window.filterLogs = function(value) {
  if (typeof window._filterLogsImpl === "function") {
    window._filterLogsImpl(value);
  }
};

/* ─────────────────────────────────────────
   REMINDERS
───────────────────────────────────────── */
function loadReminders() {
  if (!companyId) return;
  if (remindersUnsub) remindersUnsub();

  const q = query(
    collection(db, "companies", companyId, "reminders"),
    orderBy("createdAt", "asc")
  );

  remindersUnsub = onSnapshot(q, (snap) => {
    const list = document.getElementById("remindersList");
    if (!list) return;

    if (snap.empty) {
      list.innerHTML = `<li style="color:var(--text-muted);font-size:.82rem;padding:8px 0;">No reminders yet.</li>`;
      return;
    }

    list.innerHTML = snap.docs.map(d => `
      <li style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:.845rem;">
        <span>${d.data().text}</span>
        <button onclick="deleteReminder('${d.id}')" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;line-height:1;">✕</button>
      </li>
    `).join("");
  });
}

window.addReminder = async function() {
  const input = document.getElementById("reminderInput");
  const text = input?.value?.trim();
  if (!text || !companyId) return;
  try {
    await addDoc(collection(db, "companies", companyId, "reminders"), {
      text,
      createdAt: serverTimestamp(),
      uid
    });
    input.value = "";
  } catch (err) {
    console.error("Add reminder failed:", err);
  }
};

window.deleteReminder = async function(id) {
  if (!companyId) return;
  try {
    await deleteDoc(doc(db, "companies", companyId, "reminders", id));
  } catch (err) {
    console.error("Delete reminder failed:", err);
  }
};

/* ─────────────────────────────────────────
   LOGOUT — handled by auth-share.js
   (removed duplicate handler here)
───────────────────────────────────────── */

/* ─────────────────────────────────────────
   UI UPDATES
───────────────────────────────────────── */
window.addEventListener("uiUpdated", (e) => {
  const { companyName, darkMode } = e.detail || {};
  if (companyName) {
    const el = document.getElementById("companyNameDisplay");
    if (el) el.textContent = companyName;
  }
  if (darkMode !== undefined) {
    document.documentElement.classList.toggle("dark-mode", darkMode);
    document.body.classList.toggle("dark-mode", darkMode);
  }
});

/* ─────────────────────────────────────────
   DARK MODE — flash-free init
───────────────────────────────────────── */
(function() {
  const dark = localStorage.getItem("dark-mode") === "true";
  document.documentElement.classList.toggle("dark-mode", dark);
  document.body.classList.toggle("dark-mode", dark);
})();