import { db } from "./firebase.js";
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  Timestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const cachedName = localStorage.getItem("displayName");
if (cachedName) {
  const welcome = $("welcome-msg");
  if (welcome) welcome.textContent = `Welcome, ${cachedName}`;
}

window.companyId = null;
let tier = "free";
if(localStorage.getItem("dark-mode") === "true"){
document.documentElement.classList.add("dark-mode");
}
/* ================= AUTH EVENT (STARTUP) ================= */
window.addEventListener("authReady", (e) => {
  const data = e.detail || {};

  // 🔑 Core identity
  window.companyId = data.companyId || null;
  tier = data.tier || "free";

  if (data.displayName) {
    localStorage.setItem("displayName", data.displayName);
  }

  // 👋 Welcome message
  const welcome = $("welcome-msg");
  if (welcome) {
    welcome.textContent = `Welcome, ${data.displayName || "User"}`;
  }

  // 🚀 UPGRADE BUTTON LOGIC
  const upgradeBtn = document.getElementById("upgradeBtn");
  if (upgradeBtn) {
    if (tier === "free") {
      upgradeBtn.classList.remove("hidden");
      upgradeBtn.onclick = () => {
        window.location.href = "/app/upgrade.html";
      };
    } else {
      upgradeBtn.classList.add("hidden");
    }
  }

  // Small delay to allow Firebase Auth token to fully propagate to Firestore
  // before any reads fire — prevents false permission-denied errors on load
  setTimeout(() => {
    initLiveCoverage();

    initStaffOnFloor();
    initActivity();
    initReminders();
    initTicketOverview();
    initPayrollEstimate();
  }, 800);
 
});

/* ================= GLOBAL ACTIONS ================= */

 window.openNewTab = function() {
  window.open("./kioskclock.html?companyId=" + window.companyId, "_blank");
};
window.addReminder = async () => {
  const input = $("reminderInput");
  const text = input?.value.trim();
  if (!text || !window.companyId) return;

  if (tier === "free") {
    const list = $("remindersList");
    if (list && list.children.length >= 5) {
      alert("Upgrade to Pro to add more than 5 reminders!");
      return;
    }
  }

  try {
    await addDoc(collection(db, "companies", window.companyId, "reminders"), {
      companyId: window.companyId,
      text,
      createdAt: Timestamp.now()
    });
    input.value = "";
  } catch (err) {
    console.error("Reminder failed:", err);
  }
};

window.deleteReminder = async (id) => {
  if (!confirm("Delete this reminder?")) return;
  try {
    await deleteDoc(doc(db, "companies", window.companyId, "reminders", id));
  } catch (err) {
    console.error("Delete failed:", err);
  }
};

/* ================= REMINDERS ================= */
function initReminders() {
  if (!window.companyId) return;

  const remindersList = $("remindersList");
  if (!remindersList) return;

  const q = query(
    collection(db, "companies", window.companyId, "reminders"),
    orderBy("createdAt", "desc")
  );

  onSnapshot(q, (snap) => {
    remindersList.innerHTML = "";
    snap.forEach(doc => {
      const data = doc.data();
      const li = document.createElement("li");
      li.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>${data.text}</span>
          <button onclick="deleteReminder('${doc.id}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.2rem;">×</button>
        </div>
      `;
      remindersList.appendChild(li);
    });
  });
}
function initStaffOnFloor() {
  if (!window.companyId) return;

  const el = document.getElementById("employeeCount");
  if (!el) return;

  // Include ON_BREAK — they're still physically on the floor
  const q = query(
    collection(db, "companies", window.companyId, "employees"),
    where("status", "in", ["IN", "ON_BREAK"])
  );

  onSnapshot(q, (snap) => {
    el.textContent = snap.size;
  }, (err) => {
    console.error("initStaffOnFloor failed:", err);
    el.textContent = "–";
  });
}
/* ================= ACTIVITY FEED ================= */
function formatRelativeTime(ts) {
  if (!ts) return "Just now";

  const now = Date.now();
  const then = ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 10) return "Just now";
  if (diff < 60) return `${diff}s ago`;

  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString();
}

function initActivity() {
  const activityList = $("activityFeed");
  if (!activityList || !window.companyId) return;

  const q = query(
    collection(db, "companies", window.companyId, "punchLogs"),
    orderBy("ts", "desc"),
    limit(5)
  );

  onSnapshot(q, (snap) => {
    activityList.innerHTML = "";
    snap.forEach(doc => {
      const data = doc.data();
      const li = document.createElement("li");
      li.className = "activity-item";

      let action = data.eventType.replace(/_/g, " ");
      if (data.eventType === "punch_in") action = "📍 Clocked In";
      if (data.eventType === "punch_out") action = "📤 Clocked Out";
      if (data.eventType === "break_start") action = "☕ Break Started";
      if (data.eventType === "break_end") action = "↩️ Back from Break";

      li.innerHTML = `
        <span><strong>${data.employeeName}</strong>: ${action}</span>
        <span class="time-meta">${formatRelativeTime(data.ts)}</span>
      `;
      activityList.appendChild(li);
    });
  });
}

/* ================= INSIGHT CARD (Coverage Risk) ================= */

function initLiveCoverage() {
  if (!window.companyId) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() + diff);

  const weekId = `${window.companyId}_${weekStart.toISOString().split("T")[0]}`;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const todayIndex = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const todayLabel = DAYS[todayIndex];

  // Load schedule + settings + employees all in parallel
  Promise.all([
    getDoc(doc(db, "weekly_schedules", weekId)),
    getDoc(doc(db, "companies", window.companyId, "schedule_settings", "config")),
    getDocs(collection(db, "companies", window.companyId, "employees"))
  ]).then(([schedSnap, settingsSnap, empSnap]) => {
    const scheduleData     = schedSnap.exists()    ? (schedSnap.data().schedule_data || {}) : {};
    const scheduleSettings = settingsSnap.exists() ? (settingsSnap.data() || {})            : {};

    // Build a real empId → position map from Firestore employee docs
    const empPositions = {};
    empSnap.forEach(d => {
      empPositions[d.id] = (d.data().position || "").trim();
    });

    renderCoverageInsight(scheduleData, scheduleSettings, todayIndex, todayLabel, empPositions);
  }).catch((err) => {
    if (err?.code === "permission-denied") {
      const insightEl = $("insightValue");
      if (insightEl) insightEl.innerHTML = `
        <div style="font-size:0.82rem; color:#64748b; padding: 8px 0;">
          Sign in to view coverage status.
        </div>`;
    } else {
      renderCoverageInsight({}, {}, todayIndex, todayLabel, {});
    }
  });
}

function renderCoverageInsight(scheduleData, settings, todayIndex, todayLabel, empPositions = {}) {
  const insightEl = $("insightValue");
  const card      = insightEl?.closest(".insight-card");
  if (!insightEl) return;

  const rules      = settings.positions || {};
  const totalStaff = Object.keys(scheduleData).length;

  const offToday     = [];
  let scheduledCount = 0;
  let unassigned     = 0;

  Object.entries(scheduleData).forEach(([empId, shifts]) => {
    const shift = (shifts[todayIndex] || "").trim().toUpperCase();
    if (shift === "OFF")   offToday.push(empId);
    else if (shift === "") unassigned++;
    else                   scheduledCount++;
  });

  // ── Position-aware gap check using real employee positions ──────────────
  // Only flags a risk if an absent employee leaves a required position short.
  const positionGaps = [];

  Object.entries(rules).forEach(([pos, posRules]) => {
    const firstVal = Object.values(posRules)[0];
    const isNested = firstVal && typeof firstVal === "object";

    if (isNested) {
      // Format: { shift: { Mon: 2, Tue: 1, ... } }
      Object.entries(posRules).forEach(([shift, dayCounts]) => {
        const need = Number(dayCounts[todayLabel] || 0);
        if (!need) return;
        const have = Object.entries(scheduleData).filter(([empId, shifts]) => {
          const s = (shifts[todayIndex] || "").trim();
          return s && s.toUpperCase() !== "OFF" && empPositions[empId] === pos;
        }).length;
        if (have < need) positionGaps.push({ pos, need, have });
      });
    } else {
      // Format: { Mon: 2, Tue: 1, ... }
      const need = Number(posRules[todayLabel] || 0);
      if (!need) return;
      const have = Object.entries(scheduleData).filter(([empId, shifts]) => {
        const s = (shifts[todayIndex] || "").trim();
        return s && s.toUpperCase() !== "OFF" && empPositions[empId] === pos;
      }).length;
      if (have < need) positionGaps.push({ pos, need, have });
    }
  });

  // ── Build messages — most critical first ───────────────────────────────
  const messages = [];

  if (offToday.length === 0 && unassigned === 0 && totalStaff > 0) {
    messages.push({
      icon: "✅",
      text: "All staff accounted for today.",
      color: "#16a34a"
    });
  }

  if (offToday.length > 0) {
    if (positionGaps.length > 0) {
      // People are off AND it creates a real position gap → actual risk
      const gapNames = positionGaps
        .map(g => `${g.pos} (need ${g.need}, have ${g.have})`)
        .join(", ");
      messages.push({
        icon: "🔴",
        text: `${offToday.length} staff off — coverage gap: ${gapNames}.`,
        color: "#ef4444"
      });
    } else {
      // People are off but all positions are still covered → no real risk
      messages.push({
        icon: "🟢",
        text: `${offToday.length} staff member${offToday.length > 1 ? "s" : ""} off today — all positions still covered.`,
        color: "#16a34a"
      });
    }
  }

  if (unassigned > 0) {
    messages.push({
      icon: "⚠️",
      text: `${unassigned} staff member${unassigned > 1 ? "s have" : " has"} no shift assigned for today.`,
      color: "#f59e0b"
    });
  }

  if (scheduledCount === 0 && totalStaff > 0) {
    messages.push({
      icon: "🚨",
      text: "Nobody is scheduled to work today. Check your schedule.",
      color: "#ef4444"
    });
  }

  if (totalStaff === 0) {
    messages.push({
      icon: "ℹ️",
      text: "No schedule found for this week yet.",
      color: "#64748b"
    });
  }

  // ── Risk label is now driven by actual position gaps, not head count ───
  const hasRed    = messages.some(m => m.color === "#ef4444");
  const hasAmber  = messages.some(m => m.color === "#f59e0b");
  const riskLabel = hasRed ? "High Risk" : hasAmber ? "Needs Attention" : "Looking Good";
  const riskColor = hasRed ? "#ef4444"  : hasAmber ? "#f59e0b"         : "#16a34a";

  insightEl.innerHTML = `
    <div style="font-size: 1rem; font-weight: 800; color: ${riskColor}; margin-bottom: 10px;">
      ${riskLabel}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      ${messages.map(m => `
        <div style="
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 0.82rem;
          font-weight: 600;
          color: ${m.color};
          background: ${m.color}18;
          border: 1px solid ${m.color}33;
          border-radius: 8px;
          padding: 7px 10px;
          line-height: 1.4;
        ">
          <span style="font-size: 0.95rem; flex-shrink: 0;">${m.icon}</span>
          <span>${m.text}</span>
        </div>
      `).join("")}
    </div>
    <div style="margin-top: 10px; font-size: 0.75rem; color: #94a3b8;">
      Based on today's schedule · ${todayLabel}
    </div>
  `;

  if (card) {
    card.classList.remove("risk-low", "risk-medium", "risk-high");
    card.classList.add(hasRed ? "risk-high" : hasAmber ? "risk-medium" : "risk-low");
  }
}
/* ─── Shift pill helper ──────────────────────────────────── */
function renderShiftPill(shift) {
  // Normalize — shift can be null, undefined, a plain string, or an object
  // like { type:"morning", start:"7AM", end:"3PM" }
  if (!shift) {
    return `<span style="font-size:.75rem;color:var(--text-muted,#94a3b8);">Off</span>`;
  }

  let s;
  if (typeof shift === "object") {
    // Build display string from object fields
    if (shift.start && shift.end) {
      s = `${shift.start}–${shift.end}`;
    } else if (shift.type) {
      s = shift.type;
    } else {
      return `<span style="font-size:.75rem;color:var(--text-muted,#94a3b8);">Off</span>`;
    }
  } else {
    s = String(shift).trim();
  }

  if (!s || s.toLowerCase() === "off") {
    return `<span style="font-size:.75rem;color:var(--text-muted,#94a3b8);">Off</span>`;
  }
  const v = s.toLowerCase().replace(/\s/g, "");
  let color = "#64748b";
  if (/am/.test(v))                          color = "#f59e0b"; // morning = amber
  else if (/^([1-8])(:\d{2})?pm/.test(v))   color = "#8b5cf6"; // afternoon = purple
  else if (/^(9|10|11)(:\d{2})?pm/.test(v)) color = "#0ea5e9"; // night = blue
  else if (v === "oncall")                    color = "#10b981"; // green
  return `<span style="
    display:inline-block;
    padding:2px 7px;
    border-radius:4px;
    font-size:.72rem;
    font-weight:600;
    background:${color}22;
    color:${color};
    white-space:nowrap;
  ">${s}</span>`;
}

function renderScheduleCalendar(employees, weeklySchedule) {

  const calendar = document.getElementById("scheduleCalendar");
  if (!calendar) return;

  const days = [
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Sun"
  ];

  // Compute coverage per day from actual schedule data
  const coverageByDay = {};
  days.forEach(day => {
    const scheduled = employees.filter(emp => {
      const shift = weeklySchedule?.[emp.id]?.[day];
      return shift && shift !== "off" && shift !== "Off";
    }).length;
    coverageByDay[day] = employees.length > 0
      ? Math.round((scheduled / employees.length) * 100)
      : 0;
  });

  let html = `
    <div class="schedule-grid">

      <div class="schedule-row">
        <div class="schedule-cell schedule-header">
          Employee
        </div>

     ${days.map(day => {

  const coverage = coverageByDay?.[day] || 0;

  let icon = "❌";

  if (coverage >= 90) {
    icon = "✅";
  } else if (coverage >= 70) {
    icon = "⚠️";
  }

  return `
    <div class="schedule-cell schedule-header">

      <div>${day}</div>

      <div style="
        font-size:.7rem;
        margin-top:4px;
        color:var(--text-muted);
      ">
        ${icon} ${coverage}%
      </div>

    </div>
  `;

}).join("")}
  `;

  employees.forEach(emp => {

    html += `
      <div class="schedule-row">

        <div class="schedule-cell employee-name">
          ${emp.name}
        </div>
    `;

    days.forEach(day => {

      const shift = weeklySchedule?.[emp.id]?.[day];

      html += `
        <div class="schedule-cell">
          ${renderShiftPill(shift)}
        </div>
      `;
    });

    html += `</div>`;
  });

  html += `</div>`;

  calendar.innerHTML = html;
}
const employees = [
  { id: "1", name: "John" },
  { id: "2", name: "Sarah" },
  { id: "3", name: "Mike" }
];

const weeklySchedule = {

  "1": {
    Mon: { type:"morning", start:"7AM", end:"3PM" },
    Tue: { type:"morning", start:"7AM", end:"3PM" }
  },

  "2": {
    Mon: { type:"evening", start:"3PM", end:"11PM" }
  },

  "3": {
    Wed: { type:"night", start:"11PM", end:"7AM" }
  }
};

renderScheduleCalendar(employees, weeklySchedule);
/* ================= PAYROLL ESTIMATE ================= */
function getHoursFromShift(shiftText) {
  if (!shiftText || typeof shiftText !== "string") return 0;
  const s = shiftText.trim().toLowerCase().replace(/\s/g, "");

  // Named shifts → fixed hours (customize these to match yours)
  const named = { morning: 8, evening: 8, night: 8, oncall: 0, off: 0 };
  if (named[s] !== undefined) return named[s];

  // Try to match: 9am-5pm / 9:00am-5:00pm / 9-17 / 9:00-17:00
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?[-–](\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return 0;

  let sh = parseInt(m[1]), sm = parseInt(m[2] || 0);
  let eh = parseInt(m[4]), em = parseInt(m[5] || 0);
  const sap = m[3] || "", eap = m[6] || "";

  // Apply am/pm
  if (sap === "pm" && sh !== 12) sh += 12;
  if (sap === "am" && sh === 12) sh = 0;
  if (eap === "pm" && eh !== 12) eh += 12;
  if (eap === "am" && eh === 12) eh = 0;

  // If no am/pm at all and end < start, assume overnight or 24h clock
  const totalMins = (eh * 60 + em) - (sh * 60 + sm);
  return totalMins <= 0 ? (totalMins + 1440) / 60 : totalMins / 60;
}

async function initPayrollEstimate() {
  const el = document.getElementById("payrollTotal");
  if (!el || !window.companyId) return;
  if (!el) return;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    today.setDate(today.getDate() + diff);

    const weekId = `${window.companyId}_${today.toISOString().split("T")[0]}`;
    const scheduleSnap = await getDoc(doc(db, "weekly_schedules", weekId));

    if (!scheduleSnap.exists()) {
      el.textContent = "0.00";
      return;
    }

    const scheduleData = scheduleSnap.data().schedule_data || {};

    const empSnap = await getDocs(
      collection(db, "companies", window.companyId, "employees")
    );

    const rateMap = {};
    empSnap.forEach(doc => {
      const data = doc.data();
      rateMap[doc.id] = Number(data.hourlyRate || 0);
    });

    let total = 0;

    Object.entries(scheduleData).forEach(([empId, shifts]) => {
      const rate = rateMap[empId] || 0;

      shifts.forEach(shift => {
        if (!shift || shift.toUpperCase() === "OFF") return;

        const hours = getHoursFromShift(shift);
        total += hours * rate;
      });
    });

    el.textContent = total.toFixed(2);

  } catch (err) {
    console.error("Payroll estimate failed:", err);
    el.textContent = "0.00";
  }
}

/* ================= TICKET OVERVIEW ================= */
window.goToTickets = function () {
  const companyId = localStorage.getItem("companyId");
  if (!companyId) {
    alert("Missing company ID.");
    return;
  }
  window.location.href = `/ticketManagement.html?companyId=${companyId}`;
};

function initTicketOverview() {
  if (!window.companyId) return;

  const q = query(
    collection(db, "companies", window.companyId, "tickets"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  onSnapshot(q, (snap) => {
    let open = 0;
    let progress = 0;
    let overdue = 0;

    const now = new Date();
    const recentList = document.getElementById("ticketRecent");
    if (recentList) recentList.innerHTML = "";

    snap.forEach(doc => {
      const data = doc.data();

      if (data.status === "open") open++;
      if (data.status === "in_progress") progress++;

      if (
        data.dueDate &&
        data.status !== "resolved" &&
        data.dueDate.toDate() < now
      ) {
        overdue++;
      }

      if (recentList && recentList.children.length < 3) {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${data.reason}</strong> – ${data.employeeName}`;
        li.style.cursor = "pointer";
        li.onclick = () => {
          window.location.href = `/ticketManagement.html?companyId=${window.companyId}&ticketId=${doc.id}`;
        };
        recentList.appendChild(li);
      }
    });

    const ticketOpen = document.getElementById("ticketOpen");
    const ticketProgress = document.getElementById("ticketProgress");
    const ticketOverdue = document.getElementById("ticketOverdue");

    if (ticketOpen) ticketOpen.textContent = open;
    if (ticketProgress) ticketProgress.textContent = progress;
    if (ticketOverdue) ticketOverdue.textContent = overdue;
  });
}

/* ================= EMPLOYEE PORTAL SYNC ================= */
// This function pushes dashboard data to employee portal in real-time
export async function syncDashboardToPortal() {
  if (!window.companyId) return;

  try {
    // Get current employee metrics
    const empSnap = await getDocs(
      collection(db, "companies", window.companyId, "employees")
    );

    const metrics = {
      totalEmployees: empSnap.size,
      activeToday: 0,
      updatedAt: new Date().toISOString()
    };

    // Count active employees from punch logs
    const punchSnap = await getDocs(
      query(
        collection(db, "companies", window.companyId, "punchLogs"),
        orderBy("ts", "desc"),
        limit(100)
      )
    );

    const activeLogs = new Set();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    punchSnap.forEach(doc => {
      const log = doc.data();
      const logTime = log.ts?.toDate?.() || new Date();

      if (logTime >= today && log.eventType === "punch_in") {
        activeLogs.add(log.employeeId);
      }
    });

    metrics.activeToday = activeLogs.size;

    // Use setDoc with a fixed doc ID so it overwrites instead of accumulating
    await setDoc(
      doc(db, "companies", window.companyId, "dashboard_metrics", "latest"),
      metrics
    );

  } catch (err) {
    console.warn("Portal sync failed:", err);
  }
}

// Call on startup
window.addEventListener("authReady", syncDashboardToPortal);
window.goToSettings = function () {
  window.location.href = "/pages/settings.html";
};

/* ================= SCHEDULE HUB KPI ================= */
// Exposed on window so the plain-script loadScheduleForHub() in index.html can call it.
window.loadScheduleKPI = async function () {
  if (!window.companyId) return;

  try {
    // Compute Monday of current week
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);
    const weekId = `${window.companyId}_${monday.toISOString().split("T")[0]}`;

    // Fetch schedule + employees in parallel
    const [schedSnap, empSnap] = await Promise.all([
      getDoc(doc(db, "weekly_schedules", weekId)),
      getDocs(collection(db, "companies", window.companyId, "employees"))
    ]);

    const scheduleData = schedSnap.exists() ? (schedSnap.data().schedule_data || {}) : {};

    const employeeList = [];
    empSnap.forEach(d => {
      employeeList.push({ id: d.id, ...d.data() });
    });

    // buildScheduleHub is defined in the inline <script> in index.html
    if (typeof window.buildScheduleHub === "function") {
      window.buildScheduleHub(scheduleData, employeeList);
    }

    // Also update coverageScore and totalHours (shared IDs with schedule.html)
    const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
    let totalHrs = 0;
    let scheduledCount = 0;
    let totalAssigned = 0;

    Object.values(scheduleData).forEach(shifts => {
      DAYS.forEach((day, i) => {
        const val = (Array.isArray(shifts) ? shifts[i] : shifts[day]) || "";
        if (!val || val.toUpperCase() === "OFF") return;
        totalAssigned++;
        if (val.toLowerCase() !== "oncall") scheduledCount++;
        // Parse hours
        const m = val.replace(/\s/g,"").match(/(\d{1,2})(?::(\d{2}))?(am|pm)?[-–](\d{1,2})(?::(\d{2}))?(am|pm)?/i);
        if (m) {
          let sh = parseInt(m[1]), eh = parseInt(m[4]);
          const sap = (m[3]||"").toLowerCase(), eap = (m[6]||"").toLowerCase();
          if (sap === "pm" && sh !== 12) sh += 12;
          if (eap === "pm" && eh !== 12) eh += 12;
          let diff = eh - sh; if (diff <= 0) diff += 24;
          totalHrs += diff;
        } else {
          totalHrs += 8; // default if unparseable
        }
      });
    });

    const covPct = employeeList.length && DAYS.length
      ? Math.round((scheduledCount / (employeeList.length * DAYS.length)) * 100)
      : 0;

    const cvEl = document.getElementById("coverageScore");
    if (cvEl) {
      cvEl.textContent = `${covPct}%`;
      cvEl.className = "sh-kpi-val " + (covPct >= 80 ? "green" : covPct >= 60 ? "amber" : "red");
    }
    const thEl = document.getElementById("totalHours");
    if (thEl) thEl.textContent = `${totalHrs}h`;

    const wqEl = document.getElementById("weekQuality");
    if (wqEl) {
      const q = covPct >= 80 ? "⭐ Great" : covPct >= 60 ? "🟡 OK" : "🔴 Low";
      wqEl.textContent = q;
    }

    const rsEl = document.getElementById("restStatus");
    if (rsEl) rsEl.textContent = "OK";

  } catch (err) {
    console.error("loadScheduleKPI failed:", err);
  }
};