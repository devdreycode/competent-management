import { auth, db } from "./core/firebase.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  addDoc,
  writeBatch,
  query,
  where,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}
/* ===================== HELPERS ===================== */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const $ = (id) => document.getElementById(id);
function calculateAge(birthDate) {
  if (!birthDate) return null;

  const today = new Date();
  const dob = new Date(birthDate);

  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }

  return age;
}
const confirmBox = document.getElementById("confirmClearBox");
const confirmYes = document.getElementById("confirmYes");
const confirmNo = document.getElementById("confirmNo");
const EMPTY_WEEK = () => ["", "", "", "", "", "", ""];

/* =====================
   DATE HELPERS
===================== */
console.log("✅ schedule.js loaded");

function toISODate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function normalizePositionName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dayIndexFromDate(weekStartStr, dateStr) {
  // weekStartStr like "2026-04-06" (Monday)
  // dateStr like "2026-04-09"
  const weekStart = new Date(weekStartStr + "T00:00:00");
  const date = new Date(dateStr + "T00:00:00");

  const diffDays = Math.round((date - weekStart) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > 6) return null; // not in that week
  return diffDays; // 0..6 where 0 is Monday
}

function canAssignManually(emp, dayIndex) {
  if (!emp) return false;
  return true;
}
function scheduleDocId(companyId, weekStart) {
  return `${companyId}_${toISODate(weekStart)}`;
}
// HELPER: Convert Firebase Timestamp to JS Date
function normalizeDate(d) {
  if (!d) return null;
  if (typeof d.toDate === "function") return d.toDate(); // Handles Firebase Timestamps
  if (d instanceof Date) return d;
  return new Date(d); // Handles strings
}
/* =====================
   SHIFT HELPERS
===================== */

// ✅ TIME-ONLY OUTPUT (7am–3pm)
function buildShiftLabel(shiftType, settings) {
  if (!shiftType || !settings) return "";

  const map = settings.partOfDayTimes || {};
  return map[shiftType] || "";
}

function normalizeShift(v) {
  if (!v) return "";
  return v.toString().trim();
}

function normalizeShiftType(v) {
  if (!v) return "";
  const s = v.toLowerCase();
  if (s === "afternoon") return "evening";
  return s;
}
function getWeeklyHours(empId, auto) {
  const row = auto[empId];
  if (!Array.isArray(row)) return 0;
  return row.reduce((sum, shift) => sum + getHoursFromShift(shift), 0);
}
function calculateReliability(emp, auto) {
  let score = 1;
  const hours = getWeeklyHours(emp.id, auto);
  if (hours > 40) score -= 0.4;
  if (hours > 48) score -= 0.6;
  let streak = 0;
  (auto[emp.id] || []).forEach(shift => {
    if (shift && shift !== "OFF") { streak++; }
    else { streak = 0; }
    if (streak >= 4) score -= 0.2;
  });
  return Math.max(score, 0.2);
}
/* =====================
   EMPLOYEE HELPERS
===================== */

function worksThisDay(emp, dayLabel) {
  return emp.normalSchedule?.days?.includes(dayLabel);
}

function getNormalShift(emp) {
  if (!emp.normalSchedule) return null;
  const { start, end } = emp.normalSchedule;
  if (!start || !end) return null;
  return `${start}-${end}`;
}
function getNormalLabelForEmp(emp) {
  if (!emp) return "";

  // 1️⃣ Exact normal schedule on employee
  const specific = getNormalShift(emp);
  if (specific) return specific;

  // 2️⃣ Try schedule settings (morning / evening / night)
  const settings = scheduleSettingsCache || {};
  const shiftType = normalizeShiftType(emp.shiftType || emp.defaultShift || "");

  if (settings.partOfDayTimes && settings.partOfDayTimes[shiftType]) {
    return settings.partOfDayTimes[shiftType];
  }

  // 3️⃣ FINAL fallback — always return something
  if (shiftType === "morning") return "9am-5pm";
  if (shiftType === "evening") return "1pm-9pm";
  if (shiftType === "night") return "9pm-5am";

  return "9am-5pm";
}

// Turn a time shift like "9-5" or "7-3" into a bucket: morning/evening/night
function shiftToBucket(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";

  // Already a bucket word
  if (["morning", "evening", "night"].includes(s)) return s;
  if (s === "afternoon") return "evening";

  // 24h time ranges
 // 12-hour time ranges
if (
  s.includes("7am-3pm") ||
  s.includes("9am-5pm") ||
  s.includes("10am-6pm")
) return "morning";

if (
  s.includes("3pm-11pm") ||
  s.includes("1pm-9pm")
) return "evening";

if (
  s.includes("11pm-7am") ||
  s.includes("9pm-5am")
) return "night";

  // Use partOfDayTimes from settings cache if available
  const timesMap = scheduleSettingsCache?.partOfDayTimes || {};
  for (const [bucket, timeStr] of Object.entries(timesMap)) {
    if (timeStr && s === String(timeStr).trim().toLowerCase()) return bucket;
  }

  // Last resort: return the value itself so exact matches still work
  return s;
}
function getHoursFromShift(shift) {
  // If shift is empty or explicitly OFF, it's 0 hours
  if (!shift || shift.toUpperCase() === "OFF") return 0;

  // Handle On-Call logic based on settings toggle
  if (shift.toLowerCase() === "oncall") {
    const treatOnCallAsRisk = scheduleSettingsCache?.autoScheduler?.onCallOvertimeRisk ?? false;
    
    // IF YES (true): Treat as 8 hours toward overtime risk math
    // IF NO (false): Treat as 0 hours so it won't impact warnings or scores
    return treatOnCallAsRisk ? 8 : 0; 
  }

  const parts = shift.split("-");
  if (parts.length !== 2) return 0;

  const parse = (t) => {
    t = t.toLowerCase().trim();
    const match = t.match(/(\d+)(?::(\d+))?(am|pm)/);
    if (!match) return 0;

    let hour = parseInt(match[1], 10);
    const minutes = parseInt(match[2] || "0", 10);
    const period = match[3];

    if (period === "pm" && hour !== 12) hour += 12;
    if (period === "am" && hour === 12) hour = 0;

    return hour + minutes / 60;
  };

  let start = parse(parts[0]);
  let end = parse(parts[1]);

  if (end <= start) end += 24;

  return end - start;
}

function checkMinorHours() {
  const warnings = [];

  employees.forEach(emp => {
    const age = calculateAge(emp.birthDate);
    if (!age || age >= 18) return;

    let weeklyTotal = 0;

    (scheduleCache[emp.id] || []).forEach((shift, i) => {
      const hours = getHoursFromShift(shift);
      weeklyTotal += hours;

      if (hours > 8) {
        warnings.push(`${emp.name} exceeds 8 hours on ${DAYS[i]} (${hours}h)`);
      }
    });

   if (weeklyTotal > 40) {
  const over = (weeklyTotal - 40).toFixed(1);
  warnings.push(
    `🚨 ${emp.name} exceeds weekly limit by ${over} hours (${weeklyTotal.toFixed(1)}h total)`
  );
}

    
  });

  return warnings;
}

export async function approveShiftChange({
  companyId,
  weekStart,          // "2026-04-06"
  employeeId,         // matches a key inside schedule_data
  dayIndex,           // 0..6
  requestedShift,     // e.g. "1pm-9pm"
  requestRef          // doc ref to the request doc (optional)
}) {
  const scheduleId = `${companyId}_${weekStart}`;
  const schedRef = doc(db, "weekly_schedules", scheduleId);

  const snap = await getDoc(schedRef);
  if (!snap.exists()) throw new Error("Weekly schedule not found.");

  const sched = snap.data();
  const map = sched.schedule_data || {};
  const arr = Array.isArray(map[employeeId]) ? [...map[employeeId]] : null;

  if (!arr) throw new Error("Employee schedule array missing.");

  // Apply change
  arr[dayIndex] = requestedShift;

  // Write back only that employee’s array (doesn't overwrite other employees)
  await updateDoc(schedRef, {
    [`schedule_data.${employeeId}`]: arr,
    updatedAt: serverTimestamp()
  });

  // Mark request approved if you pass a ref
  if (requestRef) {
    await updateDoc(requestRef, {
      status: "approved",
      decidedAt: serverTimestamp()
    });
  }
}

function applyOffStyle(inputEl) {
  const v = (inputEl.value || "").toLowerCase();

  inputEl.classList.remove("off-duty");
  inputEl.classList.remove("oncall");

  if (v === "off") {
    inputEl.classList.add("off-duty");
  }

  if (v === "oncall") {
    inputEl.classList.add("oncall");
  }
}

function setCellValue(empId, dayIndex, inputEl, value) {

  // make sure schedule exists
  if (!scheduleCache[empId]) {
    scheduleCache[empId] = ["","","","","","",""];
  }

const emp = employeeMap[empId];

if (!emp) {
  console.error("Employee not found:", empId);
  return;
}
  // block time-off scheduling
  if (!canAssignManually(emp, dayIndex)) {
    alert("Cannot assign On-Call or shifts on requested time off.");
    return;
  }

  const v = normalizeShift(value);

  // save shift
  scheduleCache[empId][dayIndex] = v;

  // update UI
  inputEl.value = v;
  applyOffStyle(inputEl);

  // update coverage warnings
  updateCoverageWarnings();
}




function setPrintHeader() {
  const companyName = document.getElementById("companyName")?.textContent || "Company";
  const printCompany = document.getElementById("printCompanyName");
  if (printCompany) printCompany.textContent = companyName;

  // Week range
  const start = new Date(selectedWeekStart);
  const end = new Date(selectedWeekStart);
  end.setDate(end.getDate() + 6);

  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekText = `${fmt(start)} – ${fmt(end)}`;

  const printWeek = document.getElementById("printWeekRange");
  if (printWeek) printWeek.textContent = weekText;
}

/* =====================
   UI HELPERS
===================== */

async function goToWeek() {
  const picker = $("weekPicker");
  if (!picker || !picker.value) return;

  // FIX: Split the string manually to avoid Timezone shifts
  const [y, m, d] = picker.value.split("-").map(Number);
  const chosenDate = new Date(y, m - 1, d); // Month is 0-index in JS

  // Now calculate Monday safely
  selectedWeekStart = mondayOf(chosenDate);
  
  console.log("Week Selected:", selectedWeekStart);
  
  await loadEmployeesAndSchedule();
}



const SHIFT_TIME_MAP = {
  morning: "9am-5pm",
  afternoon: "1pm-9pm",
  evening: "1pm-9pm",
  night: "9pm-5am"
};
const SHIFT_HOUR_MAP = {
  morning: { start: 9, end: 17 },
  afternoon: { start: 13, end: 21 },
  evening: { start: 13, end: 21 },
  night: { start: 21, end: 5 } // ends next day
};

function hasInsufficientRest(empId, dayIndex, shiftType, auto) {
  if (dayIndex === 0) return false;

  const prevShiftRaw = auto[empId]?.[dayIndex - 1];
  if (!prevShiftRaw) return false;

  // Normalize both to bucket keys (morning/evening/night)
  const prevKey = shiftToBucket(prevShiftRaw) || prevShiftRaw;
  const curKey  = shiftToBucket(shiftType)    || shiftType;

  const prev    = SHIFT_HOUR_MAP[prevKey];
  const current = SHIFT_HOUR_MAP[curKey];

  if (!prev || !current) return false;

  let prevEnd      = prev.end;
  let currentStart = current.start;

  if (prev.end < prev.start) prevEnd += 24;

  let restHours = currentStart - prevEnd;
  if (restHours < 0) restHours += 24;

  return restHours < 10;
}

function ensureRow(empId) {
  if (!scheduleCache[empId]) scheduleCache[empId] = ["", "", "", "", "", "", ""];
}

function setCell(empId, dayIndex, value) {
  ensureRow(empId);
  scheduleCache[empId][dayIndex] = normalizeShift(value || "");
  updateCoverageWarnings();
}










/* ===================== STATE ===================== */

let companyId = null;
let employees = [];
let employeeMap = {};
let selectedWeekStart = mondayOf(new Date());
let scheduleCache = {};
let activePositionFilter = "";
let activeShiftFilter = "all";
let scheduleSettingsCache = null;
let holdTimer = null;




/* ===================== AUTH ===================== */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  const snap = await getDoc(doc(db, "app_user", user.uid));

  if (!snap.exists()) {
    alert("User profile not found.");
    return;
  }

  const userData = snap.data();
companyId = userData.companyId;

  if (!companyId) {
    alert("No company assigned.");
    return;
  }

  // company first (critical dependency)
  const companySnap = await getDoc(doc(db, "companies", companyId));

  if (!companySnap.exists()) {
    alert("Company not found.");
    return;
  }

  const companyName = companySnap.data().name || "Company";

  const display = document.getElementById("companyNameDisplay");
  if (display) display.textContent = companyName;

  await loadEmployeesAndSchedule(companyId);
});
/* ===================== DATA LOADERS ===================== */

async function loadScheduleSettings(forceRefresh = false) {
  if (scheduleSettingsCache && !forceRefresh) return scheduleSettingsCache;

  try {
    const snap = await getDoc(doc(db, "companies", companyId, "schedule_settings", "config"));
    if (snap.exists()) {
      scheduleSettingsCache = snap.data();
      console.log("Settings Loaded:", scheduleSettingsCache);
      return scheduleSettingsCache;
    }
  } catch (err) {
    console.error("Error loading settings:", err);
  }
  return {};
}
function checkScheduleSettings(settings){

  const warn = document.getElementById("scheduleSettingsWarning");

  if(!warn) return;

  const rules = settings?.positions || {};

  let hasCoverage = false;

  Object.values(rules).forEach(pos => {
    Object.values(pos).forEach(shiftOrCount => {
      if (typeof shiftOrCount === "object" && shiftOrCount !== null) {
        // Nested format: { morning: { Mon: 2, ... }, ... }
        Object.values(shiftOrCount).forEach(v => {
          if (Number(v) > 0) hasCoverage = true;
        });
      } else {
        // Flat format: { Mon: 2, ... }
        if (Number(shiftOrCount) > 0) hasCoverage = true;
      }
    });
  });

  if(!hasCoverage){
    warn.classList.remove("hidden");
  }else{
    warn.classList.add("hidden");
  }

}
async function getApprovedSwaps() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "companies", companyId, "shift_swaps"),
        where("status", "==", "approved")
      )
    );
 
    const map = {}; // keyed by ISO date string
    snap.forEach(docSnap => {
      const d = docSnap.data();
      if (!d.requesterId || !d.swapDate) return;
 
      // Normalize the swap date to an ISO string (handles Timestamps or strings)
      let dateKey;
      if (d.swapDate?.toDate) {
        dateKey = toISODate(d.swapDate.toDate());
      } else if (typeof d.swapDate === "string") {
        dateKey = d.swapDate.slice(0, 10); // take YYYY-MM-DD
      } else {
        return; // unparseable, skip
      }
 
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push({
        requesterId: d.requesterId,
        targetId:    d.targetId || null
      });
    });
 
    return map;
  } catch (err) {
    console.error("getApprovedSwaps:", err);
    return {};
  }
}
async function getApprovedTimeOff() {
  const snap = await getDocs(
    query(
    collection(db, "companies", companyId, "time_off_requests"),
      where("status", "==", "approved")
    )
  );

  const map = {};
  snap.forEach(doc => {
    const d = doc.data();
    if (!d.employeeId || !d.startDate || !d.endDate) return;

    // Use normalizeDate so it doesn't break on Timestamps
    const start = normalizeDate(d.startDate);
    const end = normalizeDate(d.endDate);

    if (!map[d.employeeId]) map[d.employeeId] = [];
    
    // Store them nicely
    map[d.employeeId].push({ start, end });
  });

  return map;
}
function applySwapsToGrid(auto, swapMap) {
  if (!swapMap || !Object.keys(swapMap).length) return;
 
  const weekStartISO = toISODate(selectedWeekStart); // e.g. "2026-04-27"
 
  Object.entries(swapMap).forEach(([dateStr, swaps]) => {
    // Is this date within the displayed week?
    const dayIndex = dayIndexFromDate(weekStartISO, dateStr);
    if (dayIndex === null) return; // not this week
 
    swaps.forEach(({ requesterId, targetId }) => {
      if (!auto[requesterId]) return; // employee not in grid
 
      if (targetId && auto[targetId]) {
        // Full swap — exchange their shifts for this day
        const tmp = auto[requesterId][dayIndex];
        auto[requesterId][dayIndex] = auto[targetId][dayIndex] || "OFF";
        auto[targetId][dayIndex]    = tmp || "OFF";
        console.log(`Swap applied: ${requesterId} ↔ ${targetId} on day ${dayIndex}`);
      } else {
        // No partner — mark requester OFF on that day
        auto[requesterId][dayIndex] = "OFF";
        console.log(`Swap (no partner): ${requesterId} marked OFF on day ${dayIndex}`);
      }
    });
  });
}
/* =====================
   GRID RENDER
===================== */

function renderGrid(data = {}) {
  const table = document.getElementById("scheduleTableBody");

  if (!table) {
    console.error("❌ scheduleTableBody not found in HTML");
    return;
  }

  table.innerHTML = "";

  // ── Build position groups from settings + employees ──────────────────────
  const settings      = scheduleSettingsCache || {};
  const posRules      = settings.positions    || {};  // positions defined in schedule settings
  const partOfDay     = settings.partOfDayTimes || {};

  // Collect all positions: union of settings keys + employee positions
  const settingsPositions = Object.keys(posRules).sort();
  const empPositions      = [...new Set(employees.map(e => normalizePositionName(e.position || "")).filter(Boolean))];
  const allPositions      = [...new Set([...settingsPositions, ...empPositions])].sort();

  // Group employees by normalised position name
  const byPosition = {};
  allPositions.forEach(p => (byPosition[p] = []));
  employees.forEach(emp => {
    const pos = normalizePositionName(emp.position || "");
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(emp);
  });

  // ── Helper: build the employee row ───────────────────────────────────────
  function buildEmpRow(emp) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const age = calculateAge(emp.birthDate);
    if (age && age < 18) {
      nameTd.style.color = "#b91c1c";
      nameTd.title = `Minor (${age} years old)`;
    }
    nameTd.textContent = emp.name;
    tr.appendChild(nameTd);

    for (let i = 0; i < 7; i++) {
      const td    = document.createElement("td");
      td.className = "cell";
      const box   = document.createElement("div");
      box.className = "cellBox";
      const input = document.createElement("input");
      input.className  = "shift-input";
      input.dataset.emp = emp.id;
      input.dataset.day = i;
      input.type  = window.innerWidth < 768 ? "button" : "text";
      input.title = `Edit ${emp.name}'s shift for ${DAYS[i]}. Use OFF for time off.`;
      input.value = (data[emp.id] && data[emp.id][i]) || "";
      applyOffStyle(input);

      box.appendChild(input);
      td.appendChild(box);
      tr.appendChild(td);

      box.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showCtxMenu(e.clientX, e.clientY, { empId: emp.id, dayIndex: i, input }, e);
      });
      box.addEventListener("mouseup",    () => clearTimeout(holdTimer));
      box.addEventListener("mouseleave", () => clearTimeout(holdTimer));

      input.addEventListener("dblclick", () => {
        if (!input.value) return;
        const rect = input.getBoundingClientRect();
        confirmBox.style.top  = `${rect.bottom + window.scrollY + 5}px`;
        confirmBox.style.left = `${rect.left   + window.scrollX}px`;
        confirmBox.classList.remove("hidden");
        confirmYes.onclick = () => { setCellValue(emp.id, i, input, ""); confirmBox.classList.add("hidden"); };
        confirmNo.onclick  = () => { confirmBox.classList.add("hidden"); };
      });
    }
    return tr;
  }

  // ── Helper: build position-header row with coverage counts ───────────────
  function buildPositionHeaderRow(posName) {
    const rules = posRules[posName] || {};

    const tr = document.createElement("tr");
    tr.style.cssText = "background:var(--pos-header-bg, rgba(37,99,235,.06)); border-top:2px solid var(--border, #e2e8f4);";

    // Label cell
    const labelTd = document.createElement("td");
    labelTd.style.cssText = "padding:6px 10px; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--accent,#2563eb); white-space:nowrap;";
    labelTd.textContent = posName;
    tr.appendChild(labelTd);

    // One td per day — shows needed vs scheduled for ALL shifts combined
    for (let i = 0; i < 7; i++) {
      const dayLabel = DAYS[i];
      const td = document.createElement("td");
      td.style.cssText = "padding:4px 6px; text-align:center; font-size:.70rem;";

      // Sum up total needed for this position+day across all shifts
      let totalNeeded = 0;
      const isNested = Object.keys(rules).length &&
        typeof rules[Object.keys(rules)[0]] === "object" &&
        !DAYS.includes(Object.keys(rules)[0]);

      if (isNested) {
        Object.keys(rules).forEach(shift => {
          totalNeeded += Number(rules[shift]?.[dayLabel]) || 0;
        });
      } else {
        totalNeeded = Number(rules[dayLabel]) || 0;
      }

      // Count how many of this position are actually scheduled this day
      const scheduled = employees.filter(emp => {
        if (normalizePositionName(emp.position || "") !== posName) return false;
        const shift = (data[emp.id] || [])[i] || "";
        return shift && String(shift).toUpperCase() !== "OFF" && shift !== "oncall";
      }).length;

      if (totalNeeded === 0) {
        td.textContent = "";
      } else {
        const met = scheduled >= totalNeeded;
        td.innerHTML = `<span style="
          display:inline-block; padding:1px 6px; border-radius:100px; font-weight:700;
          background:${met ? "var(--green-bg,#dcfce7)" : "var(--red-bg,#fee2e2)"};
          color:${met ? "var(--green,#16a34a)" : "var(--red,#dc2626)"};
        ">${scheduled}/${totalNeeded}</span>`;
        td.title = `${posName} on ${dayLabel}: ${scheduled} scheduled, ${totalNeeded} needed`;
      }
      tr.appendChild(td);
    }
    return tr;
  }

  // ── Render by position group ──────────────────────────────────────────────
  let anyRendered = false;

  allPositions.forEach(posName => {
    // Apply position filter
    if (activePositionFilter && posName !== activePositionFilter) return;

    const posEmployees = (byPosition[posName] || []).filter(emp => {
      if (activeShiftFilter !== "all") {
        return normalizeShiftType(emp.shiftType || "") === activeShiftFilter;
      }
      return true;
    });

    // Only show position header if it has employees OR has rules defined
    const hasRules = !!posRules[posName];
    if (!posEmployees.length && !hasRules) return;

    // Position header row
    table.appendChild(buildPositionHeaderRow(posName));

    if (posEmployees.length) {
      posEmployees.forEach(emp => table.appendChild(buildEmpRow(emp)));
    } else {
      // No employees for this position — show an empty-state hint
      const emptyTr = document.createElement("tr");
      const emptyTd = document.createElement("td");
      emptyTd.colSpan = 8;
      emptyTd.style.cssText = "padding:8px 14px; font-size:.78rem; color:var(--text-muted,#64748b); font-style:italic;";
      emptyTd.textContent = `No employees assigned to "${posName}" yet.`;
      emptyTr.appendChild(emptyTd);
      table.appendChild(emptyTr);
    }

    anyRendered = true;
  });

  // Employees with no position (or position not in allPositions)
  const ungrouped = employees.filter(emp => {
    const pos = normalizePositionName(emp.position || "");
    return !pos || !allPositions.includes(pos);
  }).filter(emp => {
    if (activePositionFilter) return false; // hide if filtering
    if (activeShiftFilter !== "all") return normalizeShiftType(emp.shiftType || "") === activeShiftFilter;
    return true;
  });

  if (ungrouped.length) {
    // "No position" header
    const noPosTr = document.createElement("tr");
    noPosTr.style.cssText = "background:var(--bg2,#f1f5fb); border-top:2px solid var(--border,#e2e8f4);";
    const noPosTd = document.createElement("td");
    noPosTd.colSpan = 8;
    noPosTd.style.cssText = "padding:6px 10px; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--text-muted,#64748b);";
    noPosTd.textContent = "No Position Assigned";
    noPosTr.appendChild(noPosTd);
    table.appendChild(noPosTr);
    ungrouped.forEach(emp => table.appendChild(buildEmpRow(emp)));
    anyRendered = true;
  }

  if (!anyRendered) {
    const emptyTr = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 8;
    emptyTd.style.cssText = "text-align:center; padding:40px; color:var(--muted,#64748b); font-size:.85rem;";
    emptyTd.textContent = "No employees found.";
    emptyTr.appendChild(emptyTd);
    table.appendChild(emptyTr);
  }

  updateCoverageWarnings();
} // END renderGrid



const ctxMenu = document.getElementById("ctxMenu");
let ctxCell = null; // { empId, dayIndex, input }

function showCtxMenu(x, y, cell, event) {
  ctxCell = cell;

  ctxMenu.style.display = "block";
  ctxMenu.style.position = "fixed"; // 👈 key change

  const menuWidth = ctxMenu.offsetWidth;
  const menuHeight = ctxMenu.offsetHeight;

  let posX = x;
  let posY = y;

  // Prevent right overflow
  if (posX + menuWidth > window.innerWidth) {
    posX = window.innerWidth - menuWidth - 8;
  }

  // Prevent bottom overflow
  if (posY + menuHeight > window.innerHeight) {
    posY = window.innerHeight - menuHeight - 8;
  }

  ctxMenu.style.left = posX + "px";
  ctxMenu.style.top = posY + "px";

  if (event) event.stopPropagation();
}

function hideCtxMenu() {
  ctxMenu.style.display = "none";
  ctxCell = null;
}

// Click anywhere else = close
document.addEventListener("click", hideCtxMenu);

// Menu actions
ctxMenu.addEventListener("click", (e) => {
  const action = e.target.dataset.action;
  if (!action || !ctxCell) return;

  const { empId, dayIndex, input } = ctxCell;

 if (action === "normal") {
const emp = employeeMap[empId];

if (!emp) {
  console.error("Employee not found:", empId);
  return;
}  const value = getNormalLabelForEmp(emp) || "";
  setCellValue(empId, dayIndex, input, value);
}
if (action === "oncall") {
  setCellValue(empId, dayIndex, input, "oncall");
}


  if (action === "off") {
  setCellValue(empId, dayIndex, input, "OFF");
}
  if (action === "clear") {
    input.value = "";
  }

  scheduleCache[empId][dayIndex] = input.value;
  applyOffStyle(input);
  updateCoverageWarnings();
  hideCtxMenu();
});


/* ===================== LOAD ===================== */

async function loadEmployeesAndSchedule() {
  // 1. 👇 ADD THIS LINE. Now we know the rules!
const settings = await loadScheduleSettings(true);
checkScheduleSettings(settings);

  const empSnap = await getDocs(
  collection(db, "companies", companyId, "employees")
  );

  employees = empSnap.docs.map(s => {
    const d = s.data();
   return {
  id: s.id,
  name: d.fullName || "Unnamed",
  position: d.position || "",
  birthDate: d.birthDate || null,
  reliability: d.reliability ?? 1,
  shiftType: normalizeShiftType(
    d.shiftType ||
    d.defaultShift ||
    ""
  ),
  defaultShift: d.defaultShift || "",
  normalSchedule: d.normalSchedule || null,
  certifications: Array.isArray(d.certifications) ? d.certifications : []
};
  });
  employeeMap = {};

employees.forEach(emp => {
  employeeMap[emp.id] = emp;
});
  const weekId = scheduleDocId(companyId, selectedWeekStart);
const schedSnap = await getDoc(doc(db, "weekly_schedules", weekId));

scheduleCache = {};
if (schedSnap.exists()) {
  const d = schedSnap.data() || {};
  scheduleCache = d.schedule_data || {};
}


// ensure each employee has a 7-day array
employees.forEach(emp => {
  if (!scheduleCache[emp.id]) scheduleCache[emp.id] = EMPTY_WEEK();
});


const posSelect = $("positionFilter");
if (posSelect) {
  // Union of positions from settings AND from employees
  const settingsPos  = Object.keys((scheduleSettingsCache || {}).positions || {});
  const employeePos  = employees.map(e => normalizePositionName(e.position || "")).filter(Boolean);
  const uniquePositions = [...new Set([...settingsPos, ...employeePos])].sort();

  posSelect.innerHTML = `<option value="">All Positions</option>`;
  uniquePositions.forEach(pos => {
    const opt = document.createElement("option");
    opt.value = pos;
    opt.textContent = pos;
    posSelect.appendChild(opt);
  });
}

 employees.forEach(emp => {
  if (!scheduleCache[emp.id]) {
    scheduleCache[emp.id] = EMPTY_WEEK();
  }
});


renderGrid(scheduleCache);

}

/* ===================== SAVE ===================== */

async function saveSchedule() {
  const data = {};

  document.querySelectorAll(".shift-input").forEach(inp => {
    const emp = inp.dataset.emp;
    const day = Number(inp.dataset.day);

    if (!data[emp]) data[emp] = ["", "", "", "", "", "", ""];
    data[emp][day] = normalizeShift(inp.value);
  });
const minorWarnings = checkMinorHours();
if (minorWarnings.length > 0) {
  alert("Cannot save. Minor hour violations detected.");
  return;
}

  await setDoc(
    doc(db, "weekly_schedules", scheduleDocId(companyId, selectedWeekStart)),
    {
      companyId,
      weekStart: toISODate(selectedWeekStart),
      schedule_data: data,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  scheduleCache = data;
  updateCoverageWarnings();
updateWeekSummary();

  alert("✅ Schedule saved");
}
/* ===================== PUBLISH ===================== */

async function publishSchedule() {
  const btn = document.getElementById("publishScheduleBtn");

  // ── 1. Save first so published copy is always current ──────────────────
  const data = {};
  document.querySelectorAll(".shift-input").forEach(inp => {
    const emp = inp.dataset.emp;
    const day = Number(inp.dataset.day);
    if (!data[emp]) data[emp] = ["", "", "", "", "", "", ""];
    data[emp][day] = normalizeShift(inp.value);
  });

  const minorWarnings = checkMinorHours();
  if (minorWarnings.length > 0) {
    alert("Cannot publish — minor hour violations detected. Fix them first.");
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }

  try {
    const schedRef = doc(db, "weekly_schedules", scheduleDocId(companyId, selectedWeekStart));

    // ── 2. Write schedule + published flag in one setDoc ──────────────────
    await setDoc(schedRef, {
      companyId,
      weekStart:     toISODate(selectedWeekStart),
      schedule_data: data,
      published:     true,
      publishedAt:   serverTimestamp(),
      updatedAt:     serverTimestamp()
    }, { merge: true });

    scheduleCache = data;
    updateCoverageWarnings();
    updateWeekSummary();

    // ── 3. Notify every scheduled employee ───────────────────────────────
    // Re-fetch employees fresh so we get all active IDs
    const empSnap = await getDocs(
      collection(db, "companies", companyId, "employees")
    );

    // Build week label e.g. "May 12 – May 18"
    const weekEnd = new Date(selectedWeekStart);
    weekEnd.setDate(selectedWeekStart.getDate() + 6);
    const fmt = d => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const weekLabel = `${fmt(selectedWeekStart)} – ${fmt(weekEnd)}`;

    const batch = writeBatch(db);
    let notifCount = 0;

    empSnap.forEach(empDoc => {
      const empId = empDoc.id;
      const empData = empDoc.data();

      // Skip inactive employees
      if (empData.isActive === false) return;

      // Skip employees with no shifts this week (all OFF or empty)
      const shifts = data[empId] || [];
      const hasShift = shifts.some(s => s && s.toUpperCase() !== "OFF");
      if (!hasShift) return;

      const notifRef = doc(
        collection(db, "companies", companyId, "notifications")
      );

      batch.set(notifRef, {
        employeeId: empId,
        title:      "📅 Schedule Published",
        message:    `Your schedule for ${weekLabel} is now available. Tap to view your shifts.`,
        type:       "schedule_published",
        status:     "unread",
        read:       false,
        createdAt:  serverTimestamp()
      });

      notifCount++;
    });

    if (notifCount > 0) await batch.commit();

    // ── 4. Update button to show published state ──────────────────────────
    if (btn) {
      btn.textContent  = "✅ Published";
      btn.style.background = "#16a34a";
      setTimeout(() => {
        btn.disabled         = false;
        btn.textContent      = "🚀 Publish Schedule";
        btn.style.background = "";
      }, 3000);
    }

    alert(`✅ Schedule published and ${notifCount} employee${notifCount !== 1 ? "s" : ""} notified.`);

  } catch (err) {
    console.error("publishSchedule error:", err);
    alert("❌ Publish failed. Check console for details.");
    if (btn) { btn.disabled = false; btn.textContent = "🚀 Publish Schedule"; }
  }
}

function fillRemainingCells(auto) {

  Object.keys(auto).forEach(empId => {

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {

      const current = auto[empId][dayIndex];

      // Skip if already assigned
      if (current && current !== "") continue;

      // Count scheduled shifts this week
      const shiftsWorked = auto[empId]
        .filter(v => v && v !== "OFF" && v !== "oncall")
        .length;

      // If they worked less than 3 shifts → on call
      if (shiftsWorked < 3) {
        auto[empId][dayIndex] = "oncall";
      } else {
        auto[empId][dayIndex] = "OFF";
      }

    }

  });

}
/* ===================== AUTO GENERATE ===================== */
async function autoGenerate() {
 const settings = await loadScheduleSettings(true);
  // Approved time off blocks
  const timeOffMap = await getApprovedTimeOff();
  console.log("Approved Time Off Found:", timeOffMap);

  // Coverage rules by position/day (from schedule_settings)
  const rules = settings.positions || {};

  // Required certifications per position (optional field in schedule_settings)
  // Shape: { "Cashier": ["Food Handler"], "Pharmacist": ["PharmD", "BLS"], ... }
  const requiredCerts = settings.requiredCerts || {};

  // Build an empty grid first
  const auto = {};
  employees.forEach((emp) => {
    auto[emp.id] = ["", "", "", "", "", "", ""];
  });

  // Helper: can this employee be scheduled on this day?
 // Helper: can this employee be scheduled on this day?
  const canWork = (emp, dayIndex) => {
    const dayLabel = DAYS[dayIndex];
    if (isEmployeeOff(emp.id, dayIndex, timeOffMap)) return false;
    
    // 1️⃣ Check employee-specific normal schedule bounds
    if (emp.normalSchedule) {
      if (!worksThisDay(emp, dayLabel)) return false;
    } else {
      // 2️⃣ FALLBACK: Check company-wide standard days off from settings configuration
      const companyOffDays = settings?.autoScheduler?.offDays || [];
      if (companyOffDays.includes(dayLabel)) return false;
    }
    
    return true;
  };

  // Helper: does employee hold all certs required for a position?
  const hasCerts = (emp, posName) => {
    const needed = requiredCerts[posName];
    if (!needed || !needed.length) return true; // no cert requirement
    const empCerts = emp.certifications || [];
    return needed.every(c => empCerts.includes(c));
  };

  // Helper: assign the correct label (employee-specific normal shift wins)
  const shiftLabelFor = (emp) => {
  // 1) exact employee normal schedule wins
  const specific = getNormalShift(emp);
  if (specific) return specific;

  // 2) normalize & bucket whatever they have into morning/evening/night
  const raw = (emp.shiftType || emp.defaultShift || "").trim();
  let bucket = normalizeShiftType(raw);

  // If it's not already a bucket word, try converting time strings (9-5 etc)
  if (!["morning", "evening", "night"].includes(bucket)) {
    const b2 = shiftToBucket(bucket);
    if (b2) bucket = b2;
  }

  // 3) use schedule settings time map
  const fromSettings = buildShiftLabel(bucket, settings);
  if (fromSettings) return fromSettings;

  // 4) final fallback so it ALWAYS fills something
  if (bucket === "evening") return "1pm-9pm";
  if (bucket === "night") return "9pm-5am";
  return "9am-5pm";
};

  // 1) Mark OFF everywhere they have approved time off (so it's visible)
  employees.forEach((emp) => {
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      if (isEmployeeOff(emp.id, dayIndex, timeOffMap)) {
        auto[emp.id][dayIndex] = "OFF";
      }
    }
  });

  // 2) Fill ONLY what's required by schedule_settings.positions
  //    (this is the "align" part — the schedule is driven by the positions table)
   DAYS.forEach((dayLabel, dayIndex) => {
    Object.keys(rules).forEach((pos) => {
      const posRules = rules[pos];
      const shifts = Object.keys(posRules);
      // Detect new nested format vs old flat format
      const isNested = shifts.length && typeof posRules[shifts[0]] === "object" && !DAYS.includes(shifts[0]);
      const shiftList = isNested ? shifts : [null]; // null = no shift filter (old format)

      shiftList.forEach((shift) => {
        const need = isNested
          ? Number(posRules[shift]?.[dayLabel]) || 0
          : Number(posRules[dayLabel] ?? 0) || 0;

        if (need <= 0) return;

        let filled = 0;
        const candidates = employees
    .filter(emp =>
  normalizePositionName(emp.position || "General") ===
  normalizePositionName(pos)
)
          .filter(emp => canWork(emp, dayIndex))
          .filter(emp => hasCerts(emp, pos))
          .filter(emp => {
            const cur = auto?.[emp.id]?.[dayIndex] || "";
            return cur === "" || cur === null || cur === undefined;
          })
          .filter(emp => {
            if (!isNested || !shift) return true;
            return shiftToBucket(emp.shiftType || emp.defaultShift || "") === shiftToBucket(shift);
          })
         .sort((a, b) => {
  // Base deterministic operational score
  const scoreA = getWeeklyHours(a.id, auto) + (1 - calculateReliability(a, auto)) * 10;
  const scoreB = getWeeklyHours(b.id, auto) + (1 - calculateReliability(b, auto)) * 10;
  
  // Introduce a random tie-breaker variance (-5 to +5 hours of virtual weight)
  // This shuffles candidates of similar reliability/hours on every single click
  const randomFactor = (Math.random() - 0.5) * 10;
  
  return (scoreA - scoreB) + randomFactor;
});

        for (const emp of candidates) {
          if (filled >= need) break;
          const age = calculateAge(emp.birthDate);
          if (age !== null && age < 18) console.log(`${emp.name} is a minor (${age})`);
          const label = shiftLabelFor(emp);
          if (!label) continue;
          const tempHours = getHoursFromShift(label);
          const currentWeek = auto[emp.id].reduce((sum, s) => sum + getHoursFromShift(s), 0);
          if (age !== null && age < 18 && (currentWeek + tempHours > 40)) continue;
          if (hasInsufficientRest(emp.id, dayIndex, label, auto)) {
            console.log(`Blocking shift for ${emp.id} on Day ${dayIndex}`);
            continue;
          }
          if (!auto[emp.id][dayIndex]) auto[emp.id][dayIndex] = label;
          filled++;
        }

        if (filled < need) {
          console.warn(`AutoGenerate: could not fully cover ${pos}${shift ? "/" + shift : ""} on ${dayLabel}. Need ${need}, filled ${filled}.`);
        }
      });
    });
  });
// Fill remaining blank cells
fillRemainingCells(auto);

// Apply approved shift swaps for this week
const swapMap = await getApprovedSwaps();
applySwapsToGrid(auto, swapMap);

// Save to Firebase
const weekId = scheduleDocId(companyId, selectedWeekStart);
  await setDoc(doc(db, "weekly_schedules", weekId), {
    companyId,
    weekStart: toISODate(selectedWeekStart),
    schedule_data: auto,
    updatedAt: serverTimestamp()
  }, { merge: true });

 scheduleCache = auto;
renderGrid(auto);
updateCoverageWarnings();   // <-- force refresh
updateWeekSummary();        // <-- force summary update
alert("Process Complete.");

}

/* ===================== CONTROLS ===================== */
document.getElementById("printScheduleBtn")?.addEventListener("click", () => {
  setPrintHeader();   // fill company + week
  window.print();    // then print
});

$("saveScheduleBtn")?.addEventListener("click", saveSchedule);
$("publishScheduleBtn")?.addEventListener("click", publishSchedule);
$("autoGenerateBtn")?.addEventListener("click", autoGenerate);

$("btnGoWeek")?.addEventListener("click", goToWeek);
$("positionFilter")?.addEventListener("change", (e) => {
  activePositionFilter = e.target.value ? normalizePositionName(e.target.value) : "";
  renderGrid(scheduleCache);
});


$("shiftFilter")?.addEventListener("change", (e) => {
  activeShiftFilter = e.target.value; // DO NOT normalize here
  renderGrid(scheduleCache);
});

function isEmployeeOff(empId, dayIndex, timeOffMap) {
  if (!timeOffMap || !timeOffMap[empId]) return false;

  const checkDate = new Date(selectedWeekStart);
  checkDate.setDate(selectedWeekStart.getDate() + dayIndex);
  checkDate.setHours(0, 0, 0, 0);

  const isOff = timeOffMap[empId].some(range => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    return checkDate >= start && checkDate <= end;
  });

  if (isOff) console.log(`Blocking shift for ${empId} on Day ${dayIndex}`);
  return isOff;
}
function updateWeekSummary() {
  if (!employees.length) return;

  const coverageEl = document.getElementById("coverageScore");
  const qualityEl = document.getElementById("weekQuality");

  const hoursEl = document.getElementById("totalHours");
  const minorEl = document.getElementById("minorStatus");
  const restEl = document.getElementById("restStatus");

  if (!coverageEl) return;

  const settings = scheduleSettingsCache || {};
  const rules = settings.positions || {};

  let totalRequired = 0;
  let totalFilled = 0;
  let totalHours = 0;
  let restViolations = 0;

  // 🔥 MOVE THIS HERE
  const minorWarnings = checkMinorHours();


  employees.forEach(emp => {
    (scheduleCache[emp.id] || []).forEach((shift, dayIndex) => {
      // Use our updated hour calculator directly
      const shiftHours = getHoursFromShift(shift);
      
      if (shiftHours > 0) {
        totalHours += shiftHours;

        if (hasInsufficientRest(emp.id, dayIndex, shift, scheduleCache)) {
          restViolations++;
        }
      }
    });
  });

   DAYS.forEach((dayLabel, i) => {
    Object.keys(rules).forEach(pos => {
      const posRules = rules[pos];
      // Support both new nested { shift: { day: n } } and old flat { day: n }
      const isNested = posRules && typeof Object.values(posRules)[0] === "object" &&
                       !DAYS.includes(Object.keys(posRules)[0]);
      if (isNested) {
        Object.keys(posRules).forEach(shift => {
          const need = Number(posRules[shift]?.[dayLabel]) || 0;
          totalRequired += need;
          const have = employees.filter(emp =>
            normalizePositionName(emp.position || "") === normalizePositionName(pos) &&
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
          normalizePositionName(emp.position || "") === normalizePositionName(pos) &&
          scheduleCache[emp.id]?.[i] &&
          scheduleCache[emp.id][i].toUpperCase() !== "OFF"
        ).length;
        totalFilled += Math.min(have, need);
      }
    });
  });
  const coveragePercent = totalRequired
    ? Math.round((totalFilled / totalRequired) * 100)
    : 100;

coverageEl.textContent = coveragePercent + "%";
hoursEl.textContent = totalHours.toFixed(1) + " hrs";

// Coverage color logic
coverageEl.style.color =
  coveragePercent >= 95 ? "#16a34a" :
  coveragePercent >= 80 ? "#f59e0b" :
  "#dc2626";


// Rest color logic
restEl.textContent = restViolations === 0
  ? "Good"
  : restViolations + " Issues";

restEl.style.color =
  restViolations === 0 ? "#16a34a" : "#dc2626";


  restEl.textContent = restViolations === 0
    ? "Good"
    : restViolations + " Issues";
    // Week quality assessment
if (qualityEl) {
  if (coveragePercent >= 95 && minorWarnings.length === 0 && restViolations === 0) {
    qualityEl.textContent = "🔥 Strong Week";
    qualityEl.style.color = "#16a34a";
  } else if (coveragePercent >= 80) {
    qualityEl.textContent = "⚠ Needs Attention";
    qualityEl.style.color = "#f59e0b";
  } else {
    qualityEl.textContent = "❌ Understaffed Risk";
    qualityEl.style.color = "#dc2626";
  }
}

}
function checkBurnoutRisk() {

  const warnings = [];

  employees.forEach(emp => {
    const shifts = scheduleCache[emp.id] || [];
    let streak = 0;
    let maxStreak = 0;
    let weeklyHours = 0;

    const treatOnCallAsRisk = scheduleSettingsCache?.autoScheduler?.onCallOvertimeRisk ?? false;

    shifts.forEach((shift) => {
      const hours = getHoursFromShift(shift);
      weeklyHours += hours;

      // Determine if this specific shift counts as a consecutive working day
      let isWorkingDay = shift && shift.toUpperCase() !== "OFF";
      if (shift.toLowerCase() === "oncall" && !treatOnCallAsRisk) {
        isWorkingDay = false; // Ignore on-call for streaks if toggle is off
      }

      if (isWorkingDay) {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    });

    // Warn once for burnout streaks
    if (maxStreak >= 5) {
      warnings.push(`⚠ ${emp.name} scheduled ${maxStreak} days in a row`);
    }

    const threshold = scheduleSettingsCache?.autoScheduler?.burnoutThreshold ?? 40;
    if (weeklyHours >= threshold * 0.9 && weeklyHours < threshold) {
      warnings.push(`⚠ ${emp.name} approaching overtime (${weeklyHours.toFixed(1)}h)`);
    }
    if (weeklyHours >= threshold) {
      warnings.push(`🚨 ${emp.name} overtime risk (${weeklyHours.toFixed(1)}h)`);
    }
  });

  return warnings;
}
function updateCoverageWarnings() {
  const strip = document.getElementById("coverageStrip");
  if (!strip) return;

  strip.innerHTML = "";

  const settings = scheduleSettingsCache || {};
  const rules = settings.positions || {};
  if (!Object.keys(rules).length) return;

  const minorWarnings = checkMinorHours(); // 🔥 ADD THIS
const burnoutWarnings = checkBurnoutRisk();
const MAX_WARNINGS = 10;

const limitedMinor = minorWarnings.slice(0, MAX_WARNINGS);
const limitedBurnout = burnoutWarnings.slice(0, MAX_WARNINGS);
  const counts = {};

  // Count coverage
  employees.forEach(emp => {
   const pos = String(emp.position || "General").trim();

    if (!counts[pos]) counts[pos] = [0,0,0,0,0,0,0];

    (scheduleCache[emp.id] || []).forEach((shift, day) => {
      if (shift && String(shift).toUpperCase() !== "OFF") {
        counts[pos][day]++;
      }
    });
  });

  // Build day buttons
  DAYS.forEach((day, i) => {
  let gaps = 0;
  Object.keys(rules).forEach(pos => {
    const posRules = rules[pos];
    const posKeys = Object.keys(posRules);
    const isNested = posKeys.length && typeof posRules[posKeys[0]] === "object" && !DAYS.includes(posKeys[0]);

    if (isNested) {
      posKeys.forEach(shift => {
        const need = Number(posRules[shift]?.[day]) || 0;
        const have = employees.filter(emp =>
          normalizePositionName(emp.position || "") === normalizePositionName(pos) &&
          scheduleCache[emp.id]?.[i] &&
          scheduleCache[emp.id][i].toUpperCase() !== "OFF" &&
          shiftToBucket(scheduleCache[emp.id][i]) === shiftToBucket(shift)
        ).length;
        if (have < need) gaps++;
      });
    } else {
      const need = Number(posRules[day]) || 0;
      const have = employees.filter(emp =>
        normalizePositionName(emp.position || "") === normalizePositionName(pos) &&
        scheduleCache[emp.id]?.[i] &&
        scheduleCache[emp.id][i].toUpperCase() !== "OFF"
      ).length;
      if (have < need) gaps++;
    }
  });

    const btn = document.createElement("button");
    btn.textContent = day;
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "6px";
    btn.style.border = "none";
    btn.style.cursor = "pointer";

    if (gaps === 0) {
      btn.style.background = "#16a34a"; // green
      btn.style.color = "white";
    } else {
      btn.style.background = "#dc2626"; // red
      btn.style.color = "white";
      btn.textContent = `${day} (${gaps})`;
    }

    btn.onclick = () => showCoverageDetails(day, i, rules, counts);
    strip.appendChild(btn);
    // 🔴 Highlight illegal minor shifts
document.querySelectorAll(".shift-input").forEach(input => {
  const empId = input.dataset.emp;
  const dayIndex = Number(input.dataset.day);
const emp = employeeMap[empId];

if (!emp) {
  console.error("Employee not found:", empId);
  return;
}  if (!emp) return;

  const age = calculateAge(emp.birthDate);
  const hours = getHoursFromShift(input.value);

  // Reset first
  input.style.border = "";
  input.style.background = "";

  if (age && age < 18 && hours > 8) {
    input.style.border = "2px solid #b91c1c";
    input.style.background = "#ffe5e5";
  }
});

  });
// 🔴 Minor Hour Warnings & Collapsible Header
  const alertBox = document.getElementById("coverageAlerts");
  if (!alertBox) return;
  
  alertBox.innerHTML = "";

  // Only render the warning frame if there are actual violations to show
  if (limitedMinor.length === 0 && limitedBurnout.length === 0) {
    alertBox.style.display = "none";
    return;
  }

  alertBox.style.display = "block";

  // Create the main collapsible header row
  const headerRow = document.createElement("div");
  headerRow.className = "warnings-main-header";
  headerRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(220, 38, 38, 0.2);";
  
  headerRow.innerHTML = `
    <span style="font-weight: 800; font-size: 0.85rem; color: #dc2626; text-transform: uppercase; letter-spacing: 0.05em;">
       Schedule Conflicts & Compliance Warnings
    </span>
    <button id="toggleWarningsBtn" type="button" style="background: rgba(220, 38, 38, 0.1); border: 1px solid rgba(220, 38, 38, 0.3); color: #dc2626; padding: 2px 8px; font-size: 0.72rem; font-weight: 700; border-radius: 4px; cursor: pointer;">
      Minimize
    </button>
  `;
  alertBox.appendChild(headerRow);

  // Wrapper for the collapsible alert items
  const itemsContainer = document.createElement("div");
  itemsContainer.id = "warningsItemsContainer";
  
  // Check localStorage to remember if the user preferred it minimized
  if (localStorage.getItem("warnings-minimized") === "true") {
    itemsContainer.style.display = "none";
    headerRow.querySelector("#toggleWarningsBtn").textContent = "Expand";
  } else {
    itemsContainer.style.display = "block";
  }

  alertBox.appendChild(itemsContainer);

  function buildGroup(title, items){
    if(items.length === 0) return;

    const group = document.createElement("div");
    group.className = "alert-group";

    const header = document.createElement("div");
    header.className = "alert-header";
    header.textContent = `${title} (${items.length})`;

    const list = document.createElement("div");
    list.className = "alert-items";

    items.forEach(msg=>{
      const div = document.createElement("div");
      div.textContent = msg;
      list.appendChild(div);
    });

    header.onclick = ()=>{
      list.style.display =
        list.style.display === "block" ? "none" : "block";
    };

    group.appendChild(header);
    group.appendChild(list);
    itemsContainer.appendChild(group); // 👈 Append to the wrapper container instead of the main box
  };

  buildGroup("🚨 Minor Violations", limitedMinor);
  buildGroup("⚠ Burnout Risk", limitedBurnout);

  // Wire up the minimize/expand toggle action
  headerRow.querySelector("#toggleWarningsBtn").onclick = (e) => {
    const btn = e.target;
    if (itemsContainer.style.display === "none") {
      itemsContainer.style.display = "block";
      btn.textContent = "Minimize";
      localStorage.setItem("warnings-minimized", "false");
    } else {
      itemsContainer.style.display = "none";
      btn.textContent = "Expand";
      localStorage.setItem("warnings-minimized", "true");
    }
  };
// ===== UPDATE SUMMARY PANEL =====
updateWeekSummary();
}

function showCoverageDetails(dayName, dayIndex, rules, counts) {
  let msg = `${dayName} coverage:\n\n`;
  let anyGap = false;

  Object.keys(rules).forEach(pos => {
    const posRules = rules[pos];
    const shifts = Object.keys(posRules);
    const isNested = shifts.length && typeof posRules[shifts[0]] === "object" && !DAYS.includes(shifts[0]);

    if (isNested) {
      shifts.forEach(shift => {
        const need = Number(posRules[shift]?.[dayName]) || 0;
        const have = employees.filter(emp =>
          normalizePositionName(emp.position || "") === normalizePositionName(pos) &&
          shiftToBucket(scheduleCache[emp.id]?.[dayIndex] || "") === shiftToBucket(shift)
        ).length;
        if (have < need) {
          msg += `❌ ${pos} (${shift}): need ${need}, have ${have}\n`;
          anyGap = true;
        }
      });
    } else {
      const need = Number(posRules[dayName]) || 0;
      const have = counts[pos]?.[dayIndex] || 0;
      if (have < need) {
        msg += `❌ ${pos}: need ${need}, have ${have}\n`;
        anyGap = true;
      }
    }
  });

  if (!anyGap) msg += "✅ All positions covered!";
  alert(msg);
}
// ===============================
// CLOSE MENUS WHEN CLICK OUTSIDE
// ===============================
document.addEventListener("click", function (e) {

  const ctxMenu = document.getElementById("ctxMenu");
  const confirmBox = document.getElementById("confirmClearBox");

  // 1️⃣ Close right-click context menu
  if (ctxMenu && ctxMenu.style.display === "block") {
    if (!ctxMenu.contains(e.target)) {
      ctxMenu.style.display = "none";
    }
  }

  // 2️⃣ Close confirm clear box
  if (confirmBox && !confirmBox.classList.contains("hidden")) {
    if (!confirmBox.contains(e.target)) {
      confirmBox.classList.add("hidden");
    }
  }


});
const params = new URLSearchParams(window.location.search);
const page = params.get("page");

if (page) {
  const navItem = document.querySelector(`[onclick*="${page}"]`);

}
async function loadScheduleForHub() {

  const scheduleRef = doc(db,
    "companies",
    companyId,
    "schedules",
    currentWeekId
  );

  const snap = await getDoc(scheduleRef);

  if (!snap.exists()) return;

 const scheduleData = normalizeSchedule(
  snap.data().schedule_data || {}
);

  buildScheduleHub(scheduleData, employees);
}
// ===================== CLEAR ALL =====================
$("clearAllBtn")?.addEventListener("click", () => {
  if (!employees.length) return;

  const ok = confirm("Clear all shifts for this week? This cannot be undone until you save.");
  if (!ok) return;

  employees.forEach(emp => {
    scheduleCache[emp.id] = ["", "", "", "", "", "", ""];
  });

  renderGrid(scheduleCache);
});