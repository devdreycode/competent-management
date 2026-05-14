import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { db } from "../js/auth-share.js";

const $ = (id) => document.getElementById(id);

let companyId = null;

let payrollSettings = {
  overtimeThreshold: 40,
  overtimeMultiplier: 1.5,
  defaultHourlyRate: 15,
  payPeriod: "weekly",

  showPayrollEstimates: true,
  breaksCountAsHours: false,
  roundPunches: false,
};

window.addEventListener("authReady", async (e) => {
  companyId = e.detail.companyId;

  await loadPayrollSettings();
});
console.log("companyId:", companyId);
async function loadPayrollSettings() {
  try {
    if (!companyId) return; // <-- must be first

    const ref = doc(
      db,
      "companies",
      companyId,
      "payroll_settings",
      "config"
    );

    const snap = await getDoc(ref);

    if (snap.exists()) {
      payrollSettings = {
        ...payrollSettings,
        ...snap.data()
      };
    }

    syncUI();

  } catch (err) {
    console.error("Failed loading payroll settings:", err);
  }
}

function syncUI() {

  $("settingOvertimeThreshold").value =
    payrollSettings.overtimeThreshold ?? 40;

  $("overtimeMultiplier").value =
    payrollSettings.overtimeMultiplier ?? 1.5;

  $("settingDefaultRate").value =
    payrollSettings.defaultHourlyRate ?? 15;

  $("payPeriod").value =
    payrollSettings.payPeriod ?? "weekly";

  $("showPayrollEstimates").checked =
    payrollSettings.showPayrollEstimates !== false;

  $("breaksCountAsHours").checked =
    payrollSettings.breaksCountAsHours === true;

  $("roundPunches").checked =
    payrollSettings.roundPunches === true;
}

function pullUIValues() {

  payrollSettings.overtimeThreshold =
    Number($("settingOvertimeThreshold").value);

  payrollSettings.overtimeMultiplier =
    Number($("overtimeMultiplier").value);

  payrollSettings.defaultHourlyRate =
    Number($("settingDefaultRate").value);

  payrollSettings.payPeriod =
    $("payPeriod").value;

  payrollSettings.showPayrollEstimates =
    $("showPayrollEstimates").checked;

  payrollSettings.breaksCountAsHours =
    $("breaksCountAsHours").checked;

  payrollSettings.roundPunches =
    $("roundPunches").checked;
}

$("savePayroll")?.addEventListener("click", async () => {

  if (!companyId) {
    alert("Company not loaded yet. Try again in a second.");
    return;
  }

  try {

    pullUIValues();

    await setDoc(
      doc(
        db,
        "companies",
        companyId,
        "payroll_settings",
        "config"
      ),
      payrollSettings
    );

    alert("Payroll settings saved.");

  } catch (err) {

    console.error(err);

    alert("Failed to save payroll settings.");
  }
});