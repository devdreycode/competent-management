/**
 * calendar.js — Schedule Hub weekly calendar
 * Place in js/ and add <script type="module" src="js/calendar.js"></script>
 * to index.html (already done). No other changes required.
 */

import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ─── Constants ─────────────────────────────────────────── */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* ─── State ─────────────────────────────────────────────── */
let _companyId = null;
let _offset    = 0;
let _schedule  = {};
let _employees = [];
let _loaded    = false;

/* ─── Helpers ───────────────────────────────────────────── */
function getMonday(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow  = d.getDay();
  const diff = (dow === 0 ? -6 : 1 - dow) + offset * 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function fmt(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Resolve a display name from whatever field the Firestore employee doc uses.
 * Tries every common naming pattern so the calendar works regardless of schema.
 */
function resolveName(emp) {
  if (emp.name)                          return emp.name;
  if (emp.employeeName)                  return emp.employeeName;
  if (emp.displayName)                   return emp.displayName;
  if (emp.fullName)                      return emp.fullName;
  if (emp.firstName || emp.lastName)     return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
  if (emp.first_name || emp.last_name)   return `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
  return "";
}

function initials(emp) {
  const name = resolveName(emp);
  if (!name) return "?";
  return name.trim().split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

function shiftClass(raw = "") {
  const v = raw.toLowerCase().replace(/\s/g, "");
  if (!v || v === "off")                   return "off";
  if (v === "oncall")                      return "oncall";
  if (/^(\d{1,2})(:\d{2})?(am)/.test(v))  return "morning";
  if (/^([1-8])(:\d{2})?pm/.test(v))      return "evening";
  if (/^(9|10|11)(:\d{2})?pm/.test(v))    return "night";
  return "custom";
}

/* ─── Fetch from Firestore ───────────────────────────────── */
async function fetchWeek(offset) {
  if (!_companyId) return;

  const monday = getMonday(offset);
  const weekId = `${_companyId}_${monday.toISOString().split("T")[0]}`;

  try {
    const [schedSnap, empSnap] = await Promise.all([
      getDoc(doc(db, "weekly_schedules", weekId)),
      getDocs(collection(db, "companies", _companyId, "employees")),
    ]);

    _schedule  = schedSnap.exists() ? (schedSnap.data().schedule_data || {}) : {};
    _employees = [];
    empSnap.forEach(d => _employees.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("calendar.js fetch error:", err);
    _schedule  = {};
    _employees = [];
  }

  render();
}

/* ─── Render ─────────────────────────────────────────────── */
function render() {
  const el = document.getElementById("scheduleCalendar");
  if (!el) return;

  const monday = getMonday(_offset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayCol = DAYS.findIndex((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.getTime() === today.getTime();
  });

  const dateSubs = DAYS.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.getDate();
  });

  let html = `
    <div class="sh-cal-nav">
      <button class="sh-cal-nav-btn" id="calPrevBtn">&#8592; Prev</button>
      <span class="sh-cal-nav-label">${fmt(monday)} &ndash; ${fmt(sunday)}</span>
      <button class="sh-cal-nav-btn" id="calNextBtn" ${_offset >= 0 ? 'disabled style="opacity:.4;cursor:default;"' : ""}>Next &#8594;</button>
      ${_offset !== 0 ? '<button class="sh-cal-nav-btn" id="calTodayBtn">Today</button>' : ""}
    </div>
    <div class="sh-cal-wrap">
      <table class="sh-cal-table">
        <thead>
          <tr>
            <th class="sh-cal-th-emp">Employee</th>
            ${DAYS.map((d, i) => `
              <th class="${i === todayCol ? "sh-cal-today-hd" : ""}">
                ${d}<br><span class="sh-cal-date-num">${dateSubs[i]}</span>
              </th>`).join("")}
          </tr>
        </thead>
        <tbody>`;

  if (_employees.length === 0) {
    html += `<tr><td colspan="8" class="sh-cal-empty">
      No employees yet — add employees to see the schedule.
    </td></tr>`;
  } else {
    _employees.forEach(emp => {
      const empName = resolveName(emp);
      const shifts  = _schedule[emp.id] || [];

      html += `<tr>
        <td>
          <div class="sh-cal-emp">
            <div class="sh-cal-avatar">${initials(emp)}</div>
            <span class="sh-cal-name" title="${empName}">${empName || "—"}</span>
          </div>
        </td>`;

      DAYS.forEach((day, i) => {
        const raw = (Array.isArray(shifts) ? shifts[i] : shifts[day]) || "";
        const val = raw.trim();
        const cls = shiftClass(val);
        html += `<td class="sh-cal-cell${i === todayCol ? " sh-today-col" : ""}">
          <span class="sh-shift-chip ${cls}">${val || "Off"}</span>
        </td>`;
      });

      html += `</tr>`;
    });
  }

  html += `</tbody></table></div>`;
  el.innerHTML = html;

  // Wire nav buttons after DOM insert
  document.getElementById("calPrevBtn")?.addEventListener("click", () => {
    _offset--;
    fetchWeek(_offset);
  });
  document.getElementById("calNextBtn")?.addEventListener("click", () => {
    if (_offset < 0) { _offset++; fetchWeek(_offset); }
  });
  document.getElementById("calTodayBtn")?.addEventListener("click", () => {
    _offset = 0;
    fetchWeek(_offset);
  });
}

/* ─── Schedule-tab hook ──────────────────────────────────── */
function hookGoTo() {
  const original = window.goTo;
  window.goTo = function (page, btn) {
    if (typeof original === "function") original(page, btn);
    if (page === "schedule") {
      fetchWeek(_offset);
      _loaded = true;
    }
  };
}

/* ─── Entry point ────────────────────────────────────────── */
window.addEventListener("authReady", (e) => {
  _companyId = e.detail?.companyId || null;
  // Defer hookGoTo so main.js has finished setting window.goTo
  // (modules load in parallel so timing isn't guaranteed)
  if (typeof window.goTo === "function") {
    hookGoTo();
  } else {
    setTimeout(hookGoTo, 100);
  }

  // If the page loaded directly on the schedule tab, render immediately
  const activePage = document.querySelector(".page.active");
  if (activePage && activePage.id === "page-schedule") {
    fetchWeek(_offset);
    _loaded = true;
  }
});