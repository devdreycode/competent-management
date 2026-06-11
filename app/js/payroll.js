import { auth, db } from "./core/firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
  doc,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
;

const $ = (id) => document.getElementById(id);
let companyId = null;

let periodOffset = 0;

let payPeriodConfig = {
  type: "weekly",
  startDay: 1,
  anchorDate: null,
  semimonthlyDay1: 1,
  semimonthlyDay2: 15,
};

// ── Date Utilities ───────────────────────────────────────────────────────────

const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function getPeriodWindow(offset = 0) {
  const now  = new Date();
  const type = payPeriodConfig.type;

  if (type === "weekly") {
    const sd   = parseInt(payPeriodConfig.startDay ?? 1);
    const diff = (now.getDay() - sd + 7) % 7;
    const periodStart = startOfDay(addDays(now, -diff + offset * 7));
    return { start: periodStart, end: endOfDay(addDays(periodStart, 6)) };
  }

  if (type === "biweekly") {
    const anchor = payPeriodConfig.anchorDate
      ? startOfDay(new Date(payPeriodConfig.anchorDate))
      : (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - (d.getDay() - 1 + 7) % 7);
          return startOfDay(d);
        })();
    const msPerPeriod    = 14 * 86400000;
    const periodsElapsed = Math.floor((now - anchor) / msPerPeriod);
    const periodStart    = new Date(anchor.getTime() + (periodsElapsed + offset) * msPerPeriod);
    return { start: startOfDay(periodStart), end: endOfDay(addDays(periodStart, 13)) };
  }

  if (type === "semimonthly") {
    const d1 = parseInt(payPeriodConfig.semimonthlyDay1 ?? 1);
    const d2 = parseInt(payPeriodConfig.semimonthlyDay2 ?? 15);
    let year = now.getFullYear(), month = now.getMonth();
    let half = now.getDate() < d2 ? 0 : 1;
    let totalHalves = year * 24 + month * 2 + half + offset;
    year  = Math.floor(totalHalves / 24);
    month = Math.floor((totalHalves % 24) / 2);
    half  = totalHalves % 2;
    const start = half === 0 ? new Date(year, month, d1)  : new Date(year, month, d2);
    const end   = half === 0 ? new Date(year, month, d2-1): new Date(year, month+1, 0);
    return { start: startOfDay(start), end: endOfDay(end) };
  }

  // Monthly
  let year = now.getFullYear(), month = now.getMonth() + offset;
  year  += Math.floor(month / 12);
  month  = ((month % 12) + 12) % 12;
  return { start: startOfDay(new Date(year, month, 1)), end: endOfDay(new Date(year, month+1, 0)) };
}

// ── FICA Estimation ──────────────────────────────────────────────────────────

const SS_RATE      = 0.062;
const MEDI_RATE    = 0.0145;
const SS_WAGE_BASE = 176100;

function estimateFICA(gross) {
  const ss   = Math.min(gross, SS_WAGE_BASE) * SS_RATE;
  const medi = gross * MEDI_RATE;
  return { ss, medicare: medi, total: ss + medi };
}

// ── Pay Period Config ────────────────────────────────────────────────────────

async function loadPayPeriodConfig() {
  try {
    const snap = await getDoc(doc(db, "companies", companyId, "payroll_settings", "config"));
    if (snap.exists()) {
      const saved = snap.data();
      if (saved.startDay        !== undefined) saved.startDay        = parseInt(saved.startDay);
      if (saved.semimonthlyDay1 !== undefined) saved.semimonthlyDay1 = parseInt(saved.semimonthlyDay1);
      if (saved.semimonthlyDay2 !== undefined) saved.semimonthlyDay2 = parseInt(saved.semimonthlyDay2);
      payPeriodConfig = { ...payPeriodConfig, ...saved };
    }
  } catch (_) {}
  syncConfigUI();
}

async function savePayPeriodConfig() {
  try {
    await setDoc(doc(db, "companies", companyId, "payroll_settings", "config"), payPeriodConfig);
    showMessage("Pay period settings saved.", "success");
    periodOffset = 0;
    calculatePayroll();
  } catch (_) {
    showMessage("Failed to save settings.");
  }
}

function syncConfigUI() {
  const t = $("periodType");
  if (t) t.value = payPeriodConfig.type;
  updateConfigPanelVisibility();
  const sd = $("weekStartDay"); if (sd) sd.value = payPeriodConfig.startDay ?? 1;
  const ba = $("biweeklyAnchor"); if (ba && payPeriodConfig.anchorDate) ba.value = payPeriodConfig.anchorDate;
  const s1 = $("semiDay1"); if (s1) s1.value = payPeriodConfig.semimonthlyDay1 ?? 1;
  const s2 = $("semiDay2"); if (s2) s2.value = payPeriodConfig.semimonthlyDay2 ?? 15;
}

function updateConfigPanelVisibility() {
  const type = $("periodType")?.value || payPeriodConfig.type;
  const show = (id, cond) => { const el = $(id); if (el) el.style.display = cond ? "flex" : "none"; };
  show("weeklyOptions",      type === "weekly");
  show("biweeklyOptions",    type === "biweekly");
  show("semimonthlyOptions", type === "semimonthly");
}

// ── Messages ─────────────────────────────────────────────────────────────────

function showMessage(text, type = "error") {
  const c = $("messageContainer");
  if (!c) return;
  const d = document.createElement("div");
  d.className = type === "error" ? "error-message" : "success-message";
  d.textContent = text;
  c.innerHTML = "";
  c.appendChild(d);
  if (type === "success") setTimeout(() => d.remove(), 4000);
}

// ── Core Payroll ─────────────────────────────────────────────────────────────

async function calculatePayroll() {
  if (!companyId) return;
  const { start, end } = getPeriodWindow(periodOffset);
  updatePeriodNav(start, end);

  try {
    // 1. Load employees
    const empSnap = await getDocs(collection(db, "companies", companyId, "employees"));
    const employees = {};
    empSnap.forEach(d => {
      employees[d.id] = {
        ...d.data(),
        id: d.id,
        totalMinutes: 0,
        hourlyRate: parseFloat(d.data().hourlyRate) || 0,
        shifts: [],
        openShift: false,
      };
    });

    // 2. Load punch logs
    const q = query(
      collection(db, "companies", companyId, "punchLogs"),
     where("ts", ">=", new Date(start.getTime() - 86400000)),
      where("ts", "<=", end),
      orderBy("ts", "asc")
    );
    const punchSnap = await getDocs(q);
    const activeShifts = {}, activeBreaks = {};
    const warnings = [];

    punchSnap.forEach(docSnap => {
      const log = docSnap.data();
      const emp = employees[log.employeeId];
      if (!emp) return;

      const time = log.ts.toDate();
      const type = log.eventType?.toLowerCase();

      if (type === "punch_in") {
        if (activeShifts[log.employeeId]) {
          // Double punch_in — auto-close previous open shift
          const missedOut = activeShifts[log.employeeId];
          emp.totalMinutes += (time - missedOut) / 60000;
          emp.shifts.push({ in: missedOut, out: time, flag: "auto-closed" });
          warnings.push(`${emp.fullName || emp.name}: missed punch-out — gap closed automatically.`);
        }
        activeShifts[log.employeeId] = time;

      } else if (type === "punch_out") {
        if (activeShifts[log.employeeId]) {
          const shiftIn = activeShifts[log.employeeId];
          emp.totalMinutes += (time - shiftIn) / 60000;
          emp.shifts.push({ in: shiftIn, out: time });
          delete activeShifts[log.employeeId];
        }

      } else if (type === "break_start") {
        activeBreaks[log.employeeId] = time;

      } else if (!payPeriodConfig.breaksCountAsHours) {
  emp.totalMinutes -=
    (time - activeBreaks[log.employeeId]) / 60000;
}
    });

    // 3. Still clocked in — count to end of period
   Object.entries(activeShifts).forEach(([empId, clockInTime]) => {
  const emp = employees[empId];
  if (!emp) return;

  const now = new Date();
  emp.totalMinutes += (now - clockInTime) / 60000;
      emp.shifts.push({ in: clockInTime, out: null });
      emp.openShift = true;
      warnings.push(`${emp.fullName || emp.name}: currently clocked in — hours counted through end of period.`);
    });

    // 4. OT threshold
  const otThreshold =
  Number(payPeriodConfig.overtimeThreshold || 40);
    const otLabel = $("otThresholdLabel");
    if (otLabel) {
      otLabel.textContent = otThreshold
        ? `${otThreshold} hrs/${payPeriodConfig.type === "biweekly" ? "period" : "week"}`
        : "none";
    }

    // 5. Warnings banner
    const msgContainer = $("messageContainer");
    if (warnings.length && msgContainer) {
      const box = document.createElement("div");
      box.className = "error-message";
      box.style.cssText = "background:#fffbeb;border-color:#fde68a;color:#92400e;";
      box.innerHTML = `<strong>⚠ Payroll Anomalies</strong>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:0.85rem;">
          ${warnings.map(w => `<li>${w}</li>`).join("")}
        </ul>`;
      msgContainer.innerHTML = "";
      msgContainer.appendChild(box);
    } else if (msgContainer) {
      msgContainer.innerHTML = "";
    }

    // 6. Render
    const empList = Object.values(employees);
    _employeeMap = employees; // store for modal
    renderPayroll(empList, otThreshold);
    renderEmpCards(empList, otThreshold);

  } catch (err) {
    console.error("calculatePayroll error:", err);
    showMessage("Failed to calculate payroll. Check Firestore indexes.");
  }
}

// ── Period Nav ───────────────────────────────────────────────────────────────

function updatePeriodNav(start, end) {
  const label = $("payPeriodLabel");
  if (label) label.textContent = `${fmt(start)} – ${fmt(end)}`;

  const nextBtn = $("nextPeriod");
  if (nextBtn) nextBtn.disabled = periodOffset >= 0;
}

// ── Main Payroll Table ───────────────────────────────────────────────────────

function renderPayroll(data, otThreshold) {
const term = ($("empSearch")?.value || "").toLowerCase().trim();

if (term) {
  data = data.filter(emp =>
    (emp.fullName || emp.name || "")
      .toLowerCase()
      .includes(term)
  );
}
  const tbody    = $("payrollBody");
  const showFICA = $("showFICA")?.checked;

  ["ficaHeader","netHeader"].forEach(id => {
    const el = $(id);
    if (el) el.style.display = showFICA ? "" : "none";
  });

  let totalH = 0, totalG = 0, totalFICA = 0, count = 0;

  tbody.innerHTML = data.map(emp => {
    const hours = emp.totalMinutes / 60;
    if (hours <= 0) return "";

    const regH  = otThreshold ? Math.min(hours, otThreshold) : hours;
    const otH   = otThreshold ? Math.max(0, hours - otThreshold) : 0;
    const gross = (regH * emp.hourlyRate) + (otH * emp.hourlyRate * (payPeriodConfig.overtimeMultiplier || 1.5));
    const fica  = estimateFICA(gross);

    totalH    += hours;
    totalG    += gross;
    totalFICA += fica.total;
    count++;

    const openBadge = emp.openShift
      ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:8px;font-weight:700;margin-left:4px;">● OPEN</span>`
      : "";
    const noRateBadge = emp.hourlyRate === 0
      ? `<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:8px;font-weight:700;margin-left:4px;">NO RATE</span>`
      : "";

    const ficaCells = showFICA ? `
      <td class="num" style="color:#6b7280;font-size:0.85rem;">
        $${fica.total.toFixed(2)}
        <div style="font-size:0.7rem;color:#9ca3af;">SS $${fica.ss.toFixed(2)} / Med $${fica.medicare.toFixed(2)}</div>
      </td>
      <td class="num"><strong>$${(gross - fica.total).toFixed(2)}</strong></td>
    ` : "";

     return `
  <tr data-emp-id="${emp.id}"${emp.openShift ? ' style="background:#fffbeb;"' : ""}>
    <td><strong>${emp.fullName || emp.name || "Unknown"}</strong>${openBadge}${noRateBadge}</td>
    <td>${emp.position || "Staff"}</td>
    <td class="num">$${emp.hourlyRate.toFixed(2)}</td>
    <td class="num">${regH.toFixed(2)}</td>
    <td class="num" style="${otH > 0 ? "color:#dc2626" : "color:#9ca3af"}">${otH > 0 ? otH.toFixed(2) : "—"}</td>
    <td class="num"><strong>$${gross.toFixed(2)}</strong></td>
    ${ficaCells}
  </tr>`;
  }).join("");

  if (!tbody.innerHTML.trim()) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No punch data for this period.</td></tr>`;
  }

  // Wire row clicks to open modal
  tbody.querySelectorAll("tr[data-emp-id]").forEach(tr => {
    tr.addEventListener("click", () => openEmpModal(tr.dataset.empId));
  });

  const grandTotal = $("payrollGrandTotal");
  if (grandTotal) grandTotal.textContent = `$${totalG.toFixed(2)}`;

  const ficaSummary = $("ficaSummary");
  if (ficaSummary) ficaSummary.style.display = showFICA ? "" : "none";
  const totalFICAEl = $("totalFICA"); if (totalFICAEl) totalFICAEl.textContent = `$${totalFICA.toFixed(2)}`;
  const totalNetEl  = $("totalNet");  if (totalNetEl)  totalNetEl.textContent  = `$${(totalG - totalFICA).toFixed(2)}`;
}

// ── Employee Hours Cards ─────────────────────────────────────────────────────

let _lastEmpData     = [];
let _lastOtThreshold = 40;
let _employeeMap     = {}; // id -> emp, for modal

function renderEmpCards(data, otThreshold) {
  _lastEmpData     = data;
  _lastOtThreshold = otThreshold;

  const grid = $("empCardsGrid");
  if (!grid) return;

  const term = ($("empSearch")?.value || "").toLowerCase().trim();

  const filtered = data
    .filter(emp => emp.totalMinutes > 0)
    .filter(emp => !term || (emp.fullName || emp.name || "").toLowerCase().includes(term))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:30px;font-size:0.9rem;">
      ${term ? "No employees match that search." : "No punch data for this period."}
    </div>`;
    return;
  }

  const maxHours = Math.max(...filtered.map(e => e.totalMinutes / 60), 1);
  grid.innerHTML = "";

  filtered.forEach(emp => {
    const hours = emp.totalMinutes / 60;
    const regH  = otThreshold ? Math.min(hours, otThreshold) : hours;
    const otH   = otThreshold ? Math.max(0, hours - otThreshold) : 0;
    const gross = (regH * emp.hourlyRate) + (otH * emp.hourlyRate * (payPeriodConfig.overtimeMultiplier || 1.5));

    const regPct = (regH / maxHours) * 100;
    const otPct  = (otH  / maxHours) * 100;

    const hasOT  = otH > 0;
    const isOpen = !!emp.openShift;
    const noRate = emp.hourlyRate === 0;
    const borderColor = hasOT ? "#dc2626" : isOpen ? "#f59e0b" : "#e2e8f0";

    const shiftRows = (emp.shifts || []).map(s => {
      const inStr  = new Date(s.in).toLocaleString(undefined, { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
      const outStr = s.out
        ? new Date(s.out).toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })
        : "still open";
      const durH   = s.out ? ((s.out - s.in) / 3600000).toFixed(2) + "h" : "—";
      const flag   = s.flag === "auto-closed"
        ? `<span style="font-size:9px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:6px;margin-left:4px;">auto</span>`
        : "";
      return `<div style="display:flex;justify-content:space-between;align-items:center;
                          padding:5px 0;border-bottom:1px solid var(--border);font-size:0.78rem;">
        <span style="color:var(--text-muted);">${inStr} → ${outStr}${flag}</span>
        <span style="font-weight:700;">${durH}</span>
      </div>`;
    }).join("") || `<div style="color:var(--text-muted);font-size:0.78rem;padding:4px 0;">No shift records.</div>`;

    const card = document.createElement("div");
    card.style.cssText = `background:var(--card-bg);border:1px solid var(--border);
      border-left:4px solid ${borderColor};border-radius:12px;padding:16px;
      cursor:pointer;transition:box-shadow 0.15s;position:relative;`;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">
        <strong style="font-size:0.95rem;">${emp.fullName || emp.name || "Unknown"}</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${hasOT  ? `<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:8px;font-weight:800;">OT</span>` : ""}
          ${isOpen ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:8px;font-weight:800;">● LIVE</span>` : ""}
          ${noRate ? `<span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:2px 7px;border-radius:8px;font-weight:800;">NO RATE</span>` : ""}
        </div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;">${emp.position || "Staff"}</div>

      <div style="background:#e5e7eb;border-radius:99px;height:8px;margin-bottom:12px;overflow:hidden;display:flex;">
        <div style="width:${regPct.toFixed(1)}%;background:#3b82f6;height:100%;"></div>
        <div style="width:${otPct.toFixed(1)}%;background:#dc2626;height:100%;"></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;">
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Reg</div>
          <div style="font-weight:800;font-size:0.9rem;">${regH.toFixed(1)}h</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);">OT</div>
          <div style="font-weight:800;font-size:0.9rem;color:${hasOT ? "#dc2626" : "var(--text-muted)"};">${hasOT ? otH.toFixed(1)+"h" : "—"}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Total</div>
          <div style="font-weight:800;font-size:0.9rem;">${hours.toFixed(1)}h</div>
        </div>
        <div>
          <div style="font-size:0.7rem;color:var(--text-muted);">Gross</div>
          <div style="font-weight:800;font-size:0.9rem;">${noRate ? "—" : "$"+gross.toFixed(0)}</div>
        </div>
      </div>

      <div class="emp-detail" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">
          ${emp.shifts.length} Shift${emp.shifts.length !== 1 ? "s" : ""}
        </div>
        ${shiftRows}
      </div>

      <div class="expand-hint" style="text-align:center;font-size:0.7rem;color:var(--text-muted);margin-top:10px;opacity:0.5;">
        ▾ tap for shifts
      </div>`;

    card.addEventListener("mouseenter", () => { card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"; });
    card.addEventListener("mouseleave", () => { card.style.boxShadow = "none"; });
    card.addEventListener("click", () => {
      const detail = card.querySelector(".emp-detail");
      const hint   = card.querySelector(".expand-hint");
      const isOpen = detail.style.display !== "none";
      detail.style.display = isOpen ? "none" : "block";
      if (hint) hint.textContent = isOpen ? "▾ tap for shifts" : "▴ hide";
    });

    grid.appendChild(card);
  });
}

// ── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV() {
  const showFICA = $("showFICA")?.checked;
  let csv = showFICA
    ? "Employee,Position,Rate,Reg Hours,OT Hours,Gross,Est. FICA,Est. Net\n"
    : "Employee,Position,Rate,Reg Hours,OT Hours,Gross\n";

  document.querySelectorAll("#payrollBody tr").forEach(row => {
    const cols = row.querySelectorAll("td");
    if (!cols.length) return;
    const cells = Array.from(cols).map((c, i) => i === 0
      ? `"${c.innerText.split("\n").map(s => s.trim()).filter(Boolean).join(" - ")}"`
      : `"${c.innerText.split("\n")[0].trim()}"`
    );
    csv += cells.join(",") + "\n";
  });

  const { start, end } = getPeriodWindow(periodOffset);
  const a = document.createElement("a");
  a.href     = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `payroll-${fmt(start)}-to-${fmt(end)}.csv`.replace(/[\s,]/g, "-");
  a.click();
}

// ── Init & Event Wiring ──────────────────────────────────────────────────────

window.addEventListener("authReady", async e => {
  companyId = e.detail?.companyId;
  const snap = await getDoc(doc(db, "companies", companyId));
  if (snap.exists()) {
    const el = $("companyNameDisplay");
    if (el) el.textContent = snap.data().name;
  }
  await loadPayPeriodConfig();
  calculatePayroll();
});

$("prevPeriod")?.addEventListener("click",    () => { periodOffset--; calculatePayroll(); });
$("nextPeriod")?.addEventListener("click",    () => { if (periodOffset < 0) { periodOffset++; calculatePayroll(); } });
$("currentPeriod")?.addEventListener("click", () => { periodOffset = 0; calculatePayroll(); });

$("periodType")?.addEventListener("change", (e) => {
  payPeriodConfig.type = e.target.value;
  updateConfigPanelVisibility();
});
$("weekStartDay")?.addEventListener("change",   (e) => { payPeriodConfig.startDay        = parseInt(e.target.value); });
$("biweeklyAnchor")?.addEventListener("change", (e) => { payPeriodConfig.anchorDate       = e.target.value; });
$("semiDay1")?.addEventListener("change",       (e) => { payPeriodConfig.semimonthlyDay1  = parseInt(e.target.value); });
$("semiDay2")?.addEventListener("change",       (e) => { payPeriodConfig.semimonthlyDay2  = parseInt(e.target.value); });
$("savePeriodConfig")?.addEventListener("click", savePayPeriodConfig);
$("showFICA")?.addEventListener("change", calculatePayroll);
$("printBtn")?.addEventListener("click",    () => window.print());
$("exportPayroll")?.addEventListener("click", exportToCSV);
$("logoutBtn")?.addEventListener("click",   () => signOut(auth).then(() => location.href = "/login"));

$("empSearch")?.addEventListener("input", () => {
  renderPayroll(_lastEmpData, _lastOtThreshold);
  renderEmpCards(_lastEmpData, _lastOtThreshold);
});

// ── Employee Detail Modal ────────────────────────────────────────────────────

window.openEmpModal = function(empId) {
  const emp = _employeeMap[empId];
  if (!emp) return;

  const otThreshold = _lastOtThreshold;
  const hours = emp.totalMinutes / 60;
  const regH  = otThreshold ? Math.min(hours, otThreshold) : hours;
  const otH   = otThreshold ? Math.max(0, hours - otThreshold) : 0;
  const gross = (regH * emp.hourlyRate) + (otH * emp.hourlyRate * (payPeriodConfig.overtimeMultiplier || 1.5));
  const hasOT = otH > 0;
  const noRate = emp.hourlyRate === 0;

  // Header
  const badges = [
    hasOT       ? `<span style="font-size:11px;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:8px;font-weight:800;margin-left:6px;">OT</span>` : "",
    emp.openShift ? `<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:8px;font-weight:800;margin-left:6px;">● LIVE</span>` : "",
    noRate      ? `<span style="font-size:11px;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:8px;font-weight:800;margin-left:6px;">NO RATE</span>` : "",
  ].join("");

  document.getElementById("empModalName").innerHTML = (emp.fullName || emp.name || "Unknown") + badges;
  document.getElementById("empModalRole").textContent = `${emp.position || "Staff"} · $${emp.hourlyRate.toFixed(2)}/hr`;

  // Stats grid
  const stats = [
    { label: "Regular",  value: regH.toFixed(2) + "h",                   color: "#1e40af" },
    { label: "Overtime", value: hasOT ? otH.toFixed(2) + "h" : "—",      color: hasOT ? "#dc2626" : "#9ca3af" },
    { label: "Total",    value: hours.toFixed(2) + "h",                   color: "inherit" },
    { label: "Est. Gross", value: noRate ? "—" : "$" + gross.toFixed(2), color: "#166534" },
  ];
  document.getElementById("empModalStats").innerHTML = stats.map(s => `
    <div style="background:var(--header-bg);border-radius:10px;padding:12px 8px;">
      <div style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${s.label}</div>
      <div style="font-size:1rem;font-weight:900;color:${s.color};">${s.value}</div>
    </div>`).join("");

  // Progress bar
  const maxH = Math.max(hours, 1);
  document.getElementById("empModalBar").innerHTML = `
    <div style="width:${(regH/maxH*100).toFixed(1)}%;background:#3b82f6;height:100%;"></div>
    <div style="width:${(otH /maxH*100).toFixed(1)}%;background:#dc2626;height:100%;"></div>`;

  // Shift log
  const shifts = emp.shifts || [];
  document.getElementById("empModalShifts").innerHTML = shifts.length
    ? shifts.map(s => {
        const inStr  = new Date(s.in).toLocaleString(undefined, { weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
        const outStr = s.out
          ? new Date(s.out).toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" })
          : "<span style='color:#f59e0b;font-weight:700;'>still open</span>";
        const durH   = s.out ? ((s.out - s.in) / 3600000).toFixed(2) + "h" : "—";
        const flag   = s.flag === "auto-closed"
          ? `<span style="font-size:9px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:6px;margin-left:6px;">auto-closed</span>`
          : "";
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:9px 0;border-bottom:1px solid var(--border);font-size:0.83rem;">
            <div>
              <span style="color:var(--text-muted);">${inStr} → ${outStr}</span>${flag}
            </div>
            <span style="font-weight:800;margin-left:12px;white-space:nowrap;">${durH}</span>
          </div>`;
      }).join("")
    : `<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 0;">No shift records this period.</div>`;

  // Show modal
  const modal = document.getElementById("empModal");
  modal.style.display = "flex";
  requestAnimationFrame(() => modal.style.opacity = "1");
};

window.closeEmpModal = function() {
  const modal = document.getElementById("empModal");
  if (modal) modal.style.display = "none";
};

// Close on backdrop click
document.getElementById("empModal")?.addEventListener("click", (e) => {
  if (e.target === document.getElementById("empModal")) closeEmpModal();
});

// Close on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeEmpModal();
});
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("dark-mode") === "true") {
    document.body.classList.add("dark-mode");
  }
});
