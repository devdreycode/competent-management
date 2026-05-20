import { auth, db } from "./core/firebase.js";

import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  deleteDoc,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
  writeBatch,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// Sync dark mode from localStorage on every page load
if (localStorage.getItem("dark-mode") === "true") {
  document.documentElement.classList.add("dark-mode");
}

const $ = (id) => document.getElementById(id);
/* ===================== TIER LIMITS ===================== */
const TIER_LIMITS = {
  "free": 5,      
  "small": 25,    
  "medium": 50,   
  "large": 75    
};

function canImportEmployees() {
  const tier = window.currentUserTier || "free";
  return tier !== "free";
}

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

/* =====================
   STATE
===================== */
let companyId = null;
let employees = [];
let viewingEmployee = null;
let activePunches = new Set();
let editingEmployeeId = null;
let calledInToday = new Set();
let initialized = false;
let activePositionFilter = "";

/* =====================
   DOM
===================== */
const tableBody = document.getElementById("employeeTableBody");
const companyNameEl = document.getElementById("companyNameDisplay");
const searchInput = document.getElementById("searchInput");
const positionSummaryChips = document.getElementById("positionSummaryChips");

// Moved these to the top so they initialize BEFORE authReady runs!
const btnImportEmp = document.getElementById("btnImportEmp");
const btnExportEmp = document.getElementById("btnExportEmp");
const btnPrintEmp = document.getElementById("btnPrintEmp");
const importInput = document.getElementById("importEmployeesCsv");

const editShift = document.getElementById("editShift");
const cardName = document.getElementById("cardName");
const cardPin = document.getElementById("cardPin");
const cardPay = document.getElementById("cardPay");
const cardShift = document.getElementById("cardShift");
const cardStatus = document.getElementById("cardStatus");
const closeCardBtn = document.getElementById("closeCardBtn");
const editFromViewBtn = document.getElementById("editFromViewBtn");
const employeeSlotInfo = document.getElementById("employeeSlotInfo");
const editPosition = document.getElementById("editPosition");

const cardModal = document.getElementById("employeeCardModal");
const editModal = document.getElementById("editEmployeeModal");
const editFullName = document.getElementById("editFullName");
const editPin = document.getElementById("editPin");
const editRate = document.getElementById("editRate");
const editDob = document.getElementById("editDob");
const editActive = document.getElementById("editActive");
const saveEditEmp = document.getElementById("saveEditEmp");
const cancelEditEmp = document.getElementById("cancelEditEmp");

const openAddEmployeeBtn = document.getElementById("openAddEmployeeBtn");
const addEmpModal = document.getElementById("addEmployeeModal");
const closeAddEmpBtn = document.getElementById("closeAddEmpBtn");
const empForm = document.getElementById("employeeForm");
const empShift = document.getElementById("empShift");
const empName = document.getElementById("empName");
const empPin = document.getElementById("empPin");
const empPay = document.getElementById("empPay");
const empDob = document.getElementById("empDob");
const empRole = document.getElementById("empRole");

function bindFilters() {
  $("searchInput")?.addEventListener("input", render);
  $("filterShift")?.addEventListener("change", render);
  $("filterOnFloor")?.addEventListener("change", render);
}

function normalizeShiftType(v) {
  if (!v) return "";
  const s = v.toString().toLowerCase().trim();
  if (s === "afternoon") return "evening"; 
  return s;
}

function shiftBucket(emp) {
  return normalizeShiftType(
    emp.shiftType || emp.defaultShift || emp.shift || ""
  );
}

function getEmployeeShift(emp) {
  return emp.shiftType || emp.defaultShift || emp.shift || "—";
}

/* ===================== AUTH GATE ===================== */
window.addEventListener("authReady", async (e) => {
  if (initialized) return;

  companyId = e.detail.companyId;
  window.currentUserTier = e.detail.tier || "free";

  if (!companyId) return;

  // Added safety check for btnImportEmp
  if (!canImportEmployees() && btnImportEmp) {
    btnImportEmp.classList.add("locked");
    btnImportEmp.title = "Upgrade required to import employees";
  }

  if (e.detail.role === "Manager" || e.detail.role === "Owner") {
    $("bulkResetBtn")?.classList.remove("hidden");
  }

  await loadCompanyName();
  initialized = true;
  initRealtimeData();
  bindFilters();
  loadEmployeeDropdown();
});

/* =====================
   LOAD COMPANY NAME
===================== */
async function loadCompanyName() {
  const companySnap = await getDoc(doc(db, "companies", companyId));
  if (companySnap.exists()) {
    const companyName = companySnap.data().name || "Company";
    const display = document.getElementById("companyNameDisplay");
    if (display) display.textContent = companyName;
    const printDisplay = document.getElementById("displayCompanyName");
    if (printDisplay) printDisplay.textContent = companyName;
  }
}

async function loadEmployeeDropdown() {
  const dropdown = document.getElementById("employeeSelect");
  if (!dropdown) return;

  const q = collection(db, "companies", companyId, "employees");
  const snap = await getDocs(q);

  dropdown.innerHTML = `<option value="">Select employee...</option>`;
  activePositionFilter = "";
  if (document.getElementById("searchInput")) document.getElementById("searchInput").value = "";
  if (document.getElementById("filterShift")) document.getElementById("filterShift").value = "";
  if (document.getElementById("filterOnFloor")) document.getElementById("filterOnFloor").checked = false;

  snap.forEach(docSnap => {
    const emp = docSnap.data();
    const option = document.createElement("option");
    option.value = docSnap.id;
    option.textContent = `${emp.fullName} (${emp.position || "Staff"})`;
    dropdown.appendChild(option);
  });
}

/* =====================
   LOAD EMPLOYEES
===================== */
async function loadEmployees() {
  if (tableBody) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Loading employees…</td></tr>`;
  }

  const q = query(collection(db, "companies", companyId, "employees"));
  const snap = await getDocs(q);
  
  employees = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      shiftType: normalizeShiftType(data.shiftType || data.defaultShift || data.shift || "morning")
    };
  });

  if (!employees.length && tableBody) {
    tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No employees found</td></tr>`;
    return;
  }
  render();
}

function initRealtimeData() {
  // ================= ON-FLOOR STATUS =================
  const qPunches = query(
    collection(db, "companies", companyId, "punchLogs"),
    where("companyId", "==", companyId)
  );

  onSnapshot(qPunches, (snap) => {
    const statusMap = new Map();
    const logs = snap.docs
      .map(d => d.data())
      .sort((a, b) => b.ts?.seconds - a.ts?.seconds);

    logs.forEach(log => {
      if (!statusMap.has(log.employeeId)) {
        statusMap.set(log.employeeId, log.eventType);
      }
    });

    activePunches.clear();
    statusMap.forEach((type, empId) => {
      if (type === "punch_in" || type === "break_end") {
        activePunches.add(empId);
      }
    });
    render();
  });

  function normalizePositionName(pos) {
    return (pos || "").trim();
  }

  // ================= EMPLOYEE LIST =================
  const qEmp = query(collection(db, "companies", companyId, "employees"));
  onSnapshot(qEmp, (snap) => {
    employees = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        position: normalizePositionName(data.position || data.role)
      };
    });
    render();
  });

  const qCalls = query(
    collection(db, "companies", companyId, "call_ins"),
    where("category", "==", "status_alert")
  );

  onSnapshot(qCalls, (snap) => {
    calledInToday.clear();
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.employeeId) {
        calledInToday.add(data.employeeId);
      }
    });
    render();
  });
}

/* =====================
   RENDER TABLE
===================== */
function render() {
  const tbody = $("employeeTableBody");
  if (!tbody) return;

  const search = ($("searchInput")?.value || "").toLowerCase();
  const shiftFilter = $("filterShift")?.value || "";
  const onFloorOnly = $("filterOnFloor")?.checked || false;

  const filtered = employees.filter(emp => {
    const name = (emp.fullName || "").toLowerCase();
    const matchesSearch = name.includes(search);
    const matchesShift = !shiftFilter || shiftBucket(emp) === normalizeShiftType(shiftFilter);
    const matchesFloor = !onFloorOnly || activePunches.has(emp.id);
    const empPos = (emp.position || emp.role || "").trim();
    const matchesPos = !activePositionFilter || empPos === activePositionFilter;

    return matchesSearch && matchesShift && matchesFloor && matchesPos;
  });

  tbody.innerHTML = filtered.map(emp => {
    const isOnFloor = activePunches.has(emp.id);
    const isCalledIn = calledInToday.has(emp.id);

    let statusHtml = `<span class="status-badge off">Off Floor</span>`;
    if (isCalledIn) {
      statusHtml = `<span class="status-badge off">Called In</span>`;
    } else if (isOnFloor) {
      statusHtml = `<span class="status-badge on">On Floor</span>`;
    }

    return `
      <tr>
        <td><strong>${emp.fullName || "—"}</strong></td>
        <td>${emp.position || emp.role || "—"}</td>
        <td>${getEmployeeShift(emp) || "—"}</td>
        <td>${emp.absences || 0}</td> 
        <td>${statusHtml}</td>
        <td>
          <button class="btn-action ghost" data-view="${emp.id}">View</button>
          <button class="btn-action danger" data-delete="${emp.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="6">No employees match filters</td></tr>`;

  const userTier = window.currentUserTier || "free";
  const limit = TIER_LIMITS[userTier] || 7;
  const used = employees.length;
  const remaining = Math.max(limit - used, 0);

  if (employeeSlotInfo) {
    employeeSlotInfo.textContent = `${used} / ${limit} employees used · ${remaining} slots remaining`;
    employeeSlotInfo.classList.remove("warning", "danger");
    if (remaining <= 2 && remaining > 0) employeeSlotInfo.classList.add("warning");
    if (remaining === 0) {
      employeeSlotInfo.classList.add("danger");
      employeeSlotInfo.textContent = `${used} / ${limit} employees used · Limit reached`;
    }
  }
  renderPositionSummary();
}

/* =====================
   VIEW MODAL
===================== */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-view]");
  if (!btn) return;

  const emp = employees.find(x => x.id === btn.dataset.view);
  if (!emp) return;

  viewingEmployee = emp;
  if (cardName) cardName.textContent = emp.fullName;
  if (cardPin) cardPin.textContent = emp.pin;
  if (cardPay) cardPay.textContent = `$${emp.hourlyRate || 0}`;
  if (cardShift) cardShift.textContent = emp.defaultShift || emp.shift || "—";
  if (cardStatus) cardStatus.textContent = emp.isActive ? "Active" : "Inactive";

  render();
  if (cardModal) cardModal.classList.remove("hidden");
});

// Added Optional Chaining (?)
closeCardBtn?.addEventListener("click", () => {
  if (cardModal) cardModal.classList.add("hidden");
  viewingEmployee = null;
});

/* =====================
   EDIT FROM VIEW
===================== */
// Added Optional Chaining (?)
editFromViewBtn?.addEventListener("click", () => {
  if (!viewingEmployee) return;

  editingEmployeeId = viewingEmployee.id;

  if (editFullName) editFullName.value = viewingEmployee.fullName || "";
  if (editPin) editPin.value = viewingEmployee.pin || "";
  if (editRate) editRate.value = viewingEmployee.hourlyRate || 0;
  if (editDob) editDob.value = viewingEmployee.birthDate || "";
  
  loadCertsUI("editCertsContainer", viewingEmployee.certifications || []);

  if (editActive) editActive.checked = viewingEmployee.isActive !== false;
  if (editPosition) loadPositionOptionsFromSettings(editPosition, viewingEmployee.position || "");

  if (cardModal) cardModal.classList.add("hidden");
  if (editModal) editModal.classList.remove("hidden");
});

/* =====================
   SAVE EDIT
===================== */
// Added Optional Chaining (?)
saveEditEmp?.addEventListener("click", async () => {
  if (!editingEmployeeId) return;
  if (editFullName && !editFullName.value.trim()) { alert("Name is required."); return; }

  try {
    await updateDoc(doc(db, "companies", companyId, "employees", editingEmployeeId), {
      fullName: editFullName ? editFullName.value.trim() : "",
      position: editPosition ? editPosition.value.trim() : "",
      shiftType: editShift ? normalizeShiftType(editShift.value) : "",
      defaultShift: editShift ? editShift.value : "",
      pin: editPin ? editPin.value.trim() : "",
      hourlyRate: editRate ? (Number(editRate.value) || 0) : 0,
      birthDate: editDob ? editDob.value : null,
      certifications: Array.from(document.querySelectorAll('#editCertsContainer .cert-checkbox:checked')).map(cb => cb.value),
      isActive: editActive ? editActive.checked : true
    });
    
    if (editModal) editModal.classList.add("hidden");
    editingEmployeeId = null;
    await loadEmployees();
  } catch (err) {
    console.error("saveEditEmp failed:", err);
    alert("Save failed: " + err.message);
  }
});

// Added Optional Chaining (?)
cancelEditEmp?.addEventListener("click", () => {
  if (editModal) editModal.classList.add("hidden");
  editingEmployeeId = null;
});

/* =====================
   ADD EMPLOYEE
===================== */
// Added Optional Chaining (?)
openAddEmployeeBtn?.addEventListener("click", () => {
  const tier = window.currentUserTier || "free";
  const limit = TIER_LIMITS[tier] || 7;
  
  if (employees.length >= limit) {
    alert(`Your ${tier} plan allows up to ${limit} employees.`);
    return;
  }

  activePositionFilter = "";
  if ($("searchInput")) $("searchInput").value = "";
  if ($("filterShift")) $("filterShift").value = "";
  if ($("filterOnFloor")) $("filterOnFloor").checked = false;

  renderPositionSummary();
  render();

  if (empRole) loadPositionOptionsFromSettings(empRole);
  loadCertsUI("addCertsContainer", []);
  if (addEmpModal) addEmpModal.classList.remove("hidden");
});

// Added Optional Chaining (?)
closeAddEmpBtn?.addEventListener("click", () => {
  if (addEmpModal) addEmpModal.classList.add("hidden");
  if (empForm) empForm.reset();
});

// Added Optional Chaining (?)
empForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const newEmployee = {
    fullName: empName ? empName.value.trim() : "",
    pin: empPin ? empPin.value.trim() : "",
    hourlyRate: empPay ? Number(empPay.value || 0) : 0,
    position: empRole ? empRole.value : "",
    shiftType: normalizeShiftType(empShift?.value || "Morning"),
    defaultShift: empShift?.value || "Morning",
    certifications: Array.from(document.querySelectorAll('#addCertsContainer .cert-checkbox:checked')).map(cb => cb.value),
    absences: 0,
    isActive: true,
    companyId,
    createdAt: serverTimestamp()
  };

  await addDoc(collection(db, "companies", companyId, "employees"), newEmployee);

  if (empForm) empForm.reset();
  if (addEmpModal) addEmpModal.classList.add("hidden");
  await loadEmployees();
  await syncPositionsFromEmployees();
});

/* =====================
   DELETE EMPLOYEE
===================== */
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-delete]");
  if (!btn) return;

  const employeeId = btn.dataset.delete;
  if (!employeeId) return;

  const emp = employees.find(e => e.id === employeeId);
  if (!emp) return;

  const ok = confirm(`Delete ${emp.fullName}? This cannot be undone.`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, "companies", companyId, "employees", employeeId));
    console.log("✅ Deleted employee:", employeeId);
  } catch (err) {
    console.error("❌ Delete failed:", err);
    alert("Delete failed. Check console.");
  }
});

/* =====================
   IMPORT / EXPORT / PRINT
===================== */
btnPrintEmp?.addEventListener("click", () => window.print());

btnExportEmp?.addEventListener("click", async () => {
  if (!employees?.length) await loadEmployees();

  const header = ["fullName", "position", "shift", "absences", "pin", "status", "hourlyRate"];
  const rows = employees.map((e) => [
    (e.fullName || "").replaceAll('"', '""'),
    (e.position || e.role || "").replaceAll('"', '""'),
    (getEmployeeShift(e) || "").replaceAll('"', '""'),
    String(e.absences || 0),
    (e.pin || "").replaceAll('"', '""'),
    (e.isActive === false ? "inactive" : "active"),
    String(e.hourlyRate ?? 0),
  ]);

  const csv = header.join(",") + "\n" + rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `employees_${companyId || "company"}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

btnImportEmp?.addEventListener("click", () => {
  if (!canImportEmployees()) {
    alert("Employee import is available on paid plans.\n\nUpgrade to unlock bulk importing.");
    return;
  }
  if (importInput) importInput.click();
});

importInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = parseCsv(text);

    if (!parsed.length) {
      alert("CSV had no rows.");
      importInput.value = "";
      return;
    }

    const toBoolActive = (status) => {
      const s = String(status || "").trim().toLowerCase();
      if (!s) return true;
      return s === "active" || s === "true" || s === "1" || s === "yes";
    };

    for (const row of parsed) {
      const fullName = (row.fullName || row.name || "").trim();
      const position = (row.position || row.role || row.job || row.jobtitle || row.title || "").trim();
      const pin = String(row.pin || "").trim();
      const hourlyRate = Number(row.hourlyRate ?? 0) || 0;
      const isActive = toBoolActive(row.status);
      const defaultShift = (row.defaultShift || row.shift || "Morning").trim();

      if (!fullName) continue;

      await addDoc(collection(db, "companies", companyId, "employees"), {
        fullName,
        position,
        pin,
        hourlyRate,
        defaultShift,
        shiftType: normalizeShiftType(defaultShift),
        absences: 0,
        isActive,
        createdAt: serverTimestamp()
      });
    }

    alert("✅ Employees imported!");
    await loadEmployees();
    await syncPositionsFromEmployees();

  } catch (err) {
    console.error("❌ Import failed:", err);
    alert("Import failed. Check console.");
  } finally {
    if (importInput) importInput.value = "";
  }
});

async function syncPositionsFromEmployees() {
  const ref = doc(db, "companies", companyId, "schedule_settings", "config");
  const snap = await getDoc(ref);

  let positions = snap.exists() ? (snap.data().positions || {}) : {};
  const SHIFT_TYPES = ["morning", "evening", "night"];
  const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  employees.forEach(emp => {
    const pos = (emp.position || "").trim();
    if (!pos) return;
    if (!positions[pos]) {
      positions[pos] = {};
      SHIFT_TYPES.forEach(shift => {
        positions[pos][shift] = {};
        DAYS.forEach(day => { positions[pos][shift][day] = 0; });
      });
    }
  });

  await setDoc(ref, { positions }, { merge: true });
}

/* ===================== FIXED CSV PARSER ===================== */
function parseCsv(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[norm(h)] = (cols[idx] ?? "").trim(); });

    out.push({
      fullName: obj.fullname || obj.name || "",
      position: obj.position || obj.role || obj.job || obj.jobtitle || obj.title || "",
      pin: obj.pin || "",
      status: obj.status || "",
      hourlyRate: obj.hourlyrate || obj.rate || "",
      defaultShift: obj.shift || obj.defaultshift || "",
    });
  }
  return out;
}

function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"'; i++; continue;
    }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

/* ===================== BULK RESET ===================== */
$("bulkResetBtn")?.addEventListener("click", async () => {
  if (!employees.length) return;
  const ok = confirm(`WARNING: This will reset the absence count to 0 for ALL ${employees.length} employees. This cannot be undone. Proceed?`);
  if (!ok) return;

  try {
    const batch = writeBatch(db);
    employees.forEach((emp) => {
      const empRef = doc(db, "companies", companyId, "employees", emp.id);
      batch.update(empRef, { absences: 0 });
    });
    await batch.commit();
    alert("✅ All employee absence counts have been reset to 0.");
  } catch (err) {
    console.error("Bulk reset failed:", err);
    alert("Error: Bulk reset failed. Check console for details.");
  }
});

async function loadPositionOptionsFromSettings(selectElement, selected = "") {
  const snap = await getDoc(doc(db, "companies", companyId, "schedule_settings", "config"));
  if (!snap.exists()) return;
  const positions = snap.data().positions || {};
  if (selectElement) {
    selectElement.innerHTML = `<option value="">Select position...</option>`;
    Object.keys(positions).sort().forEach(p => {
      const option = document.createElement("option");
      option.value = p;
      option.textContent = p;
      if (p === selected) option.selected = true;
      selectElement.appendChild(option);
    });
  }
}

function getPositionCounts() {
  const counts = {};
  employees.forEach(emp => {
    const pos = (emp.position || emp.role || "Unassigned").trim();
    counts[pos] = (counts[pos] || 0) + 1;
  });
  return counts;
}

function renderPositionSummary() {
  if (!positionSummaryChips) return;
  const counts = getPositionCounts();
  const entries = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));

  if (!entries.length) {
    positionSummaryChips.innerHTML = `<div style="opacity:.75;font-weight:700;">No roles yet</div>`;
    return;
  }

  positionSummaryChips.innerHTML = entries.map(([pos, count]) => {
    const isActive = activePositionFilter === pos;
    return `
      <div class="pos-chip ${isActive ? "active" : ""}" data-pos="${pos}">
        <span>${pos}</span>
        <span class="count">${count}</span>
      </div>
    `;
  }).join("");
}

document.addEventListener("click", (e) => {
  const chip = e.target.closest(".pos-chip");
  if (!chip) return;
  const pos = chip.dataset.pos;
  if (activePositionFilter === pos) {
    activePositionFilter = "";
  } else {
    activePositionFilter = pos;
  }
  renderPositionSummary();
  render(); 
});

function downloadEmployeeTemplate() {
  const csv = `fullName,position,shift,pin,hourlyRate,status\nJohn Smith,Manager,Morning,1234,22.50,active`;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee_import_template.csv";
  a.click();
}

function loadCertsUI(containerId, selectedCerts = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = ""; 

  const settings = JSON.parse(localStorage.getItem('appSettings') || '{}');
  const masterList = (settings.availableCerts || "").split(',').map(s => s.trim()).filter(Boolean);

  if (masterList.length === 0) {
     container.innerHTML = "<span style='font-size:.75rem; color:var(--text-muted);'>No certs added in Settings yet.</span>";
     return;
  }

  masterList.forEach(cert => {
     const label = document.createElement("label");
     label.style.cssText = "display:flex; align-items:center; gap:5px; font-size:.85rem; cursor:pointer;";
     const box = document.createElement("input");
     box.type = "checkbox";
     box.value = cert;
     box.className = "cert-checkbox"; 
     if (selectedCerts.includes(cert)) box.checked = true;

     label.appendChild(box);
     label.appendChild(document.createTextNode(cert));
     container.appendChild(label);
  });
}