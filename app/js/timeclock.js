import { auth, db } from "./core/firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================== STATE ================== */
let pin = "";
let employee = null;       // single source of truth (was split between employee / currentEmployee)
let companyId = null;
let status = "OUT";        // OUT | IN | ON_BREAK

/* ================== AUDIO ================== */
// Must NOT be created at module load — browsers block AudioContext
// until after a user gesture. Lazily created on first interaction.
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playClick() {
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(1200, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.02);
  g.gain.setValueAtTime(0.08, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.03);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.03);

  const o2 = audioCtx.createOscillator();
  o2.type = "square";
  o2.frequency.value = 80;
  o2.connect(g);
  o2.start();
  o2.stop(audioCtx.currentTime + 0.015);
}

function beepSuccess() {
  ensureAudio();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = "sine";
  o.frequency.value = 880;
  g.gain.value = 0.06;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.09);
}

document.addEventListener("click", () => playClick());

/* ================== DOM REFS ================== */
const pinDisplay     = document.getElementById("pinDisplay");
const authSection    = document.getElementById("auth-section");
const actionSection  = document.getElementById("action-section");
const statusMsg      = document.getElementById("status-msg");
const welcomeMsg     = document.getElementById("employee-welcome");
const clockEl        = document.getElementById("kiosk-clock");
const offlineBanner  = document.getElementById("offlineBanner");

/* ================== LIVE CLOCK & DATE ================== */
function updateClock() {
  if (!clockEl) return;
  clockEl.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}
function updateDate() {
  const el = document.getElementById("kiosk-date");
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric"
  });
}
updateClock();
updateDate();
setInterval(updateClock, 1000);

/* ================== ONLINE STATUS ================== */
function updateOnlineStatus() {
  if (!offlineBanner) return;
  offlineBanner.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online",  updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);
updateOnlineStatus();

/* ================== GLOW ================== */
function glowMachine(colorClass) {
  if (!actionSection) return;
  actionSection.classList.remove("glow-green", "glow-red", "glow-amber", "glow-blue");
  actionSection.classList.add(colorClass);
  setTimeout(() => actionSection.classList.remove(colorClass), 1200);
}

/* ================== STATUS MESSAGE ================== */
function showStatus(msg) {
  if (!statusMsg) return;
  statusMsg.textContent = msg;
  statusMsg.classList.add("show");
  setTimeout(() => statusMsg.classList.remove("show"), 900);
}

/* ================== BUTTON STATES ================== */
function updateButtons() {
  const punchInBtn    = document.getElementById("punchInBtn");
  const punchOutBtn   = document.getElementById("punchOutBtn");
  const startBreakBtn = document.getElementById("startBreakBtn");
  const endBreakBtn   = document.getElementById("endBreakBtn");

  if (!punchInBtn) return; // guard — not on kiosk page

  const s = status.toUpperCase();
  punchInBtn.disabled    = s !== "OUT";
  punchOutBtn.disabled   = s === "OUT" || s === "ON_BREAK";
  startBreakBtn.disabled = s !== "IN";
  endBreakBtn.disabled   = s !== "ON_BREAK";
}

/* ================== DOT INDICATORS ================== */
let _pinLen = 0;
function updateDots(len) {
  _pinLen = len;
  for (let i = 0; i < 4; i++) {
    document.getElementById("dot" + i)?.classList.toggle("filled", i < len);
  }
}

/* ================== PIN PAD ================== */
window.pressPin = (num) => {
  if (pin.length >= 4) return;
  pin += num;
  if (pinDisplay) {
    pinDisplay.innerHTML = "&bull;".repeat(pin.length);
    pinDisplay.style.background = "#e9ecef";
  }
  updateDots(pin.length);
};

window.clearPin = () => {
  pin = "";
  if (pinDisplay) {
    pinDisplay.innerHTML = "";
    pinDisplay.style.background = "#f1f3f5";
  }
  updateDots(0);
};

/* ================== LAST STATUS ================== */
async function getLastStatus() {
  const q = query(
    collection(db, "companies", companyId, "punchLogs"),
    where("employeeId", "==", employee.id)
  );
  const snap = await getDocs(q);
  if (snap.empty) return "OUT";

  let lastEvent = null;
  snap.forEach(d => {
    const data = d.data();
    if (!lastEvent || (data.ts?.seconds ?? 0) > (lastEvent.ts?.seconds ?? 0)) {
      lastEvent = data;
    }
  });

  if (!lastEvent) return "OUT";
  if (lastEvent.eventType === "punch_in")    return "IN";
  if (lastEvent.eventType === "break_start") return "ON_BREAK";
  if (lastEvent.eventType === "break_end")   return "IN";
  if (lastEvent.eventType === "punch_out")   return "OUT";
  return "OUT";
}

/* ================== SUBMIT PIN ================== */
window.submitPin = async () => {
  if (pin.length !== 4) {
    alert("Enter a 4-digit PIN");
    return;
  }

  try {
    const q = query(
      collection(db, "companies", companyId, "employees"),
      where("pin", "==", pin)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      window.clearPin();
      alert("Invalid PIN");
      return;
    }

    const docSnap = snap.docs[0];
    employee = { id: docSnap.id, ...docSnap.data() };

    if (welcomeMsg) welcomeMsg.textContent = `Hello ${employee.fullName}`;

    const avatarEl = document.getElementById("welcomeAvatar");
    if (avatarEl) avatarEl.textContent = employee.fullName?.charAt(0).toUpperCase() ?? "?";

    authSection?.classList.add("hidden");
    actionSection?.classList.remove("hidden");

    status = await getLastStatus();
    if (statusMsg) statusMsg.textContent = `Status: ${status.replace("_", " ")}`;
    updateButtons();

  } catch (err) {
    console.error("submitPin error:", err);
    if (statusMsg) statusMsg.textContent = "⚠️ Error — try again";
  }
};

/* ================== LOCK ALL BUTTONS ================== */
function lockAllButtons() {
  ["punchInBtn", "punchOutBtn", "startBreakBtn", "endBreakBtn"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = true;
  });
}

/* ================== PULSE ================== */
function pulse(btn) {
  btn.classList.remove("btn-success");
  void btn.offsetWidth;
  btn.classList.add("btn-success");
}

/* ================== LATE CLOCK-IN CHECK ================== */

/**
 * Parse a shift string like "9:00am", "9am", "2:30pm", "14:00" → minutes since midnight.
 * Returns null if the string can't be parsed or is "off".
 */
function parseShiftStart(raw) {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/\s/g, "");
  if (!v || v === "off" || v === "oncall") return null;

  // 24-hour: "14:00", "9:00"
  const h24 = v.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) return parseInt(h24[1]) * 60 + parseInt(h24[2]);

  // 12-hour with minutes: "9:00am", "2:30pm"
  const h12m = v.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (h12m) {
    let h = parseInt(h12m[1]);
    const m = parseInt(h12m[2]);
    if (h12m[3] === "pm" && h !== 12) h += 12;
    if (h12m[3] === "am" && h === 12) h = 0;
    return h * 60 + m;
  }

  // 12-hour no minutes: "9am", "2pm"
  const h12 = v.match(/^(\d{1,2})(am|pm)$/);
  if (h12) {
    let h = parseInt(h12[1]);
    if (h12[2] === "pm" && h !== 12) h += 12;
    if (h12[2] === "am" && h === 12) h = 0;
    return h * 60;
  }

  return null;
}

/**
 * Get Monday of current week, return ISO date string for the week doc ID.
 */
function getCurrentWeekId(cId) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return `${cId}_${d.toISOString().split("T")[0]}`;
}

/**
 * Get day index (0=Mon … 6=Sun) for today.
 */
function todayDayIndex() {
  const dow = new Date().getDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
}

/**
 * Check if this punch-in is late and, if so, write a notification.
 * Called only when eventType === "punch_in" and the setting is enabled.
 */
async function checkLateAndNotify(empId, empName) {
  try {
    // 1. Is the setting on?
    const settings = JSON.parse(localStorage.getItem("appSettings") || "{}");
    if (!settings.notifLateClockIn) return;

    const LATE_THRESHOLD_MINS = 5;

    // 2. Fetch this week's schedule doc
    const weekId   = getCurrentWeekId(companyId);
    const schedRef = doc(db, "weekly_schedules", weekId);
    const schedSnap = await getDoc(schedRef);
    if (!schedSnap.exists()) return;

    const scheduleData = schedSnap.data().schedule_data || {};
    const shifts = scheduleData[empId];
    if (!shifts) return; // employee has no schedule this week

    // 3. Get today's shift string
    const dayIdx   = todayDayIndex();
    const shiftRaw = Array.isArray(shifts) ? shifts[dayIdx] : shifts[Object.keys(shifts)[dayIdx]];
    const shiftStart = parseShiftStart(shiftRaw);
    if (shiftStart === null) return; // off today or no shift

    // 4. Compare to current time
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const minsLate = nowMins - shiftStart;
    if (minsLate < LATE_THRESHOLD_MINS) return; // on time

    // 5. Format for display
    const lateStr = minsLate >= 60
      ? `${Math.floor(minsLate / 60)}h ${minsLate % 60}m`
      : `${minsLate} min`;

    const scheduledStr = shiftRaw.trim();

    // 6. Write notification to Firestore
    await addDoc(
      collection(db, "companies", companyId, "notifications"),
      {
        type:      "late_clock_in",
        title:     `Late clock-in — ${empName}`,
        message:   `${empName} clocked in ${lateStr} late. Scheduled: ${scheduledStr}.`,
        read:      false,
        createdAt: serverTimestamp(),
        employeeId: empId,
        minsLate,
      }
    );

  } catch (err) {
    // Non-fatal — don't block the punch
    console.warn("checkLateAndNotify failed:", err);
  }
}

/* ================== LOG EVENT ================== */
async function log(type, nextStatus, msg) {
  beepSuccess();

  if (type === "punch_in")    glowMachine("glow-green");
  if (type === "punch_out")   glowMachine("glow-red");
  if (type === "break_start") glowMachine("glow-amber");
  if (type === "break_end")   glowMachine("glow-blue");

  if (actionSection) {
    actionSection.style.boxShadow = "0 0 25px rgba(34,197,94,0.6)";
    setTimeout(() => { actionSection.style.boxShadow = ""; }, 400);
  }

  lockAllButtons();

  try {
    await addDoc(collection(db, "companies", companyId, "punchLogs"), {
      companyId,
      employeeId: employee.id,
      employeeName: employee.fullName,
      eventType: type,
      ts: serverTimestamp()
    });

    // Late clock-in notification (only on punch_in, non-blocking)
    if (type === "punch_in") {
      await checkLateAndNotify(employee.id, employee.fullName);
    }

    await updateDoc(
      doc(db, "companies", companyId, "employees", employee.id),
      { status: nextStatus }
    );

    status = nextStatus;
    showStatus(msg);
    window.resetKiosk();

  } catch (err) {
    console.warn("Firestore unavailable, saving offline:", err);

    const offlinePunch = {
      companyId,
      employeeId: employee.id,
      employeeName: employee.fullName,
      eventType: type,
      ts: new Date().toISOString()
    };
    const existing = JSON.parse(localStorage.getItem("offlinePunchLogs") || "[]");
    existing.push(offlinePunch);
    localStorage.setItem("offlinePunchLogs", JSON.stringify(existing));

    if (statusMsg) statusMsg.textContent = "⚠️ Offline — saved locally";
    window.resetKiosk();
  }
}

/* ================== BUTTON ACTIONS ================== */
document.getElementById("punchInBtn")?.addEventListener("click", () => {
  pulse(document.getElementById("punchInBtn"));
  log("punch_in", "IN", "✅ Punched In");
});
document.getElementById("punchOutBtn")?.addEventListener("click", () => {
  pulse(document.getElementById("punchOutBtn"));
  log("punch_out", "OUT", "⏹ Punched Out");
});
document.getElementById("startBreakBtn")?.addEventListener("click", () => {
  pulse(document.getElementById("startBreakBtn"));
  log("break_start", "ON_BREAK", "☕ Break Started");
});
document.getElementById("endBreakBtn")?.addEventListener("click", () => {
  pulse(document.getElementById("endBreakBtn"));
  log("break_end", "IN", "▶️ Break Ended");
});

/* ================== RESET KIOSK ================== */
window.resetKiosk = function () {
  setTimeout(() => {
    pin = "";
    employee = null;
    status = "OUT";

    if (pinDisplay)   pinDisplay.textContent = "";
    if (statusMsg)    statusMsg.textContent = "";
    updateDots(0);

    actionSection?.classList.add("hidden");
    authSection?.classList.remove("hidden");
    updateButtons();
  }, 1600);
};

/* ================== INIT ================== */
const params = new URLSearchParams(window.location.search);
companyId = params.get("companyId");

if (!companyId) {
  alert("Missing companyId in URL");
}

async function loadCompanyName() {
  const el = document.getElementById("companyName");
  if (!companyId || !el) return;
  try {
    const snap = await getDoc(doc(db, "companies", companyId));
    el.textContent = snap.exists()
      ? (snap.data().name || snap.data().companyName || "Company")
      : "Company";
  } catch (err) {
    console.error("Failed to load company name:", err);
    el.textContent = "Company";
  }
}

loadCompanyName();
updateButtons(); // safe — status is "OUT", buttons are guarded with null checks