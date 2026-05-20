import { auth, db } from "./core/firebase.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}
/* ─── Helpers ────────────────────────────────────────────── */
const KEY = "appSettings";
const $   = (id) => document.getElementById(id);
const gv  = (id) => $(id)?.value;
const gc  = (id) => !!($(id)?.checked);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}

function saveLocal(partial) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...partial }));
  } catch (e) {
    console.warn("timeclock-settings: localStorage save failed", e);
  }
}

/* ─── Firestore sync ─────────────────────────────────────── */
async function saveToFirestore(partial) {
  const companyId = window.appState?.companyId;
  if (!companyId) {
    console.warn("timeclock-settings: no companyId in appState, skipping Firestore sync");
    return;
  }
  await setDoc(
    doc(db, "companies", companyId, "settings", "config"),
    { ...partial, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/* ─── Populate form ──────────────────────────────────────── */
function populateForm(s) {
  const sc = (id, v) => { const el = $(id); if (el && v !== undefined) el.checked = !!v; };
  const sv = (id, v) => { const el = $(id); if (el && v !== undefined) el.value = v; };

  // Clock-In
  sc("requirePin",           s.requirePin           ?? true);
  sc("allowEarlyClockIn",    s.allowEarlyClockIn    ?? true);
  sv("earlyClockInWindow",   s.earlyClockInWindow   ?? 15);
  sc("requireLateReason",    s.requireLateReason    ?? false);
  sc("showShiftOnPunch",     s.showShiftOnPunch     ?? true);
  sc("warnOvertimeOnPunch",  s.warnOvertimeOnPunch  ?? true);

  // Clock-Out & Security
  sc("autoClockOut",         s.autoClockOut         ?? false);
  sv("autoClockOutHours",    s.autoClockOutHours    ?? 12);
  sc("logIpOnPunch",         s.logIpOnPunch         ?? false);
  sc("buddyPunchWarning",    s.buddyPunchWarning    ?? false);
  sv("kioskIdleTimeout",     s.kioskIdleTimeout     ?? 30);

  // Breaks
  sc("allowBreaks",          s.allowBreaks          ?? true);
  sv("maxBreakMinutes",      s.maxBreakMinutes      ?? 30);
  sc("breaksCountAsHours",   s.breaksCountAsHours   ?? false);
  sc("alertLongBreak",       s.alertLongBreak       ?? true);

  // Notifications
  sc("notifLateClockIn",     s.notifLateClockIn     ?? false);
  sc("notifMissedPunch",     s.notifMissedPunch     ?? true);
  sc("notifEarlyClockOut",   s.notifEarlyClockOut   ?? false);
  sc("notifOvertimePunch",   s.notifOvertimePunch   ?? true);
}

/* ─── Collect form ───────────────────────────────────────── */
function collectForm() {
  return {
    // Clock-In
    requirePin:          gc("requirePin"),
    allowEarlyClockIn:   gc("allowEarlyClockIn"),
    earlyClockInWindow:  +(gv("earlyClockInWindow")  || 15),
    requireLateReason:   gc("requireLateReason"),
    showShiftOnPunch:    gc("showShiftOnPunch"),
    warnOvertimeOnPunch: gc("warnOvertimeOnPunch"),

    // Clock-Out & Security
    autoClockOut:        gc("autoClockOut"),
    autoClockOutHours:   +(gv("autoClockOutHours")   || 12),
    logIpOnPunch:        gc("logIpOnPunch"),
    buddyPunchWarning:   gc("buddyPunchWarning"),
    kioskIdleTimeout:    +(gv("kioskIdleTimeout")    || 30),

    // Breaks
    allowBreaks:         gc("allowBreaks"),
    maxBreakMinutes:     +(gv("maxBreakMinutes")     || 30),
    breaksCountAsHours:  gc("breaksCountAsHours"),
    alertLongBreak:      gc("alertLongBreak"),

    // Notifications
    notifLateClockIn:    gc("notifLateClockIn"),
    notifMissedPunch:    gc("notifMissedPunch"),
    notifEarlyClockOut:  gc("notifEarlyClockOut"),
    notifOvertimePunch:  gc("notifOvertimePunch"),
  };
}

/* ─── Save button ────────────────────────────────────────── */
function wireSaveButton() {
  $("saveTimeclock")?.addEventListener("click", async () => {
    const btn  = $("saveTimeclock");
    const orig = btn?.textContent;
    if (btn) { btn.textContent = "Saving..."; btn.disabled = true; }

    const s = collectForm();
    saveLocal(s);

    try {
      await saveToFirestore(s);
      if (btn) {
        btn.textContent = "✅ Saved";
        setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
      }
    } catch (err) {
      console.error("timeclock-settings: Firestore save failed", err);
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
  populateForm(load());
  wireSaveButton();
}

window.addEventListener("authReady", () => populateForm(load()));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}