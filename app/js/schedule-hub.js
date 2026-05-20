// js/schedule-hub.js
// Powers schedule.html (Schedule Hub) — read-only summary view.
// Does NOT handle the editor grid, ctxMenu, autoGenerate, or save logic.
// Those all live in schedule-editor.js (formerly schedule.js).
import { auth, db } from "./core/firebase.js";
import {
  doc, getDoc, getDocs, setDoc,
  collection, query, where,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}
/* ─── Constants ──────────────────────────────────────────── */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SHIFT_HOUR_MAP = {
  morning:   { start: 9,  end: 17 },
  afternoon: { start: 13, end: 21 },
  evening:   { start: 13, end: 21 },
  night:     { start: 21, end: 5  }
};

/* ─── State ──────────────────────────────────────────────── */
let companyId      = null;
let employees      = [];
let scheduleCache  = {};
let settingsCache  = null;
let selectedWeekStart = mondayOf(new Date());

/* ─── Date helpers ───────────────────────────────────────── */
function mondayOf(date) {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`;
}

function scheduleDocId(cid, weekStart) {
  return `${cid}_${toISODate(weekStart)}`;
}

function formatDateShort(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─── Shift helpers ──────────────────────────────────────── */
function normalizeShiftType(v) {
  if (!v) return "";
  const s = v.toLowerCase();
  if (s === "afternoon") return "evening";
  return s;
}

function shiftToBucket(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (["morning", "evening", "night"].includes(s)) return s;
  if (s === "afternoon") return "evening";
  if (s.includes("7am-3pm") || s.includes("9am-5pm") || s.includes("10am-6pm")) return "morning";
  if (s.includes("3pm-11pm") || s.includes("1pm-9pm"))  return "evening";
  if (s.includes("11pm-7am") || s.includes("9pm-5am"))  return "night";
  const timesMap = settingsCache?.partOfDayTimes || {};
  for (const [bucket, timeStr] of Object.entries(timesMap)) {
    if (timeStr && s === String(timeStr).trim().toLowerCase()) return bucket;
  }
  return s;
}

function getHoursFromShift(shift) {
  if (!shift || shift.toUpperCase() === "OFF" || shift === "oncall") return 0;
  const parts = shift.split("-");
  if (parts.length !== 2) return 0;
  const parse = (t) => {
    t = t.toLowerCase().trim();
    const m = t.match(/(\d+)(?::(\d+))?(am|pm)/);
    if (!m) return 0;
    let h = parseInt(m[1], 10);
    const mins = parseInt(m[2] || "0", 10);
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    return h + mins / 60;
  };
  let start = parse(parts[0]);
  let end   = parse(parts[1]);
  if (end <= start) end += 24;
  return end - start;
}

function hasInsufficientRest(empId, dayIndex, shift) {
  if (dayIndex === 0) return false;
  const prev    = scheduleCache[empId]?.[dayIndex - 1];
  if (!prev) return false;
  const prevKey = shiftToBucket(prev)  || prev;
  const curKey  = shiftToBucket(shift) || shift;
  const prevMap = SHIFT_HOUR_MAP[prevKey];
  const curMap  = SHIFT_HOUR_MAP[curKey];
  if (!prevMap || !curMap) return false;
  let prevEnd = prevMap.end;
  if (prevMap.end < prevMap.start) prevEnd += 24;
  let rest = curMap.start - prevEnd;
  if (rest < 0) rest += 24;
  return rest < 10;
}

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const dob   = new Date(birthDate);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function normalizePositionName(name) {
  return String(name || "").trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/* ─── Data loaders ───────────────────────────────────────── */
async function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const snap = await getDoc(
      doc(db, "companies", companyId, "schedule_settings", "config")
    );
    settingsCache = snap.exists() ? snap.data() : {};
  } catch (e) {
    console.warn("[schedule-hub] settings load failed:", e);
    settingsCache = {};
  }
  return settingsCache;
}

async function loadEmployees() {
  const snap = await getDocs(
    collection(db, "companies", companyId, "employees")
  );
  employees = snap.docs.map(s => {
    const d = s.data();
    return {
      id:             s.id,
      name:           d.fullName     || "Unnamed",
      position:       d.position     || "",
      birthDate:      d.birthDate    || null,
      shiftType:      normalizeShiftType(d.shiftType || d.defaultShift || ""),
    };
  });
}

async function loadSchedule() {
  const weekId  = scheduleDocId(companyId, selectedWeekStart);
  const snap    = await getDoc(doc(db, "weekly_schedules", weekId));
  scheduleCache = {};
  if (snap.exists()) {
    scheduleCache = snap.data().schedule_data || {};
  }
  // Ensure every employee has a row
  employees.forEach(emp => {
    if (!scheduleCache[emp.id]) scheduleCache[emp.id] = ["","","","","","",""];
  });
}

/* ─── Hub builder ────────────────────────────────────────── */
function buildHub() {
  updateKPIs();
  buildCalendar();
  buildEmployeeTable();
  buildShiftMix();
  buildCompliance();
  buildFlags();
  buildCoverageStrip();
  checkSettingsWarning();
}

/* ── KPI strip ───────────────────────────────────────────── */
function updateKPIs() {
  const settings     = settingsCache || {};
  const rules        = settings.positions || {};
  let totalRequired  = 0;
  let totalFilled    = 0;
  let totalHours     = 0;
  let oncallCount    = 0;
  let restViolations = 0;

  employees.forEach(emp => {
    (scheduleCache[emp.id] || []).forEach((shift, dayIndex) => {
      if (!shift) return;
      if (shift === "oncall") { oncallCount++; return; }
      if (shift.toUpperCase() === "OFF") return;
      totalHours += getHoursFromShift(shift);
      if (hasInsufficientRest(emp.id, dayIndex, shift)) restViolations++;
    });
  });

  DAYS.forEach((dayLabel, i) => {
    Object.keys(rules).forEach(pos => {
      const posRules = rules[pos];
      const isNested = Object.keys(posRules).length &&
        typeof posRules[Object.keys(posRules)[0]] === "object" &&
        !DAYS.includes(Object.keys(posRules)[0]);

      if (isNested) {
        Object.keys(posRules).forEach(shift => {
          const need = Number(posRules[shift]?.[dayLabel]) || 0;
          totalRequired += need;
          const have = employees.filter(emp =>
            normalizePositionName(emp.position) === normalizePositionName(pos) &&
            scheduleCache[emp.id]?.[i] &&
            scheduleCache[emp.id][i].toUpperCase() !== "OFF" &&
            shiftToBucket(scheduleCache[emp.id][i]) === shiftToBucket(shift)
          ).length;
          totalFilled += Math.min(have, need);
        });
      } else {
        const need = Number(posRules[dayLabel]) || 0;
        totalRequired += need;
        const have = employees.filter(emp =>
          normalizePositionName(emp.position) === normalizePositionName(pos) &&
          scheduleCache[emp.id]?.[i] &&
          scheduleCache[emp.id][i].toUpperCase() !== "OFF"
        ).length;
        totalFilled += Math.min(have, need);
      }
    });
  });

  const coveragePct = totalRequired
    ? Math.round((totalFilled / totalRequired) * 100)
    : 100;

  const el = id => document.getElementById(id);

  const covEl = el("coverageScore");
  if (covEl) {
    covEl.textContent = coveragePct + "%";
    covEl.style.color = coveragePct >= 95 ? "#16a34a" : coveragePct >= 80 ? "#f59e0b" : "#dc2626";
  }

  const hoursEl = el("totalHours");
  if (hoursEl) hoursEl.textContent = totalHours.toFixed(1) + "h";

  const staffEl = el("shStaff");
  if (staffEl) staffEl.textContent = employees.length;

  const oncallEl = el("shOncall");
  if (oncallEl) oncallEl.textContent = oncallCount;

  const restEl = el("restStatus");
  if (restEl) {
    restEl.textContent = restViolations === 0 ? "OK" : restViolations + " Issues";
    restEl.style.color = restViolations === 0 ? "#16a34a" : "#dc2626";
  }
}

/* ── Weekly calendar ─────────────────────────────────────── */
function buildCalendar() {
  const container = document.getElementById("scheduleCalendar");
  if (!container) return;

  const weekEnd = new Date(selectedWeekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // Header: week range
  const header = document.createElement("div");
  header.style.cssText = "font-size:.78rem;color:var(--text-muted);padding:10px 14px 6px;font-weight:600;";
  header.textContent = `${formatDateShort(selectedWeekStart)} – ${formatDateShort(weekEnd)}`;
  container.innerHTML = "";
  container.appendChild(header);

  // Day columns wrapper
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:0 0 10px 10px;overflow:hidden;";

  DAYS.forEach((day, i) => {
    const col = document.createElement("div");
    col.style.cssText = "background:var(--surface,#fff);padding:8px 6px;min-height:120px;";

    // Day label
    const dayDate = new Date(selectedWeekStart);
    dayDate.setDate(dayDate.getDate() + i);
    const dayLabel = document.createElement("div");
    dayLabel.style.cssText = "font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:6px;";
    dayLabel.textContent = `${day} ${dayDate.getDate()}`;
    col.appendChild(dayLabel);

    // Shifts for this day
    employees.forEach(emp => {
      const shift = (scheduleCache[emp.id] || [])[i];
      if (!shift || shift.toUpperCase() === "OFF" || !shift.trim()) return;

      const pill = document.createElement("div");
      const isOncall = shift === "oncall";
      const bucket   = shiftToBucket(shift);

      const bgMap = {
        morning: "#fef3c7", evening: "#ede9fe", night: "#e0f2fe"
      };
      const colorMap = {
        morning: "#92400e", evening: "#5b21b6", night: "#0369a1"
      };

      pill.style.cssText = `
        font-size:.64rem; font-weight:700; padding:2px 6px; border-radius:5px;
        margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        background:${isOncall ? "#f3e8ff" : (bgMap[bucket] || "#f1f5f9")};
        color:${isOncall ? "#6d28d9" : (colorMap[bucket] || "var(--text-muted)")};
      `;
      pill.title = `${emp.name}: ${shift}`;
      pill.textContent = emp.name.split(" ")[0] + (isOncall ? " 📲" : "");
      col.appendChild(pill);
    });

    grid.appendChild(col);
  });

  container.appendChild(grid);
}

/* ── Hours by employee table ─────────────────────────────── */
function buildEmployeeTable() {
  const tbody = document.getElementById("shEmpBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = employees.map(emp => {
    const shifts = (scheduleCache[emp.id] || []).filter(
      s => s && s.toUpperCase() !== "OFF" && s !== "oncall" && s.trim()
    );
    const hours = shifts.reduce((sum, s) => sum + getHoursFromShift(s), 0);
    return { emp, shifts: shifts.length, hours };
  }).sort((a, b) => b.hours - a.hours);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted);">No data</td></tr>`;
    return;
  }

  rows.forEach(({ emp, shifts, hours }) => {
    const age = calculateAge(emp.birthDate);
    const isMinor = age !== null && age < 18;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="${isMinor ? "color:#b91c1c;" : ""}">${emp.name}${isMinor ? " 🔴" : ""}</td>
      <td style="text-align:center;">${shifts}</td>
      <td style="text-align:center;font-weight:700;">${hours.toFixed(1)}h</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ── Shift mix bars ──────────────────────────────────────── */
function buildShiftMix() {
  let morning = 0, evening = 0, night = 0;

  employees.forEach(emp => {
    (scheduleCache[emp.id] || []).forEach(shift => {
      if (!shift || shift.toUpperCase() === "OFF" || shift === "oncall") return;
      const b = shiftToBucket(shift);
      if (b === "morning") morning++;
      else if (b === "evening") evening++;
      else if (b === "night") night++;
    });
  });

  const total = morning + evening + night || 1;
  const pct   = n => Math.round((n / total) * 100) + "%";

  const set = (barId, cntId, val) => {
    const bar = document.getElementById(barId);
    const cnt = document.getElementById(cntId);
    if (bar) bar.style.width = pct(val);
    if (cnt) cnt.textContent  = val;
  };

  set("shBarMorning", "shCntMorning", morning);
  set("shBarEvening", "shCntEvening", evening);
  set("shBarNight",   "shCntNight",   night);
}

/* ── Compliance panel ────────────────────────────────────── */
function buildCompliance() {
  let restIssues = 0, overtimeCount = 0, consecIssues = 0;

  employees.forEach(emp => {
    let streak   = 0;
    let weekHours = 0;

    (scheduleCache[emp.id] || []).forEach((shift, dayIndex) => {
      if (!shift || shift.toUpperCase() === "OFF" || shift === "oncall") {
        streak = 0;
        return;
      }
      weekHours += getHoursFromShift(shift);
      streak++;
      if (hasInsufficientRest(emp.id, dayIndex, shift)) restIssues++;
      if (streak >= 6) consecIssues++;
    });

    if (weekHours >= 40) overtimeCount++;
  });

  function setComp(dotId, valId, ok, label) {
    const dot = document.getElementById(dotId);
    const val = document.getElementById(valId);
    if (dot) {
      dot.className = `sh-comp-dot ${ok ? "ok" : "warn"}`;
      if (!ok) dot.style.background = "#dc2626";
      else      dot.style.background = "";
    }
    if (val) {
      val.textContent = label;
      val.style.color = ok ? "#16a34a" : "#dc2626";
    }
  }

  setComp("dotRest",     "compRestVal",     restIssues === 0,   restIssues === 0    ? "OK" : `${restIssues} Issues`);
  setComp("dotOvertime", "compOvertimeVal", overtimeCount === 0, overtimeCount === 0 ? "OK" : `${overtimeCount} Staff`);
  setComp("dotConsec",   "compConsecVal",   consecIssues === 0,  consecIssues === 0  ? "OK" : `${consecIssues} Issues`);
}

/* ── Flags ───────────────────────────────────────────────── */
function buildFlags() {
  const container = document.getElementById("shViolations");
  if (!container) return;

  const flags = [];

  employees.forEach(emp => {
    const age    = calculateAge(emp.birthDate);
    let streak   = 0;
    let weekHours = 0;

    (scheduleCache[emp.id] || []).forEach((shift, dayIndex) => {
      if (!shift || shift.toUpperCase() === "OFF" || shift === "oncall") {
        streak = 0;
        return;
      }
      const h = getHoursFromShift(shift);
      weekHours += h;
      streak++;

      if (hasInsufficientRest(emp.id, dayIndex, shift)) {
        flags.push(`⚠️ ${emp.name} — insufficient rest before ${DAYS[dayIndex]}`);
      }
      if (age !== null && age < 18 && h > 8) {
        flags.push(`🚨 ${emp.name} (minor) — over 8h on ${DAYS[dayIndex]}`);
      }
      if (streak >= 6) {
        flags.push(`⚠️ ${emp.name} — ${streak} consecutive days`);
      }
    });

    if (weekHours >= 40) {
      flags.push(`🚨 ${emp.name} — overtime risk (${weekHours.toFixed(1)}h)`);
    }
    if (age !== null && age < 18 && weekHours > 40) {
      flags.push(`🚨 ${emp.name} (minor) — exceeds 40h weekly limit`);
    }
  });

  if (!flags.length) {
    container.innerHTML = `<div style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:.82rem;">✅ No issues this week</div>`;
    return;
  }

  container.innerHTML = flags.map(f =>
    `<div style="font-size:.78rem;padding:5px 0;border-bottom:1px solid var(--border);color:var(--text);">${f}</div>`
  ).join("");
}

/* ── Coverage day strip ──────────────────────────────────── */
function buildCoverageStrip() {
  const strip = document.getElementById("coverageStrip");
  if (!strip) return;
  strip.innerHTML = "";
  strip.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;";

  const rules = settingsCache?.positions || {};
  if (!Object.keys(rules).length) return;

  DAYS.forEach((day, i) => {
    let gaps = 0;

    Object.keys(rules).forEach(pos => {
      const posRules = rules[pos];
      const isNested = Object.keys(posRules).length &&
        typeof posRules[Object.keys(posRules)[0]] === "object" &&
        !DAYS.includes(Object.keys(posRules)[0]);

      if (isNested) {
        Object.keys(posRules).forEach(shift => {
          const need = Number(posRules[shift]?.[day]) || 0;
          const have = employees.filter(emp =>
            normalizePositionName(emp.position) === normalizePositionName(pos) &&
            scheduleCache[emp.id]?.[i] &&
            scheduleCache[emp.id][i].toUpperCase() !== "OFF" &&
            shiftToBucket(scheduleCache[emp.id][i]) === shiftToBucket(shift)
          ).length;
          if (have < need) gaps++;
        });
      } else {
        const need = Number(posRules[day]) || 0;
        const have = employees.filter(emp =>
          normalizePositionName(emp.position) === normalizePositionName(pos) &&
          scheduleCache[emp.id]?.[i] &&
          scheduleCache[emp.id][i].toUpperCase() !== "OFF"
        ).length;
        if (have < need) gaps++;
      }
    });

    const btn = document.createElement("button");
    btn.style.cssText = `
      padding:5px 11px; border-radius:6px; border:none; cursor:pointer;
      font-size:.75rem; font-weight:700;
      background:${gaps === 0 ? "#16a34a" : "#dc2626"}; color:white;
    `;
    btn.textContent = gaps === 0 ? day : `${day} (${gaps})`;
    strip.appendChild(btn);
  });
}

/* ── Settings warning ────────────────────────────────────── */
function checkSettingsWarning() {
  const warn  = document.getElementById("scheduleSettingsWarning");
  if (!warn) return;
  const rules = settingsCache?.positions || {};
  let hasCoverage = false;
  Object.values(rules).forEach(pos => {
    Object.values(pos).forEach(v => {
      if (typeof v === "object" && v !== null) {
        Object.values(v).forEach(n => { if (Number(n) > 0) hasCoverage = true; });
      } else {
        if (Number(v) > 0) hasCoverage = true;
      }
    });
  });
  warn.classList.toggle("hidden", hasCoverage);
}

/* ─── Publish button ─────────────────────────────────────── */
async function publishSchedule() {
  const btn = document.getElementById("publishScheduleBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }

  try {
    const weekId   = scheduleDocId(companyId, selectedWeekStart);
    const schedRef = doc(db, "weekly_schedules", weekId);

    await setDoc(schedRef, {
      companyId,
      weekStart:   toISODate(selectedWeekStart),
      published:   true,
      publishedAt: serverTimestamp(),
      updatedAt:   serverTimestamp()
    }, { merge: true });

    // Notify scheduled employees
    const weekEnd  = new Date(selectedWeekStart);
    weekEnd.setDate(selectedWeekStart.getDate() + 6);
    const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const weekLabel = `${fmt(selectedWeekStart)} – ${fmt(weekEnd)}`;

    const batch = writeBatch(db);
    let count   = 0;

    employees.forEach(emp => {
      const shifts  = scheduleCache[emp.id] || [];
      const hasWork = shifts.some(s => s && s.toUpperCase() !== "OFF" && s !== "oncall");
      if (!hasWork) return;

      const ref = doc(collection(db, "companies", companyId, "notifications"));
      batch.set(ref, {
        employeeId: emp.id,
        title:      "📅 Schedule Published",
        message:    `Your schedule for ${weekLabel} is now available.`,
        type:       "schedule_published",
        status:     "unread",
        read:       false,
        createdAt:  serverTimestamp()
      });
      count++;
    });

    if (count > 0) await batch.commit();

    if (btn) {
      btn.textContent        = "✅ Published";
      btn.style.background   = "#16a34a";
      setTimeout(() => {
        btn.disabled         = false;
        btn.textContent      = "🚀 Publish Schedule";
        btn.style.background = "";
      }, 3000);
    }

    alert(`✅ Published — ${count} employee${count !== 1 ? "s" : ""} notified.`);

  } catch (err) {
    console.error("[schedule-hub] publish failed:", err);
    alert("❌ Publish failed. Check console.");
    if (btn) { btn.disabled = false; btn.textContent = "🚀 Publish Schedule"; }
  }
}

/* ─── Auth + init ────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const snap     = await getDoc(doc(db, "app_user", user.uid));
    const userData = snap.data() || {};
    companyId      = userData.companyId || userData.company_id || null;

    if (!companyId) {
      alert("No company assigned to this account.");
      return;
    }

    // Update header UI
    const nameEl = document.getElementById("companyNameDisplay");
    if (nameEl) nameEl.textContent = userData.companyName || userData.company_name || "Company";

    const welcomeEl = document.getElementById("welcome-msg");
    if (welcomeEl) {
      const display = userData.fullName || user.email?.split("@")[0] || "Manager";
      welcomeEl.textContent = `Welcome, ${display}`;
    }

    // Load everything then build the hub
    await loadSettings();
    await loadEmployees();
    await loadSchedule();
    buildHub();

    // Wire publish button
    document.getElementById("publishScheduleBtn")
      ?.addEventListener("click", publishSchedule);

  } catch (err) {
    console.error("[schedule-hub] init failed:", err);
  }
});