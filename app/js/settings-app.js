// js/settings-app.js
// Settings are stored in TWO places:
//   1. localStorage("appSettings") — fast read cache, applied on every page load
//   2. Firestore companies/{companyId}/settings/config — source of truth, synced on login
//
// Flow:
//   Login → auth-share.js pulls Firestore settings → merges into localStorage
//   Settings page → user changes toggle/save → writes localStorage + Firestore

import { auth, db } from "./core/firebase.js";
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ─── Storage key ────────────────────────────────────────── */
const KEY = "appSettings";
// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}
/* ─── Helpers ───────────────────────────────────────────── */
const $  = (id) => document.getElementById(id);
const gv = (id) => $(id)?.value;
const gc = (id) => !!($(id)?.checked);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}

function saveLocal(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); }
  catch(e) { console.warn("settings-app: localStorage save failed", e); }
}

function patchLocal(partial) {
  saveLocal({ ...load(), ...partial });
}

/* ─── Firestore sync ─────────────────────────────────────── */
async function saveToFirestore(s) {
  const companyId = window.appState?.companyId;
  if (!companyId) {
    console.warn("settings-app: no companyId in appState, skipping Firestore sync");
    return;
  }
  try {
    await setDoc(
      doc(db, "companies", companyId, "settings", "config"),
      { ...s, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error("settings-app: Firestore sync failed:", err);
    throw err;
  }
}

// Saves companyName back to companies/{companyId} root doc so auth-share picks it up
async function saveCompanyName(companyName) {
  const companyId = window.appState?.companyId;
  if (!companyId || !companyName) return;
  try {
    await updateDoc(doc(db, "companies", companyId), { companyName });
  } catch (err) {
    console.warn("settings-app: companyName update failed:", err);
  }
}

// Saves mgrName (fullName) back to app_user/{uid}
async function saveMgrName(mgrName) {
  const uid = window.appState?.uid;
  if (!uid || !mgrName) return;
  try {
    await updateDoc(doc(db, "app_user", uid), { fullName: mgrName });
  } catch (err) {
    console.warn("settings-app: mgrName update failed:", err);
  }
}

/* ─── Apply settings to live UI ─────────────────────────── */
function applySettings(s) {
  // Dark mode
  const dark = !!s.darkMode;
  document.documentElement.classList.toggle("dark-mode", dark);
  document.body.classList.toggle("dark-mode", dark);
  localStorage.setItem("dark-mode", dark ? "true" : "false");
  const dmToggle = $("darkModeToggle");
  if (dmToggle) dmToggle.checked = dark;

  // Compact view
  const compact = !!s.compactView;
  document.documentElement.dataset.compact = compact ? "true" : "";
  document.body.classList.toggle("compact", compact);
  const cvToggle = $("compactViewToggle");
  if (cvToggle) cvToggle.checked = compact;

  // Accent color
  if (s.accentColor) {
    document.documentElement.style.setProperty("--accent", s.accentColor);
    document.querySelectorAll(".color-swatch").forEach(sw =>
      sw.classList.toggle("active", sw.dataset.color === s.accentColor)
    );
  }

  // Company name in header
  if (s.companyName) {
    const el = $("companyNameDisplay");
    if (el) el.textContent = s.companyName;
  }

  // Logo
  if (s.logoDataUrl) {
    applyLogo(s.logoDataUrl);
  }
}

/* ─── Populate form inputs ───────────────────────────────── */
function populateForm(s) {
  const sv = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
  const sc = (id, v) => { const el = $(id); if (el && v !== undefined) el.checked = !!v; };

  // Account
  sv("mgrName",                  s.mgrName       ?? window.appState?.displayName ?? "");
  sv("companyName",              s.companyName   ?? window.appState?.companyName ?? "");
  sv("displayUID2",              window.appState?.uid ?? "");
  sv("mgrKioskPin",              s.mgrKioskPin);
  sv("companyIndustry",          s.companyIndustry);

  // Appearance
  sc("darkModeToggle",           s.darkMode);
  sc("compactViewToggle",        s.compactView);

  // Notifications (may live on other pages but keep for completeness)
  sc("notifTickets",             s.notifTickets        ?? true);
  sc("notifCallouts",            s.notifCallouts       ?? true);
  sc("notifCoverage",            s.notifCoverage       ?? true);
  sc("notifOvertime",            s.notifOvertime       ?? true);
  sc("notifLateClockIn",         s.notifLateClockIn    ?? false);

  // Payroll
  sv("settingOvertimeThreshold", s.overtimeThreshold   ?? 40);
  sv("overtimeMultiplier",       s.overtimeMultiplier  ?? "1.5");
  sv("settingDefaultRate",       s.defaultRate         ?? "");
  sv("payPeriod",                s.payPeriod           ?? "weekly");
  sc("showPayrollEstimates",     s.showPayrollEstimates ?? true);
  sc("breaksCountAsHours",       s.breaksCountAsHours  ?? false);
  sc("roundPunches",             s.roundPunches        ?? false);

  // Time clock
  sc("requirePin",               s.requirePin          ?? true);
  sc("allowEarlyClockIn",        s.allowEarlyClockIn   ?? true);
  sv("earlyClockInWindow",       s.earlyClockInWindow  ?? 15);
  sc("autoClockOut",             s.autoClockOut        ?? false);
  sv("autoClockOutHours",        s.autoClockOutHours   ?? 12);
  sc("requireLateReason",        s.requireLateReason   ?? false);
  sc("logIpOnPunch",             s.logIpOnPunch        ?? false);

  // Scheduling
  sv("settingWeekStart",         s.weekStart           ?? "1");
  sv("settingDefaultView",       s.defaultView         ?? "week");

  // Portal
  sc("publishToPortal",          s.publishToPortal     ?? true);
  sc("notifyOnPublish",          s.notifyOnPublish     ?? true);
  sc("portalAllowSwaps",         s.portalAllowSwaps    ?? true);
  sc("portalAllowTimeOff",       s.portalAllowTimeOff  ?? true);
  sc("portalAllowCallout",       s.portalAllowCallout  ?? true);
  sc("portalShowHours",          s.portalShowHours     ?? true);
  sc("portalShowPayRate",        s.portalShowPayRate   ?? false);

  // Logo preview
  if (s.logoDataUrl) applyLogo(s.logoDataUrl);
}

/* ─── Collect form ───────────────────────────────────────── */
function collectForm() {
  const ac = document.querySelector(".color-swatch.active");
  const s = load(); // carry over fields not on this page (logo, etc.)
  return {
    ...s,
    mgrName:              gv("mgrName"),
    companyName:          gv("companyName"),
    mgrKioskPin:          gv("mgrKioskPin"),
    companyIndustry:      gv("companyIndustry"),
    darkMode:             gc("darkModeToggle"),
    compactView:          gc("compactViewToggle"),
    accentColor:          ac?.dataset?.color ?? s.accentColor,
    notifTickets:         gc("notifTickets"),
    notifCallouts:        gc("notifCallouts"),
    notifCoverage:        gc("notifCoverage"),
    notifOvertime:        gc("notifOvertime"),
    notifLateClockIn:     gc("notifLateClockIn"),
    overtimeThreshold:    +(gv("settingOvertimeThreshold") || 40),
    overtimeMultiplier:   gv("overtimeMultiplier"),
    defaultRate:          +(gv("settingDefaultRate") || 0) || undefined,
    payPeriod:            gv("payPeriod"),
    showPayrollEstimates: gc("showPayrollEstimates"),
    breaksCountAsHours:   gc("breaksCountAsHours"),
    roundPunches:         gc("roundPunches"),
    requirePin:           gc("requirePin"),
    allowEarlyClockIn:    gc("allowEarlyClockIn"),
    earlyClockInWindow:   +(gv("earlyClockInWindow") || 15),
    autoClockOut:         gc("autoClockOut"),
    autoClockOutHours:    +(gv("autoClockOutHours") || 12),
    requireLateReason:    gc("requireLateReason"),
    logIpOnPunch:         gc("logIpOnPunch"),
    weekStart:            gv("settingWeekStart"),
    defaultView:          gv("settingDefaultView"),
    publishToPortal:      gc("publishToPortal"),
    notifyOnPublish:      gc("notifyOnPublish"),
    portalAllowSwaps:     gc("portalAllowSwaps"),
    portalAllowTimeOff:   gc("portalAllowTimeOff"),
    portalAllowCallout:   gc("portalAllowCallout"),
    portalShowHours:      gc("portalShowHours"),
    portalShowPayRate:    gc("portalShowPayRate"),
  };
}

/* ─── Live toggles (instant, no Save needed) ─────────────── */
function wireLiveToggles() {
  $("darkModeToggle")?.addEventListener("change", (e) => {
    const dark = e.target.checked;
    document.documentElement.classList.toggle("dark-mode", dark);
    document.body.classList.toggle("dark-mode", dark);
    localStorage.setItem("dark-mode", dark ? "true" : "false");
    patchLocal({ darkMode: dark });
    saveToFirestore({ darkMode: dark }).catch(() => {});
  });

  $("compactViewToggle")?.addEventListener("change", (e) => {
    const compact = e.target.checked;
    document.documentElement.dataset.compact = compact ? "true" : "";
    document.body.classList.toggle("compact", compact);
    patchLocal({ compactView: compact });
    saveToFirestore({ compactView: compact }).catch(() => {});
  });
}

/* ─── Accent color ───────────────────────────────────────── */
window.setAccent = function(color, btn) {
  document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.documentElement.style.setProperty("--accent", color);
  patchLocal({ accentColor: color });
  saveToFirestore({ accentColor: color }).catch(() => {});
};

/* ─── Settings tab switcher ──────────────────────────────── */
window.setStab = function(id, btn) {
  document.querySelectorAll(".stab-section").forEach(s => s.style.display = "none");
  document.querySelectorAll(".stab").forEach(b => b.classList.remove("active"));
  const sec = document.getElementById("stab-" + id);
  if (sec) sec.style.display = "block";
  if (btn) btn.classList.add("active");
};

/* ─── Logo upload ────────────────────────────────────────── */
function applyLogo(dataUrl) {
  const preview = $("logoPreview");
  if (!preview) return;
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:6px;">`;
  const removeBtn = $("removeLogoBtn");
  if (removeBtn) removeBtn.style.display = "";
}

function wireLogo() {
  const fileInput = $("logoFileInput");
  const removeBtn = $("removeLogoBtn");

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      applyLogo(dataUrl);
      patchLocal({ logoDataUrl: dataUrl });
      // Update brand mark in header too
      const brand = $("brandMark");
      if (brand) brand.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:4px;">`;
    };
    reader.readAsDataURL(file);
  });

  removeBtn?.addEventListener("click", () => {
    const preview = $("logoPreview");
    if (preview) preview.innerHTML = "⚡";
    removeBtn.style.display = "none";
    fileInput.value = "";
    const brand = $("brandMark");
    if (brand) brand.textContent = "⚡";
    patchLocal({ logoDataUrl: null });
    saveToFirestore({ logoDataUrl: null }).catch(() => {});
  });
}

/* ─── Save All button ────────────────────────────────────── */
function wireSaveButton() {
  $("saveSettings")?.addEventListener("click", async () => {
    const btn = $("saveSettings");
    const orig = btn?.textContent;

    if (btn) { btn.textContent = "Saving..."; btn.disabled = true; }

    const s = collectForm();
    saveLocal(s);
    applySettings(s);

    // Update header company name live
    const companyNameEl = $("companyNameDisplay");
    if (companyNameEl && s.companyName) companyNameEl.textContent = s.companyName;

    try {
      // Save settings doc + update root docs for name fields
      await Promise.all([
        saveToFirestore(s),
        s.companyName ? saveCompanyName(s.companyName) : Promise.resolve(),
        s.mgrName     ? saveMgrName(s.mgrName)         : Promise.resolve(),
      ]);

      if (btn) {
        btn.textContent = "✅ Saved";
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
      }
    } catch (err) {
      if (btn) {
        btn.textContent = "⚠️ Saved locally only";
        btn.disabled = false;
        setTimeout(() => { btn.textContent = orig; }, 3000);
      }
    }
  });
}

/* ─── Boot ───────────────────────────────────────────────── */
function init() {
  const s = load();
  applySettings(s);
  populateForm(s);
  wireLiveToggles();
  wireSaveButton();
  wireLogo();
}

// Re-populate after authReady — auth-share may have just merged fresh Firestore data,
// and we now have window.appState so UID / displayName can fill in too.
window.addEventListener("authReady", () => {
  const s = load();
  populateForm(s);
  applySettings(s);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}