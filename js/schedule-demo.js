// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}

/* ===================== DEMO DATA ===================== */
const DEMO_COMPANY_ID = "demo_company_001";

const DEMO_EMPLOYEES = [
  { id: "emp_1", fullName: "Alice Supervisor", position: "Manager", birthDate: "1985-05-10", shiftType: "morning", isActive: true, certifications: ["Food Handler", "Manager"] },
  { id: "emp_2", fullName: "Bob Cashier", position: "Cashier", birthDate: "1998-11-22", shiftType: "morning", isActive: true, certifications: ["Food Handler"] },
  { id: "emp_3", fullName: "Charlie Minor", position: "Cashier", birthDate: "2010-02-14", shiftType: "evening", isActive: true, certifications: [] }, // Minor
  { id: "emp_4", fullName: "Diana Night", position: "Stocker", birthDate: "1995-08-30", shiftType: "night", isActive: true, certifications: [] }
];

const DEMO_SETTINGS = {
  positions: {
    Manager: { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 0, Sun: 0 },
    Cashier: { Mon: 2, Tue: 2, Wed: 2, Thu: 2, Fri: 2, Sat: 2, Sun: 2 },
    Stocker: { Mon: 1, Tue: 1, Wed: 1, Thu: 1, Fri: 1, Sat: 1, Sun: 1 }
  },
  partOfDayTimes: { morning: "9am-5pm", evening: "1pm-9pm", night: "9pm-5am" },
  requiredCerts: { Manager: ["Manager"] }
};

const DEMO_SCHEDULE = {
  emp_1: ["9am-5pm", "9am-5pm", "9am-5pm", "9am-5pm", "9am-5pm", "OFF", "OFF"],
  emp_2: ["9am-5pm", "9am-5pm", "OFF", "9am-5pm", "9am-5pm", "9am-5pm", "OFF"],
  emp_3: ["OFF", "4pm-9pm", "4pm-9pm", "OFF", "4pm-9pm", "1pm-9pm", "OFF"],
  emp_4: ["9pm-5am", "9pm-5am", "9pm-5am", "9pm-5am", "9pm-5am", "OFF", "OFF"]
};

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

console.log("✅ schedule.js loaded (Demo Mode)");

function toISODate(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function normalizePositionName(name) {
  return String(name || "").trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
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
  const weekStart = new Date(weekStartStr + "T00:00:00");
  const date = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((date - weekStart) / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > 6) return null;
  return diffDays; 
}

function canAssignManually(emp, dayIndex) {
  if (!emp) return false;
  return true;
}

function normalizeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  return new Date(d); 
}

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

function getHoursFromShift(shift) {
  if (shift === "oncall") return 0;
  if (!shift || shift.toUpperCase() === "OFF") return 0;
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
  const specific = getNormalShift(emp);
  if (specific) return specific;

  const settings = scheduleSettingsCache || {};
  const shiftType = normalizeShiftType(emp.shiftType || emp.defaultShift || "");

  if (settings.partOfDayTimes && settings.partOfDayTimes[shiftType]) {
    return settings.partOfDayTimes[shiftType];
  }

  if (shiftType === "morning") return "9am-5pm";
  if (shiftType === "evening") return "1pm-9pm";
  if (shiftType === "night") return "9pm-5am";

  return "9am-5pm";
}

function shiftToBucket(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (["morning", "evening", "night"].includes(s)) return s;
  if (s === "afternoon") return "evening";

  if (s.includes("7am-3pm") || s.includes("9am-5pm") || s.includes("10am-6pm")) return "morning";
  if (s.includes("3pm-11pm") || s.includes("1pm-9pm")) return "evening";
  if (s.includes("11pm-7am") || s.includes("9pm-5am")) return "night";

  const timesMap = scheduleSettingsCache?.partOfDayTimes || {};
  for (const [bucket, timeStr] of Object.entries(timesMap)) {
    if (timeStr && s === String(timeStr).trim().toLowerCase()) return bucket;
  }
  return s;
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
      warnings.push(`🚨 ${emp.name} exceeds weekly limit by ${over} hours (${weeklyTotal.toFixed(1)}h total)`);
    }
  });
  return warnings;
}

function applyOffStyle(inputEl) {
  const v = (inputEl.value || "").toLowerCase();
  inputEl.classList.remove("off-duty");
  inputEl.classList.remove("oncall");
  if (v === "off") inputEl.classList.add("off-duty");
  if (v === "oncall") inputEl.classList.add("oncall");
}

function setCellValue(empId, dayIndex, inputEl, value) {
  if (!scheduleCache[empId]) scheduleCache[empId] = ["","","","","","",""];
  const emp = employeeMap[empId];
  if (!emp) return;

  if (!canAssignManually(emp, dayIndex)) {
    alert("Cannot assign On-Call or shifts on requested time off.");
    return;
  }

  const v = normalizeShift(value);
  scheduleCache[empId][dayIndex] = v;
  inputEl.value = v;
  applyOffStyle(inputEl);
  updateCoverageWarnings();
}

function setPrintHeader() {
  const companyName = document.getElementById("companyName")?.textContent || "Demo Company";
  const printCompany = document.getElementById("printCompanyName");
  if (printCompany) printCompany.textContent = companyName;

  const start = new Date(selectedWeekStart);
  const end = new Date(selectedWeekStart);
  end.setDate(end.getDate() + 6);

  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekText = `${fmt(start)} – ${fmt(end)}`;

  const printWeek = document.getElementById("printWeekRange");
  if (printWeek) printWeek.textContent = weekText;
}

/* ===================== STATE ===================== */
let companyId = DEMO_COMPANY_ID;
let employees = [];
let employeeMap = {};
let selectedWeekStart = mondayOf(new Date());
let scheduleCache = {};
let activePositionFilter = "";
let activeShiftFilter = "all";
let scheduleSettingsCache = null;
let holdTimer = null;

const SHIFT_HOUR_MAP = {
  morning: { start: 9, end: 17 },
  afternoon: { start: 13, end: 21 },
  evening: { start: 13, end: 21 },
  night: { start: 21, end: 5 }
};

function hasInsufficientRest(empId, dayIndex, shiftType, auto) {
  if (dayIndex === 0) return false;
  const prevShiftRaw = auto[empId]?.[dayIndex - 1];
  if (!prevShiftRaw) return false;

  const prevKey = shiftToBucket(prevShiftRaw) || prevShiftRaw;
  const curKey  = shiftToBucket(shiftType)    || shiftType;
  const prev    = SHIFT_HOUR_MAP[prevKey];
  const current = SHIFT_HOUR_MAP[curKey];

  if (!prev || !current) return false;

  let prevEnd = prev.end;
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

/* ===================== DATA LOADERS (MOCKED) ===================== */
async function loadScheduleSettings(forceRefresh = false) {
  scheduleSettingsCache = DEMO_SETTINGS;
  return scheduleSettingsCache;
}

function checkScheduleSettings(settings){
  const warn = document.getElementById("scheduleSettingsWarning");
  if(!warn) return;
  warn.classList.add("hidden"); // Always hidden in demo
}

async function getApprovedSwaps() {
  return {}; // No demo swaps
}

async function getApprovedTimeOff() {
  return {}; // No demo time off
}

function applySwapsToGrid(auto, swapMap) {
  // Logic retained but inactive due to empty swapMap
}

/* ===================== GRID RENDER ===================== */
function renderGrid(data = {}) {
  const table = document.getElementById("scheduleTableBody");
  if (!table) return;
  table.innerHTML = "";

  const settings = scheduleSettingsCache || {};
  const posRules = settings.positions || {};  
  const settingsPositions = Object.keys(posRules).sort();
  const empPositions = [...new Set(employees.map(e => normalizePositionName(e.position || "")).filter(Boolean))];
  const allPositions = [...new Set([...settingsPositions, ...empPositions])].sort();

  const byPosition = {};
  allPositions.forEach(p => (byPosition[p] = []));
  employees.forEach(emp => {
    const pos = normalizePositionName(emp.position || "");
    if (!byPosition[pos]) byPosition[pos] = [];
    byPosition[pos].push(emp);
  });

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
      const td = document.createElement("td");
      td.className = "cell";
      const box = document.createElement("div");
      box.className = "cellBox";
      const input = document.createElement("input");
      input.className = "shift-input";
      input.dataset.emp = emp.id;
      input.dataset.day = i;
      input.type = window.innerWidth < 768 ? "button" : "text";
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

      input.addEventListener("dblclick", () => {
        if (!input.value) return;
        const rect = input.getBoundingClientRect();
        if(confirmBox) {
            confirmBox.style.top = `${rect.bottom + window.scrollY + 5}px`;
            confirmBox.style.left = `${rect.left + window.scrollX}px`;
            confirmBox.classList.remove("hidden");
            confirmYes.onclick = () => { setCellValue(emp.id, i, input, ""); confirmBox.classList.add("hidden"); };
            confirmNo.onclick = () => { confirmBox.classList.add("hidden"); };
        }
      });
    }
    return tr;
  }

  function buildPositionHeaderRow(posName) {
    const rules = posRules[posName] || {};
    const tr = document.createElement("tr");
    tr.style.cssText = "background:var(--pos-header-bg, rgba(37,99,235,.06)); border-top:2px solid var(--border, #e2e8f4);";

    const labelTd = document.createElement("td");
    labelTd.style.cssText = "padding:6px 10px; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:var(--accent,#2563eb); white-space:nowrap;";
    labelTd.textContent = posName;
    tr.appendChild(labelTd);

    for (let i = 0; i < 7; i++) {
      const dayLabel = DAYS[i];
      const td = document.createElement("td");
      td.style.cssText = "padding:4px 6px; text-align:center; font-size:.70rem;";
      
      let totalNeeded = Number(rules[dayLabel]) || 0;
      const scheduled = employees.filter(emp => {
        if (normalizePositionName(emp.position || "") !== posName) return false;
        const shift = (data[emp.id] || [])[i] || "";
        return shift && String(shift).toUpperCase() !== "OFF" && shift !== "oncall";
      }).length;

      if (totalNeeded > 0) {
        const met = scheduled >= totalNeeded;
        td.innerHTML = `<span style="display:inline-block; padding:1px 6px; border-radius:100px; font-weight:700; background:${met ? "var(--green-bg,#dcfce7)" : "var(--red-bg,#fee2e2)"}; color:${met ? "var(--green,#16a34a)" : "var(--red,#dc2626)"};">${scheduled}/${totalNeeded}</span>`;
      }
      tr.appendChild(td);
    }
    return tr;
  }

  let anyRendered = false;

  allPositions.forEach(posName => {
    if (activePositionFilter && posName !== activePositionFilter) return;
    const posEmployees = (byPosition[posName] || []).filter(emp => {
      if (activeShiftFilter !== "all") {
        return normalizeShiftType(emp.shiftType || "") === activeShiftFilter;
      }
      return true;
    });

    const hasRules = !!posRules[posName];
    if (!posEmployees.length && !hasRules) return;

    table.appendChild(buildPositionHeaderRow(posName));

    if (posEmployees.length) {
      posEmployees.forEach(emp => table.appendChild(buildEmpRow(emp)));
    }
    anyRendered = true;
  });

  if (!anyRendered) {
    const emptyTr = document.createElement("tr");
    const emptyTd = document.createElement("td");
    emptyTd.colSpan = 8;
    emptyTd.textContent = "No employees found.";
    emptyTr.appendChild(emptyTd);
    table.appendChild(emptyTr);
  }

  updateCoverageWarnings();
}

/* ===================== CONTEXT MENU ===================== */
const ctxMenu = document.getElementById("ctxMenu");
let ctxCell = null;

function showCtxMenu(x, y, cell, event) {
  if(!ctxMenu) return;
  ctxCell = cell;
  ctxMenu.style.display = "block";
  ctxMenu.style.position = "fixed";
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top = y + "px";
  if (event) event.stopPropagation();
}

function hideCtxMenu() {
  if(!ctxMenu) return;
  ctxMenu.style.display = "none";
  ctxCell = null;
}

document.addEventListener("click", hideCtxMenu);

if(ctxMenu) {
    ctxMenu.addEventListener("click", (e) => {
    const action = e.target.dataset.action;
    if (!action || !ctxCell) return;
    const { empId, dayIndex, input } = ctxCell;

    if (action === "normal") {
        const emp = employeeMap[empId];
        if (!emp) return;
        const value = getNormalLabelForEmp(emp) || "";
        setCellValue(empId, dayIndex, input, value);
    }
    if (action === "oncall") setCellValue(empId, dayIndex, input, "oncall");
    if (action === "off") setCellValue(empId, dayIndex, input, "OFF");
    if (action === "clear") input.value = "";

    scheduleCache[empId][dayIndex] = input.value;
    applyOffStyle(input);
    updateCoverageWarnings();
    hideCtxMenu();
    });
}

/* ===================== INIT DEMO ===================== */
async function loadEmployeesAndSchedule() {
  const settings = await loadScheduleSettings(true);
  checkScheduleSettings(settings);

  employees = DEMO_EMPLOYEES.map(d => ({
    id: d.id,
    name: d.fullName || "Unnamed",
    position: d.position || "",
    birthDate: d.birthDate || null,
    reliability: 1,
    shiftType: normalizeShiftType(d.shiftType || ""),
    defaultShift: d.shiftType || "",
    normalSchedule: null,
    certifications: d.certifications || []
  }));

  employeeMap = {};
  employees.forEach(emp => { employeeMap[emp.id] = emp; });

  scheduleCache = JSON.parse(JSON.stringify(DEMO_SCHEDULE));

  employees.forEach(emp => {
    if (!scheduleCache[emp.id]) {
      scheduleCache[emp.id] = EMPTY_WEEK();
    }
  });

  const posSelect = $("positionFilter");
  if (posSelect) {
    const settingsPos = Object.keys(settings.positions || {});
    const employeePos = employees.map(e => normalizePositionName(e.position || "")).filter(Boolean);
    const uniquePositions = [...new Set([...settingsPos, ...employeePos])].sort();

    posSelect.innerHTML = `<option value="">All Positions</option>`;
    uniquePositions.forEach(pos => {
      const opt = document.createElement("option");
      opt.value = pos;
      opt.textContent = pos;
      posSelect.appendChild(opt);
    });
  }

  renderGrid(scheduleCache);
  updateWeekSummary();
}

/* ===================== SAVE & PUBLISH (MOCKED) ===================== */
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

  scheduleCache = data;
  updateCoverageWarnings();
  updateWeekSummary();
  console.log("Mock Saved Data:", scheduleCache);
  alert("✅ Schedule saved (Demo Mode)");
}

async function publishSchedule() {
  const btn = document.getElementById("publishScheduleBtn");
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

  setTimeout(() => {
    scheduleCache = data;
    updateCoverageWarnings();
    updateWeekSummary();
    console.log("Mock Published Data:", scheduleCache);

    if (btn) {
      btn.textContent = "✅ Published";
      btn.style.background = "#16a34a";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "🚀 Publish Schedule";
        btn.style.background = "";
      }, 3000);
    }
    alert(`✅ Schedule published (Demo Mode)`);
  }, 1000);
}

/* ===================== EVENT LISTENERS ===================== */
$("saveScheduleBtn")?.addEventListener("click", saveSchedule);
$("publishScheduleBtn")?.addEventListener("click", publishSchedule);

$("positionFilter")?.addEventListener("change", (e) => {
  activePositionFilter = e.target.value ? normalizePositionName(e.target.value) : "";
  renderGrid(scheduleCache);
});

$("shiftFilter")?.addEventListener("change", (e) => {
  activeShiftFilter = e.target.value; 
  renderGrid(scheduleCache);
});

/* ===================== SUMMARY UPDATES ===================== */
function updateWeekSummary() {
  if (!employees.length) return;
  const coverageEl = document.getElementById("coverageScore");
  const hoursEl = document.getElementById("totalHours");
  const minorWarnings = checkMinorHours();
  let totalHours = 0;

  employees.forEach(emp => {
    (scheduleCache[emp.id] || []).forEach((shift) => {
      if (shift && String(shift).toUpperCase() !== "OFF") {
        totalHours += getHoursFromShift(shift);
      }
    });
  });

  if(hoursEl) hoursEl.textContent = totalHours.toFixed(1) + " hrs";
  if(coverageEl) coverageEl.textContent = "100%"; // Mocked coverage for demo
}

function updateCoverageWarnings() {
  // Logic retained to support UI elements if present in DOM
}

// Bootstrap the App
loadEmployeesAndSchedule();