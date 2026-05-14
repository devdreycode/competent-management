const $ = (id) => document.getElementById(id);

import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc,
  collection, addDoc,
  serverTimestamp,
  getDocs, query, where, onSnapshot, updateDoc,    // ← add this
  deleteField
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

let uid = null;
let companyId = null;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let shiftTypes = ["morning", "evening", "night"];
let employeesUnsub = null;
let selectedShift = "morning";
let selectedDay = "Mon";
let coverageState = {};
let requiredCertsState = {}; // { "Cashier": ["Food Handler"], ... }
let deletedPositions = [];
let currentShiftFilter = "all";

// DOM refs — declared here so loadSettings() can safely reference them
const positionList = document.getElementById("positionList");
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showToast(msg, type = "success") {
  const toast = $("toast");
  const toastMsg = $("toastMsg");
  if (!toast || !toastMsg) return;
  toastMsg.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}
function to12h(timeStr) {
  if (!timeStr) return "";
  
  let [hours, minutes] = timeStr.split(":");
  hours = parseInt(hours, 10);
  
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12; // Converts 0 to 12 for midnight, 13 to 1, etc.
  
  // Drops the ":00" so it cleanly matches your existing "9am-5pm" style
  if (minutes === "00") {
    return `${hours}${ampm}`;
  }
  
  return `${hours}:${minutes}${ampm}`;
}
function markDirty() {
  const hint = $("saveBarHint");
  if (hint) hint.textContent = "You have unsaved changes.";
}

async function ensureCompanyId() {
  if (companyId) return companyId;

  const ls = localStorage.getItem("companyId");
  if (ls) {
    companyId = ls;
    return companyId;
  }

  const user = auth.currentUser;
  if (!user) return null;

  uid = user.uid;

  try {
    const snap = await getDoc(doc(db, "app_user", uid));
    if (snap.exists()) {
      const data = snap.data() || {};
      const cid = data.companyId || data.company_id || null;
      if (cid) {
        companyId = cid;
        localStorage.setItem("companyId", cid);
        return companyId;
      }
    }
  } catch (err) {
    console.error("ensureCompanyId failed:", err);
  }

  return null;
}

async function mergePositionsFromEmployees(cid, existingPositions) {
  const positions = existingPositions || {};
  const before = new Set(Object.keys(positions));

  const q = collection(db, "companies", cid, "employees");
  const snap = await getDocs(q);

  const found = new Set();
  snap.forEach((d) => {
    const e = d.data() || {};
   const name = String(e.position || e.role || "")
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, c => c.toUpperCase());
    if (name) found.add(name);
  });

  found.forEach((posName) => {
    if (!positions[posName]) {
      positions[posName] = {};
      shiftTypes.forEach((shift) => {
        const coverage = {};
        DAYS.forEach((day) => (coverage[day] = 0));
        positions[posName][shift] = coverage;
      });
    }
  });

  const added = [...found].filter((p) => !before.has(p));
  return { positions, added };
}
async function saveSettingsAuto() {
  const cid = await ensureCompanyId();
  if (!cid) return;

 await setDoc(
  doc(db, "companies", cid, "schedule_settings", "config"),
  {
    positions: coverageState,
    shiftTypes,
    requiredCerts: requiredCertsState,
    updatedAt: serverTimestamp()
  },
  { merge: true }
);
}

async function loadSettings() {
  const cid = await ensureCompanyId();
  if (!cid) return;
  if (!positionList) return;

  try {
    const ref = doc(db, "companies", cid, "schedule_settings", "config");
    const snap = await getDoc(ref);

    let positions = {};
    if (snap.exists()) {
      const data = snap.data() || {};
      positions = data.positions || {};
      coverageState = JSON.parse(JSON.stringify(positions || {}));
      requiredCertsState = JSON.parse(JSON.stringify(data.requiredCerts || {}));
deletedPositions = data.deletedPositions || [];
      // Migrate old flat format { Mon: 0, Tue: 0 } to nested { shift: { Mon: 0 } }
      Object.keys(positions).forEach(posName => {
        const val = positions[posName];
        if (val && typeof val === "object" && DAYS.some(d => d in val)) {
          const upgraded = {};
          shiftTypes.forEach(shift => {
            upgraded[shift] = { ...val };
          });
          positions[posName] = upgraded;
        }
      });

      if (Array.isArray(data.shiftTypes) && data.shiftTypes.length) {
        shiftTypes = data.shiftTypes;
      }
      renderShiftTypes();
    }

    const merged = await mergePositionsFromEmployees(cid, positions);
    positions = merged.positions;

    if (merged.added.length) {
      await setDoc(
        ref,
        { companyId: cid, positions, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
coverageState = JSON.parse(JSON.stringify(positions || {}));

if (!Object.keys(coverageState).length) {
  coverageState = {};
}

renderShiftTabs();
renderDayList();
renderCoveragePanel();
renderCertRequirements();
  } catch (err) {
    console.error("loadSettings failed:", err);
    positionList.innerHTML = "";
   
  }
}


function ensureCoveragePath(position, shift, day) {
  if (!coverageState[position]) coverageState[position] = {};
  if (!coverageState[position][shift]) coverageState[position][shift] = {};
  if (coverageState[position][shift][day] == null) {
    coverageState[position][shift][day] = 0;
  }
}



function properDayName(day) {
  if (day === "Mon") return "Monday";
  if (day === "Tue") return "Tuesday";
  if (day === "Wed") return "Wednesday";
  if (day === "Thu") return "Thursday";
  if (day === "Fri") return "Friday";
  if (day === "Sat") return "Saturday";
  if (day === "Sun") return "Sunday";
  return day;
}

function renderShiftTabs() {
  document.querySelectorAll(".shift-tab").forEach((btn) => {
    if (btn.dataset.shift === selectedShift) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function renderDayList() {
  document.querySelectorAll(".day-pill").forEach((btn) => {
    if (btn.dataset.day === selectedDay) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function renderCoveragePanel() {
  const title = document.getElementById("coveragePanelTitle");
  const list = document.getElementById("positionList");

  if (!title || !list) return;

  const prettyShift =
    selectedShift.charAt(0).toUpperCase() + selectedShift.slice(1);

  title.textContent = `${prettyShift} · ${properDayName(selectedDay)}`;

  list.innerHTML = "";

  const positions = Object.keys(coverageState).sort();

  if (!positions.length) {
    list.innerHTML = `<div>No positions yet.</div>`;
    return;
  }

  positions.forEach((positionName) => {
    if (!coverageState[positionName]) {
      coverageState[positionName] = {};
    }

    if (!coverageState[positionName][selectedShift]) {
      coverageState[positionName][selectedShift] = {};
    }

    if (coverageState[positionName][selectedShift][selectedDay] == null) {
      coverageState[positionName][selectedShift][selectedDay] = 0;
    }

    const count = coverageState[positionName][selectedShift][selectedDay];

    const row = document.createElement("div");
    row.className = "position-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 44px 50px 44px 44px";
    row.style.gap = "10px";
    row.style.alignItems = "center";
    row.style.marginBottom = "12px";

    row.innerHTML = `
      <div style="font-weight:700;">${positionName}</div>

      <button type="button" data-minus="${positionName}">−</button>

      <div style="text-align:center; font-weight:700;">${count}</div>

      <button type="button" data-plus="${positionName}">+</button>

      <button type="button" data-remove="${positionName}">🗑</button>
    `;

    list.appendChild(row);
  });
}
function renderCertRequirements() {
  const list = document.getElementById("certRequirementsList");
  const empty = document.getElementById("certRequirementsEmpty");
  if (!list) return;

  // Get master cert list from localStorage (saved by App Settings)
  let masterCerts = [];
  try {
    const appSettings = JSON.parse(localStorage.getItem("appSettings") || "{}");
    masterCerts = (appSettings.availableCerts || "")
      .split(",").map(s => s.trim()).filter(Boolean);
  } catch(e) {}

  const positions = Object.keys(coverageState).sort();
  list.innerHTML = "";

  if (!positions.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  positions.forEach(posName => {
    const selected = requiredCertsState[posName] || [];

    const row = document.createElement("div");
    row.style.cssText = "display:flex; flex-direction:column; gap:6px; padding:12px; background:var(--bg2,#f8fafc); border-radius:8px; border:1px solid var(--border,#e2e8f0);";

    const label = document.createElement("div");
    label.style.cssText = "font-weight:700; font-size:.88rem;";
    label.textContent = posName;
    row.appendChild(label);

    if (!masterCerts.length) {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:.78rem; color:var(--text-muted,#64748b); font-style:italic;";
      hint.textContent = "No certifications defined yet. Add them in App Settings → Certifications.";
      row.appendChild(hint);
    } else {
      const checkboxWrap = document.createElement("div");
      checkboxWrap.style.cssText = "display:flex; gap:12px; flex-wrap:wrap;";

      masterCerts.forEach(cert => {
        const lbl = document.createElement("label");
        lbl.style.cssText = "display:flex; align-items:center; gap:5px; font-size:.83rem; cursor:pointer;";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = cert;
        cb.dataset.pos = posName;
        cb.className = "cert-req-checkbox";
        cb.checked = selected.includes(cert);

        cb.addEventListener("change", () => {
          if (!requiredCertsState[posName]) requiredCertsState[posName] = [];
          if (cb.checked) {
            if (!requiredCertsState[posName].includes(cert)) {
              requiredCertsState[posName].push(cert);
            }
          } else {
            requiredCertsState[posName] = requiredCertsState[posName].filter(c => c !== cert);
          }
          markDirty();
        });

        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(cert));
        checkboxWrap.appendChild(lbl);
      });

      row.appendChild(checkboxWrap);
    }

    list.appendChild(row);
  });
}

/* ---------- AUTH ---------- */


onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  uid = user.uid;

 await loadSettings();

if (!companyId) {
  await ensureCompanyId();
}

await loadShiftUiFromSettings();
await loadAutoSchedulerSettings();

watchEmployeesForChanges();
});

/* ---------- SAVE ---------- */
$("saveBtn")?.addEventListener("click", async () => {
  const cid = await ensureCompanyId();
  if (!cid) return alert("Company not loaded.");

  const ms = $("morningStart")?.value.trim() || "07:00";
  const me = $("morningEnd")?.value.trim() || "15:00";
  const es = $("eveningStart")?.value.trim() || "15:00";
  const ee = $("eveningEnd")?.value.trim() || "23:00";
  const ns = $("nightStart")?.value.trim() || "23:00";
  const ne = $("nightEnd")?.value.trim() || "07:00";

  const partOfDayTimes = {
    morningStart: ms,
    morningEnd: me,
    eveningStart: es,
    eveningEnd: ee,
    nightStart: ns,
    nightEnd: ne,
    morning: ms && me ? `${to12h(ms)}-${to12h(me)}` : "",
    evening: es && ee ? `${to12h(es)}-${to12h(ee)}` : "",
    night:   ns && ne ? `${to12h(ns)}-${to12h(ne)}` : "",
  };


  const positions = coverageState;

  // Collect checked off days
  const offDays = Array.from(
    document.querySelectorAll(".offday-check:checked")
  ).map(cb => cb.value);

  const weeklyHours = parseInt($("weeklyHours")?.value || "40", 10);

  const autoScheduler = {
    weekStart:         parseInt($("weekStart")?.value ?? "1", 10),
    respectAvail:      $("respectAvail")?.checked  ?? true,
    enforceRest:       $("enforceRest")?.checked   ?? true,
    warnOvertime:      $("warnOvertime")?.checked  ?? true,
    autoFillPositions: $("autoFillPositions")?.checked ?? true,
    offDays,
    weeklyHours,
  };

  try {
    await setDoc(doc(db, "companies", cid, "schedule_settings", "config"), {
      companyId: cid,
      partOfDayTimes,
      positions,
      shiftTypes,
      autoScheduler,
      requiredCerts: JSON.parse(JSON.stringify(requiredCertsState)),
      updatedAt: serverTimestamp()
    }, { merge: true });

    showToast("✅ Settings saved!", "success");
    const hint = $("saveBarHint");
    if (hint) hint.textContent = "All changes saved.";
  } catch (err) {
    console.error("Save failed:", err);
    showToast("❌ Failed to save settings.", "error");
  }
});
/* ---------- RESET ---------- */
$("resetBtn")?.addEventListener("click", () => {
  const ok = confirm(
    "Reset ALL coverage numbers to 0?\n\nThis does NOT delete positions and is not saved until you click Save."
  );
  if (!ok) return;

  // Zero out every count in coverageState (all shifts, all days)
  Object.keys(coverageState).forEach(pos => {
    Object.keys(coverageState[pos] || {}).forEach(shift => {
      Object.keys(coverageState[pos][shift] || {}).forEach(day => {
        coverageState[pos][shift][day] = 0;
      });
    });
  });

  renderCoveragePanel();
  showToast("Coverage reset to 0. Click Save to apply.", "success");
});
$("shiftSelect")?.addEventListener("change", (e) => {
  selectedShift = e.target.value;
  renderCoveragePanel();
});

/* ---------- ADD POSITION ---------- */
$("addBtn")?.addEventListener("click", () => {
  const input = $("positionInput");
  const raw = input?.value.trim() || "";
  if (!raw) {
    alert("Enter a position name first.");
    return;
  }

  const name = raw
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  if (coverageState[name]) {
    alert("That position already exists.");
    return;
  }

  coverageState[name] = {};
  shiftTypes.forEach((shift) => {
    coverageState[name][shift] = {};
    DAYS.forEach((day) => {
      coverageState[name][shift][day] = 0;
    });
  });

  input.value = "";

  renderCoveragePanel();
  renderCertRequirements();
  markDirty();

  // 🔥 IMPORTANT: keep Firebase in sync immediately
  saveSettingsAuto?.();
});


document.addEventListener("click", async (e) => {
  const plusBtn = e.target.closest("[data-plus]");
  const minusBtn = e.target.closest("[data-minus]");
  const removeBtn = e.target.closest("[data-remove]");

  if (plusBtn) {
    const name = plusBtn.dataset.plus;
    ensureCoveragePath(name, selectedShift, selectedDay);
    coverageState[name][selectedShift][selectedDay]++;

    renderCoveragePanel();
    markDirty();
    saveSettingsAuto?.();
    return;
  }

  if (minusBtn) {
    const name = minusBtn.dataset.minus;
    ensureCoveragePath(name, selectedShift, selectedDay);

    coverageState[name][selectedShift][selectedDay] = Math.max(
      0,
      coverageState[name][selectedShift][selectedDay] - 1
    );

    renderCoveragePanel();
    markDirty();
    saveSettingsAuto?.();
    return;
  }

  if (removeBtn) {
  const name = removeBtn.dataset.remove;

  const cid = await ensureCompanyId();
  if (!cid) return;

  const snap = await getDocs(collection(db, "companies", cid, "employees"));
  const exists = snap.docs.some(doc => {
    const pos = (doc.data().position || "").trim().toLowerCase();
    return pos === name.trim().toLowerCase();
  });

  if (exists) {
    alert("Cannot delete. Employees are assigned to this position.");
    return;
  }

if (!confirm(`Remove ${name}?`)) return;

delete coverageState[name];
delete requiredCertsState[name];

// remember deleted position
if (!deletedPositions.includes(name.toLowerCase())) {
  deletedPositions.push(name.toLowerCase());
}
  // ✅ Use deleteField() so Firestore actually removes the key
  const { deleteField } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
 await updateDoc(
  doc(db, "companies", cid, "schedule_settings", "config"),
  {
    [`positions.${name}`]: deleteField(),
    [`requiredCerts.${name}`]: deleteField(),
    deletedPositions,
    updatedAt: serverTimestamp()
  }
);

  renderCoveragePanel();
  renderCertRequirements();
  markDirty();
  return;
}
});

$("backBtn")?.addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.href = "index.html";
});

/* ---------- DAY PILLS — wire clicks ---------- */
document.addEventListener("click", (e) => {
  const pill = e.target.closest(".day-pill");
  if (!pill || !pill.dataset.day) return;
  selectedDay = pill.dataset.day;
  renderDayList();
  renderCoveragePanel();
});

function renderShiftTypes() {
  const box = $("shiftChips");
  if (!box) return;
  box.innerHTML = "";
  shiftTypes.forEach((s) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<b>${escapeHtml(s)}</b>`;
    box.appendChild(chip);
  });
}

async function syncPositionsAndShiftsFromEmployees() {
  const cid = await ensureCompanyId();
  if (!cid) return;

  const empSnap = await getDocs(
    collection(db, "companies", cid, "employees")
  );

  const foundPositions = new Set();
  const foundShifts = new Set();

  empSnap.forEach((d) => {
    const e = d.data() || {};
   const pos = String(e.position || e.role || "")
  .trim()
  .toLowerCase()
  .replace(/\b\w/g, c => c.toUpperCase());
    const sh = (e.defaultShift || e.shift || "").trim();
    if (pos) foundPositions.add(pos);
    if (sh) foundShifts.add(sh);
  });

 

 
foundPositions.forEach((p) => {
  // Skip positions user intentionally deleted
  if (deletedPositions.includes(p.toLowerCase())) return;

  if (!coverageState[p]) {
    coverageState[p] = {};

    shiftTypes.forEach((shift) => {
      coverageState[p][shift] = {};

      DAYS.forEach((day) => {
        coverageState[p][shift][day] = 0;
      });
    });
  }
});

// only set defaults if empty
if (!shiftTypes || shiftTypes.length === 0) {
  shiftTypes = ["morning", "evening", "night"];
}
renderShiftTypes();
renderCoveragePanel();

}

function watchEmployeesForChanges() {
  if (!companyId) return;

  if (typeof employeesUnsub === "function") employeesUnsub();

  const q = query(
    collection(db, "companies", companyId, "employees")
  );

  employeesUnsub = onSnapshot(q, async () => {
    console.log("🔄 Employees changed → syncing schedule settings");
    await syncPositionsAndShiftsFromEmployees();
  });
}

/* =====================
   SHIFT TIMES
===================== */

async function preloadShiftTimes() {
  const cid = await ensureCompanyId();
  if (!cid) return;

  const snap = await getDoc(doc(db, "companies", cid, "schedule_settings", "config"));
  if (!snap.exists()) return;

  const data = snap.data() || {};
  const map = data.partOfDayTimes || {};

  // Modal inputs
  const mt = $("morningTime");
  const et = $("eveningTime");
  const nt = $("nightTime");
  if (mt) mt.value = map.morning || "";
  if (et) et.value = map.evening || "";
  if (nt) nt.value = map.night || "";

  // Inline grid inputs
  if (map.morningStart && $("morningStart")) $("morningStart").value = map.morningStart;
  if (map.morningEnd   && $("morningEnd"))   $("morningEnd").value   = map.morningEnd;
  if (map.eveningStart && $("eveningStart")) $("eveningStart").value = map.eveningStart;
  if (map.eveningEnd   && $("eveningEnd"))   $("eveningEnd").value   = map.eveningEnd;
  if (map.nightStart   && $("nightStart"))   $("nightStart").value   = map.nightStart;
  if (map.nightEnd     && $("nightEnd"))     $("nightEnd").value     = map.nightEnd;
}

async function loadShiftUiFromSettings() {
  const cid = await ensureCompanyId();
  if (!cid) return;

  const snap = await getDoc(doc(db, "companies", cid, "schedule_settings", "config"));
  const data = snap.exists() ? (snap.data() || {}) : {};

  const modeSel = $("shiftDisplayMode");
  if (modeSel) modeSel.value = data.shiftDisplayMode || "part";

  const map = data.partOfDayTimes || {};
  if ($("morningTime"))  $("morningTime").value  = map.morning      || "";
  if ($("eveningTime"))  $("eveningTime").value  = map.evening      || "";
  if ($("nightTime"))    $("nightTime").value    = map.night        || "";
  if ($("morningStart")) $("morningStart").value = map.morningStart || "";
  if ($("morningEnd"))   $("morningEnd").value   = map.morningEnd   || "";
  if ($("eveningStart")) $("eveningStart").value = map.eveningStart || "";
  if ($("eveningEnd"))   $("eveningEnd").value   = map.eveningEnd   || "";
  if ($("nightStart"))   $("nightStart").value   = map.nightStart   || "";
  if ($("nightEnd"))     $("nightEnd").value     = map.nightEnd     || "";
}

/* =====================
   SHIFT TIME MODAL
===================== */

function openShiftTimeModal() {
  const modal = $("shiftTimeModal");
  if (modal) modal.style.display = "flex";
}

function closeShiftTimeModal() {
  const modal = $("shiftTimeModal");
  if (modal) modal.style.display = "none";
}

$("editTimeOfDayBtn")?.addEventListener("click", async () => {
  await preloadShiftTimes();
  openShiftTimeModal();
});

$("closeShiftModalX")?.addEventListener("click", closeShiftTimeModal);
$("closeShiftModal")?.addEventListener("click", closeShiftTimeModal);

$("saveShiftTimes")?.addEventListener("click", async () => {
  const cid = await ensureCompanyId();
  if (!cid) { alert("Company not ready yet."); return; }

  const ms = $("morningStart")?.value.trim() || "";
  const me = $("morningEnd")?.value.trim() || "";
  const es = $("eveningStart")?.value.trim() || "";
  const ee = $("eveningEnd")?.value.trim() || "";
  const ns = $("nightStart")?.value.trim() || "";
  const ne = $("nightEnd")?.value.trim() || "";

  const partOfDayTimes = {
    morningStart: ms,
    morningEnd: me,
    eveningStart: es,
    eveningEnd: ee,
    nightStart: ns,
    nightEnd: ne,
    morning: ms && me ? `${to12h(ms)}-${to12h(me)}` : "",
    evening: es && ee ? `${to12h(es)}-${to12h(ee)}` : "",
    night:   ns && ne ? `${to12h(ns)}-${to12h(ne)}` : "",
  };

  await setDoc(
    doc(db, "companies", cid, "schedule_settings", "config"),
    { companyId: cid, partOfDayTimes, updatedAt: serverTimestamp() },
    { merge: true }
  );

  alert("✅ Shift times saved");
  closeShiftTimeModal();
});

async function loadAutoSchedulerSettings() {
  const cid = await ensureCompanyId();
  if (!cid) return;

  const snap = await getDoc(doc(db, "companies", cid, "schedule_settings", "config"));
  const data = snap.exists() ? (snap.data() || {}) : {};
  const as = data.autoScheduler || {};

  if ($("weekStart") && as.weekStart != null) $("weekStart").value = String(as.weekStart);
  if ($("respectAvail")      && as.respectAvail      != null) $("respectAvail").checked      = as.respectAvail;
  if ($("enforceRest")       && as.enforceRest       != null) $("enforceRest").checked       = as.enforceRest;
  if ($("warnOvertime")      && as.warnOvertime       != null) $("warnOvertime").checked      = as.warnOvertime;
  if ($("autoFillPositions") && as.autoFillPositions != null) $("autoFillPositions").checked = as.autoFillPositions;

  // Load off days
  const savedOffDays = Array.isArray(as.offDays) ? as.offDays : [];
  document.querySelectorAll(".offday-check").forEach(cb => {
    cb.checked = savedOffDays.includes(cb.value);
  });

  // Load weekly hours
  if ($("weeklyHours") && as.weeklyHours != null) {
    $("weeklyHours").value = String(as.weeklyHours);
  }
}


/* =====================
   MULTI-SELECT COVERAGE GRID
===================== */

let isSelecting = false;
let selectedCells = new Set();

function isCoverageCell(el) {
  return el && el.classList && el.classList.contains("num");
}

function addToSelection(el) {
  if (!isCoverageCell(el)) return;
  el.classList.add("selected");
  selectedCells.add(el);
}

function clearSelection() {
  selectedCells.forEach((el) => el.classList.remove("selected"));
  selectedCells.clear();
}

document.addEventListener("mousedown", (e) => {
  const el = e.target;
  if (!isCoverageCell(el)) return;
  isSelecting = true;
  clearSelection();
  addToSelection(el);
  el.focus();
  el.select?.();
  e.preventDefault();
});

document.addEventListener("mouseover", (e) => {
  if (!isSelecting) return;
  const el = e.target;
  if (!isCoverageCell(el)) return;
  addToSelection(el);
});

document.addEventListener("mouseup", () => {
  isSelecting = false;
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearSelection();
});

let isBulkUpdating = false;

document.addEventListener("input", (e) => {
  if (isBulkUpdating) return;
  const el = e.target;
  if (!isCoverageCell(el)) return;
  if (!selectedCells.has(el)) return;
  if (selectedCells.size <= 1) return;

  const val = el.value;
  isBulkUpdating = true;
  selectedCells.forEach((cell) => {
    if (cell === el) return;
    cell.value = val;
  });
  isBulkUpdating = false;
})