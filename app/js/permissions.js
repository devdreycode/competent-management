// js/core/permissions.js
// Unified permission checker for Competent Management.
//
// USAGE (any page):
//   import { can, loadPermissions } from "./core/permissions.js";
//
//   window.addEventListener("authReady", async (e) => {
//     await loadPermissions(e.detail.companyId, e.detail.role, e.detail.tier);
//     if (!can("editSchedule")) { /* hide button, redirect, etc */ }
//   });

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ─── Hardcoded defaults for Free/Starter (no custom roles) ───────────────────
const DEFAULT_PERMISSIONS = {
  owner: {
    viewSchedule:       true,
    editSchedule:       true,
    publishSchedule:    true,
    approveSwaps:       true,
    viewEmployees:      true,
    editEmployees:      true,
    manageInvites:      true,
    viewPayRates:       true,
    viewPayroll:        true,
    exportPayroll:      true,
    viewPunchLogs:      true,
    editPunches:        true,
    viewTickets:        true,
    manageTickets:      true,
    viewDashboard:      true,
    viewReports:        true,
    editSettings:       true,
    manageRoles:        true,
  },
  manager: {
    viewSchedule:       true,
    editSchedule:       true,
    publishSchedule:    true,
    approveSwaps:       true,
    viewEmployees:      true,
    editEmployees:      true,
    manageInvites:      true,
    viewPayRates:       true,
    viewPayroll:        true,
    exportPayroll:      false,
    viewPunchLogs:      true,
    editPunches:        true,
    viewTickets:        true,
    manageTickets:      true,
    viewDashboard:      true,
    viewReports:        true,
    editSettings:       false,
    manageRoles:        false,
  },
  shift_leader: {
    viewSchedule:       true,
    editSchedule:       false,
    publishSchedule:    false,
    approveSwaps:       true,
    viewEmployees:      true,
    editEmployees:      false,
    manageInvites:      false,
    viewPayRates:       false,
    viewPayroll:        false,
    exportPayroll:      false,
    viewPunchLogs:      true,
    editPunches:        false,
    viewTickets:        true,
    manageTickets:      false,
    viewDashboard:      true,
    viewReports:        false,
    editSettings:       false,
    manageRoles:        false,
  },
  employee: {
    viewSchedule:       true,
    editSchedule:       false,
    publishSchedule:    false,
    approveSwaps:       false,
    viewEmployees:      false,
    editEmployees:      false,
    manageInvites:      false,
    viewPayRates:       false,
    viewPayroll:        false,
    exportPayroll:      false,
    viewPunchLogs:      false,
    editPunches:        false,
    viewTickets:        true,
    manageTickets:      false,
    viewDashboard:      false,
    viewReports:        false,
    editSettings:       false,
    manageRoles:        false,
  }
};

// Tiers that unlock custom roles
const CUSTOM_ROLES_TIERS = ["growth", "pro"];

// Active resolved permissions for this session
let _resolved = {};
let _loaded   = false;

/**
 * Load permissions for the current user.
 * Called once after authReady.
 * @param {string} companyId
 * @param {string} role        - role name (could be custom role doc ID on growth/pro)
 * @param {string} tier        - free | starter | growth | pro
 */
export async function loadPermissions(companyId, role, tier) {
  _loaded   = false;
  _resolved = {};

  const isCustomTier = CUSTOM_ROLES_TIERS.includes(tier);

  if (isCustomTier) {
    // Try to load custom role from Firestore
    try {
      const roleSnap = await getDoc(
        doc(db, "companies", companyId, "roles", role)
      );
      if (roleSnap.exists()) {
        _resolved = roleSnap.data()?.permissions || {};
        _loaded   = true;
        return;
      }
    } catch (_) { /* fall through to defaults */ }
  }

  // Fall back to hardcoded defaults
  _resolved = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS["employee"];
  _loaded   = true;
}

/**
 * Check if the current user has a permission.
 * @param {string} key  - e.g. "editSchedule"
 * @returns {boolean}
 */
export function can(key) {
  if (!_loaded) return false;
  return !!_resolved[key];
}

/**
 * Returns the full resolved permissions object (for UI rendering).
 */
export function getAllPermissions() {
  return { ..._resolved };
}

/**
 * Returns a list of all available permission keys with human labels.
 * Used by the role builder UI.
 */
export const PERMISSION_LABELS = [
  // Schedule
  { key: "viewSchedule",    label: "View Schedule",         group: "Schedule"   },
  { key: "editSchedule",    label: "Edit Schedule",         group: "Schedule"   },
  { key: "publishSchedule", label: "Publish Schedule",      group: "Schedule"   },
  { key: "approveSwaps",    label: "Approve Shift Swaps",   group: "Schedule"   },
  // Employees
  { key: "viewEmployees",   label: "View Employees",        group: "Employees"  },
  { key: "editEmployees",   label: "Add / Edit Employees",  group: "Employees"  },
  { key: "manageInvites",   label: "Manage Invites",        group: "Employees"  },
  // Payroll
  { key: "viewPayRates",    label: "View Pay Rates",        group: "Payroll"    },
  { key: "viewPayroll",     label: "View Payroll Estimates",group: "Payroll"    },
  { key: "exportPayroll",   label: "Export Payroll",        group: "Payroll"    },
  // Punch Log
  { key: "viewPunchLogs",   label: "View Punch Logs",       group: "Punch Log"  },
  { key: "editPunches",     label: "Edit / Correct Punches",group: "Punch Log"  },
  // Tickets
  { key: "viewTickets",     label: "View Tickets",          group: "Tickets"    },
  { key: "manageTickets",   label: "Manage / Close Tickets",group: "Tickets"    },
  // Reports
  { key: "viewDashboard",   label: "View Dashboard",        group: "Reports"    },
  { key: "viewReports",     label: "View Reports",          group: "Reports"    },
  // Settings
  { key: "editSettings",    label: "Edit Company Settings", group: "Settings"   },
  { key: "manageRoles",     label: "Manage Roles",          group: "Settings"   },
];

/**
 * Load all custom roles for a company (for the role builder listing).
 * Growth/Pro only.
 */
export async function loadCompanyRoles(companyId) {
  try {
    const snap = await getDocs(collection(db, "companies", companyId, "roles"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) {
    return [];
  }
}