// js/punchlogs.js
import { auth, db } from "./core/firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  deleteDoc,
  updateDoc,
  doc,
  Timestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// Sync dark mode on load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}
/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
let companyId     = null;
let unsub         = null;       // active Firestore listener
let allLogs       = [];         // raw fetched docs
let employeeMap   = {};         // id → { fullName, position }
let filterDate    = null;       // Date | null  (midnight of selected day)

/* ─────────────────────────────────────────
   EVENT TYPE META
───────────────────────────────────────── */
const EVENT_META = {
  punch_in:    { label: "Clock In",     icon: "↗",  color: "var(--green)",  isShift: true  },
  punch_out:   { label: "Clock Out",    icon: "↙",  color: "var(--red)",    isShift: true  },
  break_start: { label: "Break Start",  icon: "⏸",  color: "var(--yellow)", isShift: false },
  break_end:   { label: "Break End",    icon: "▶",  color: "var(--accent)", isShift: false },
};

/* ─────────────────────────────────────────
   AUTH READY — entry point
───────────────────────────────────────── */
window.addEventListener("authReady", async (e) => {
  companyId = e.detail?.companyId;
   window.companyId = companyId; // expose for kiosk clock
  if (!companyId) return;

  await loadEmployeeMap();
  initDatePicker();
  startListener();
});

/* ─────────────────────────────────────────
   EMPLOYEE MAP  (for name + position lookups)
───────────────────────────────────────── */
async function loadEmployeeMap() {
  try {
    const snap = await getDocs(
      collection(db, "companies", companyId, "employees")
    );
    snap.forEach(d => {
      employeeMap[d.id] = {
        fullName: d.data().fullName || d.data().name || "Unknown",
        position: d.data().position || d.data().role  || "—",
      };
    });
  } catch (err) {
    console.warn("punchlogs: could not load employees", err);
  }
}

/* ─────────────────────────────────────────
   DATE PICKER
───────────────────────────────────────── */
function initDatePicker() {
  const picker = document.getElementById("punchLogDate");
  if (!picker) return;

  // Default to today
  const today = new Date();
  picker.value = toInputDate(today);
  filterDate   = toMidnight(today);

  picker.addEventListener("change", () => {
    filterDate = picker.value ? toMidnight(new Date(picker.value + "T00:00:00")) : null;
    render();
  });
}

/* ─────────────────────────────────────────
   FIRESTORE LISTENER
   Listens to all punchLogs for the company,
   ordered by timestamp desc. We filter client-
   side so the date picker is instant.
───────────────────────────────────────── */
function startListener() {
  if (unsub) unsub();

  const q = query(
    collection(db, "companies", companyId, "punchLogs"),
    orderBy("ts", "desc")
  );

  unsub = onSnapshot(q, (snap) => {
    allLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, (err) => {
    console.error("punchlogs listener error:", err);
  });
}

/* ─────────────────────────────────────────
   RENDER — split into shift + break tables
───────────────────────────────────────── */
function render() {
  // Filter by selected date
  const logs = filterDate
    ? allLogs.filter(l => {
        const ts = toDate(l.ts);
        if (!ts) return false;
        const day = toMidnight(ts);
        return day.getTime() === filterDate.getTime();
      })
    : allLogs;

  // Pair events to compute durations
  const paired = computeDurations(logs);

  const shiftLogs = paired.filter(l => EVENT_META[l.eventType]?.isShift);
  const breakLogs = paired.filter(l => !EVENT_META[l.eventType]?.isShift);

  renderTable("shiftBody", shiftLogs);
  renderTable("breakBody", breakLogs);
}

/* ─────────────────────────────────────────
   DURATION PAIRING
   punch_in  → duration until matching punch_out  (same employee, next event)
   break_start → duration until next break_end
───────────────────────────────────────── */
function computeDurations(logs) {
  // logs are desc by ts; reverse to asc for pairing
  const asc = [...logs].reverse();

  const result = logs.map(log => ({ ...log, duration: null }));

  // For each clock-in, find next clock-out for same employee
  asc.forEach((log, i) => {
    if (log.eventType !== "punch_in" && log.eventType !== "break_start") return;

    const pairType = log.eventType === "punch_in" ? "punch_out" : "break_end";

    for (let j = i + 1; j < asc.length; j++) {
      const next = asc[j];
      if (next.employeeId !== log.employeeId) continue;
      if (next.eventType  !== pairType)       continue;

      const mins = diffMins(toDate(log.ts), toDate(next.ts));
      if (mins !== null && mins >= 0) {
        // write duration onto both the open and close event (in result, which is desc order)
        const descIdx = result.findIndex(r => r.id === log.id);
        if (descIdx !== -1) result[descIdx].duration = mins;
      }
      break;
    }
  });

  return result;
}

/* ─────────────────────────────────────────
   TABLE RENDERER
───────────────────────────────────────── */
function renderTable(tbodyId, logs) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (!logs.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6" style="text-align:center;padding:28px;color:var(--text-muted);">No events found.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const meta     = EVENT_META[log.eventType] || { label: log.eventType, icon: "•", color: "inherit" };
    const ts       = toDate(log.ts);
    const dateStr  = ts ? formatDateTime(ts) : "—";
    const emp      = employeeMap[log.employeeId];
    const name     = log.employeeName || emp?.fullName || "Unknown";
    const position = emp?.position || "—";
    const dur      = log.duration !== null ? formatDuration(log.duration) : "—";
    const source   = log.source || "Kiosk";

    return `<tr data-id="${log.id}">
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--accent-light);color:var(--accent);
                      font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:600;font-size:.84rem;">${escHtml(name)}</div>
            <div style="font-size:.7rem;color:var(--text-muted);">${escHtml(position)}</div>
          </div>
        </div>
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
                     border-radius:20px;font-size:.72rem;font-weight:700;
                     background:${meta.color}18;color:${meta.color};border:1px solid ${meta.color}44;">
          ${meta.icon} ${meta.label}
        </span>
      </td>
      <td style="font-size:.82rem;color:var(--text-muted);font-family:'Space Mono',monospace;">${dateStr}</td>
      <td>
        <span style="font-size:.75rem;color:var(--text-muted);background:var(--surface2);
                     padding:2px 8px;border-radius:6px;border:1px solid var(--border);">
          ${escHtml(source)}
        </span>
      </td>
      <td style="font-size:.82rem;font-weight:600;font-family:'Space Mono',monospace;">${dur}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn-small" onclick="editPunchLog('${log.id}')" title="Edit timestamp">
            ✏️ Edit
          </button>
          <button class="btn-small btn-danger" onclick="deletePunchLog('${log.id}')" title="Delete">
            🗑
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}
window.openNewTab = function() {
  window.open("kioskclock.html?companyId=" + window.companyId, "_blank");
};
/* ─────────────────────────────────────────
   SEARCH — exposed so index.html's oninput
   can call window._filterLogsImpl
───────────────────────────────────────── */
window._filterLogsImpl = function(value) {
  const q = (value || "").toLowerCase().trim();

  const shiftRows = document.querySelectorAll("#shiftBody tr[data-id]");
  const breakRows = document.querySelectorAll("#breakBody tr[data-id]");

  [...shiftRows, ...breakRows].forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = q === "" || text.includes(q) ? "" : "none";
  });
};

/* ─────────────────────────────────────────
   EDIT — opens a simple prompt to change ts
───────────────────────────────────────── */
window.editPunchLog = async function(id) {
  const log = allLogs.find(l => l.id === id);
  if (!log) return;

  const ts    = toDate(log.ts);
  const current = ts ? toInputDateTimeLocal(ts) : "";

  const newVal = prompt(
    `Edit timestamp for ${log.employeeName || "employee"} (${EVENT_META[log.eventType]?.label || log.eventType})\n\nCurrent: ${current}\n\nEnter new date & time (YYYY-MM-DDTHH:MM):`,
    current
  );

  if (!newVal || newVal === current) return;

  const parsed = new Date(newVal);
  if (isNaN(parsed.getTime())) {
    alert("Invalid date/time format. Please use YYYY-MM-DDTHH:MM");
    return;
  }

  try {
    await updateDoc(
      doc(db, "companies", companyId, "punchLogs", id),
      { ts: Timestamp.fromDate(parsed), editedAt: Timestamp.now(), editedBy: "manager" }
    );
  } catch (err) {
    console.error("Edit punch log failed:", err);
    alert("Failed to update — check console for details.");
  }
};

/* ─────────────────────────────────────────
   DELETE
───────────────────────────────────────── */
window.deletePunchLog = async function(id) {
  const log  = allLogs.find(l => l.id === id);
  const name = log?.employeeName || "this entry";
  const type = EVENT_META[log?.eventType]?.label || log?.eventType || "event";

  if (!confirm(`Delete ${type} for ${name}? This cannot be undone.`)) return;

  try {
    await deleteDoc(doc(db, "companies", companyId, "punchLogs", id));
  } catch (err) {
    console.error("Delete punch log failed:", err);
    alert("Failed to delete — check console for details.");
  }
};

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */
function toDate(ts) {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();           // Firestore Timestamp
  if (ts instanceof Date) return ts;
  if (typeof ts === "string") return new Date(ts);
  return null;
}

function toMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toInputDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toInputDateTimeLocal(date) {
  const y  = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d  = String(date.getDate()).padStart(2, "0");
  const h  = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function formatDateTime(date) {
  return date.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function formatDuration(mins) {
  if (mins === null || mins === undefined) return "—";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function diffMins(a, b) {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / 60000;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
