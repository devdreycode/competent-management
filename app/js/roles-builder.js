// js/roles-builder.js
// Custom role builder for Growth/Pro tier.
// Drop this script on settings.html and call wireRolesBuilder() after authReady.
//
// Renders into: <div id="rolesBuilderRoot"></div>
// Requires: permissions.js, firebase.js, appState on window

import { db } from "./core/firebase.js";
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  PERMISSION_LABELS,
  loadCompanyRoles
} from "./core/permissions.js";

// ─── Built-in role templates for quick-start ─────────────────────────────────
const TEMPLATES = {
  manager: {
    name: "Manager",
    permissions: {
      viewSchedule:true,editSchedule:true,publishSchedule:true,approveSwaps:true,
      viewEmployees:true,editEmployees:true,manageInvites:true,
      viewPayRates:true,viewPayroll:true,exportPayroll:false,
      viewPunchLogs:true,editPunches:true,
      viewTickets:true,manageTickets:true,
      viewDashboard:true,viewReports:true,
      editSettings:false,manageRoles:false
    }
  },
  shift_leader: {
    name: "Shift Leader",
    permissions: {
      viewSchedule:true,editSchedule:false,publishSchedule:false,approveSwaps:true,
      viewEmployees:true,editEmployees:false,manageInvites:false,
      viewPayRates:false,viewPayroll:false,exportPayroll:false,
      viewPunchLogs:true,editPunches:false,
      viewTickets:true,manageTickets:false,
      viewDashboard:true,viewReports:false,
      editSettings:false,manageRoles:false
    }
  },
  employee: {
    name: "Employee",
    permissions: {
      viewSchedule:true,editSchedule:false,publishSchedule:false,approveSwaps:false,
      viewEmployees:false,editEmployees:false,manageInvites:false,
      viewPayRates:false,viewPayroll:false,exportPayroll:false,
      viewPunchLogs:false,editPunches:false,
      viewTickets:true,manageTickets:false,
      viewDashboard:false,viewReports:false,
      editSettings:false,manageRoles:false
    }
  }
};

// ─── Group permission labels by group key ─────────────────────────────────────
function grouped() {
  const map = {};
  for (const p of PERMISSION_LABELS) {
    if (!map[p.group]) map[p.group] = [];
    map[p.group].push(p);
  }
  return map;
}

// ─── State ────────────────────────────────────────────────────────────────────
let _roles      = [];   // loaded from Firestore
let _editing    = null; // { id, name, permissions } or null for new
let _companyId  = null;

// ─── Main entry ───────────────────────────────────────────────────────────────
export async function wireRolesBuilder() {
  const tier      = window.appState?.tier;
  const companyId = window.appState?.companyId;
  const root      = document.getElementById("rolesBuilderRoot");
  if (!root || !companyId) return;

  _companyId = companyId;

  // Tier gate
  if (!["growth", "pro"].includes(tier)) {
    root.innerHTML = `
      <div class="roles-upgrade-gate">
        <div class="roles-gate-icon">🔒</div>
        <div class="roles-gate-title">Custom Roles</div>
        <div class="roles-gate-sub">
          Create fully custom roles with per-permission control.<br>
          Available on <strong>Growth</strong> and <strong>Pro</strong> plans.
        </div>
        <a href="/pricing.html" class="btn btn-primary" style="margin-top:16px;">Upgrade Plan →</a>
      </div>
    `;
    return;
  }

  await refreshRolesList();
}

// ─── Refresh roles list from Firestore ────────────────────────────────────────
async function refreshRolesList() {
  _roles = await loadCompanyRoles(_companyId);
  renderList();
}

// ─── Render the roles list view ───────────────────────────────────────────────
function renderList() {
  const root = document.getElementById("rolesBuilderRoot");
  if (!root) return;

  root.innerHTML = `
    <div class="roles-header">
      <div>
        <div class="roles-title">Custom Roles</div>
        <div class="roles-sub">${_roles.length} role${_roles.length !== 1 ? "s" : ""} configured</div>
      </div>
      <button class="btn btn-primary btn-sm" id="newRoleBtn">+ New Role</button>
    </div>

    <div class="roles-list" id="rolesList">
      ${_roles.length === 0 ? `
        <div class="roles-empty">
          No custom roles yet. Create one or start from a template.
        </div>
      ` : _roles.map(r => `
        <div class="role-row" data-id="${r.id}">
          <div class="role-row-left">
            <div class="role-row-name">${r.name}</div>
            <div class="role-row-count">
              ${Object.values(r.permissions || {}).filter(Boolean).length} / ${PERMISSION_LABELS.length} permissions
            </div>
          </div>
          <div class="role-row-actions">
            <button class="btn btn-ghost btn-sm edit-role-btn" data-id="${r.id}">Edit</button>
            <button class="btn btn-ghost btn-sm delete-role-btn" data-id="${r.id}"
              style="color:var(--red,#ef4444);">Delete</button>
          </div>
        </div>
      `).join("")}
    </div>

    <div class="roles-templates">
      <div class="roles-template-label">Start from a template</div>
      <div class="roles-template-row">
        ${Object.entries(TEMPLATES).map(([key, t]) => `
          <button class="btn btn-ghost btn-sm template-btn" data-template="${key}">
            + ${t.name}
          </button>
        `).join("")}
      </div>
    </div>
  `;

  // Wire buttons
  root.querySelector("#newRoleBtn")?.addEventListener("click", () => openEditor(null));

  root.querySelectorAll(".edit-role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const role = _roles.find(r => r.id === btn.dataset.id);
      if (role) openEditor(role);
    });
  });

  root.querySelectorAll(".delete-role-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteRole(btn.dataset.id));
  });

  root.querySelectorAll(".template-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = TEMPLATES[btn.dataset.template];
      if (t) openEditor({ id: null, name: t.name, permissions: { ...t.permissions } });
    });
  });
}

// ─── Open the editor for a role ───────────────────────────────────────────────
function openEditor(role) {
  _editing = role
    ? { id: role.id || null, name: role.name || "", permissions: { ...role.permissions } }
    : { id: null, name: "", permissions: {} };

  renderEditor();
}

// ─── Render the editor view ───────────────────────────────────────────────────
function renderEditor() {
  const root = document.getElementById("rolesBuilderRoot");
  if (!root) return;

  const groups = grouped();
  const perms  = _editing.permissions || {};

  root.innerHTML = `
    <div class="roles-editor-header">
      <button class="btn btn-ghost btn-sm" id="backToListBtn">← Back</button>
      <div class="roles-editor-title">
        ${_editing.id ? "Edit Role" : "New Role"}
      </div>
    </div>

    <div class="roles-editor-body">
      <div class="field" style="margin-bottom:20px;">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-muted);
                      text-transform:uppercase;letter-spacing:.06em;">Role Name</label>
        <input id="roleNameInput" type="text" class="form-input"
          placeholder="e.g. Kitchen Lead"
          value="${_editing.name}"
          style="margin-top:6px;max-width:320px;">
      </div>

      ${Object.entries(groups).map(([groupName, items]) => `
        <div class="perm-group">
          <div class="perm-group-label">${groupName}</div>
          ${items.map(p => `
            <div class="perm-row">
              <label class="perm-label">${p.label}</label>
              <label class="toggle">
                <input type="checkbox" class="perm-check" data-key="${p.key}"
                  ${perms[p.key] ? "checked" : ""}>
                <span class="slider"></span>
              </label>
            </div>
          `).join("")}
        </div>
      `).join("")}
    </div>

    <div class="roles-editor-footer">
      <button class="btn btn-ghost btn-sm" id="cancelEditBtn">Cancel</button>
      <button class="btn btn-primary" id="saveRoleBtn">
        ${_editing.id ? "Save Changes" : "Create Role"}
      </button>
    </div>
  `;

  root.querySelector("#backToListBtn")?.addEventListener("click", renderList);
  root.querySelector("#cancelEditBtn")?.addEventListener("click", renderList);
  root.querySelector("#saveRoleBtn")?.addEventListener("click", saveRole);

  // Live update _editing.permissions as checkboxes change
  root.querySelectorAll(".perm-check").forEach(cb => {
    cb.addEventListener("change", () => {
      _editing.permissions[cb.dataset.key] = cb.checked;
    });
  });

  root.querySelector("#roleNameInput")?.addEventListener("input", (e) => {
    _editing.name = e.target.value.trim();
  });
}

// ─── Save role to Firestore ───────────────────────────────────────────────────
async function saveRole() {
  const saveBtn = document.getElementById("saveRoleBtn");
  if (!_editing.name) {
    alert("Please enter a role name.");
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving..."; }

  try {
    // Use existing id or generate a slug from name
    const id = _editing.id
      || _editing.name.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

    await setDoc(
      doc(db, "companies", _companyId, "roles", id),
      {
        name:        _editing.name,
        permissions: _editing.permissions,
        updatedAt:   serverTimestamp()
      },
      { merge: true }
    );

    await refreshRolesList();
    renderList();
  } catch (err) {
    alert("Failed to save role. Please try again.");
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Changes"; }
  }
}

// ─── Delete role ──────────────────────────────────────────────────────────────
async function deleteRole(id) {
  if (!confirm("Delete this role? Employees assigned to it will lose custom permissions.")) return;
  try {
    await deleteDoc(doc(db, "companies", _companyId, "roles", id));
    await refreshRolesList();
  } catch (err) {
    alert("Failed to delete role. Please try again.");
  }
}