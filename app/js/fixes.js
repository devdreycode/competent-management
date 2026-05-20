/**
 * fixes.js — WorkForce Manager patch
 * Drop into /js/ and add as last script tag in index.html:
 *   <script type="module" src="js/fixes.js"></script>
 *
 * Covers only genuine gaps — does NOT re-implement anything
 * already handled by employee.js, payroll.js, ticketmanagement.js etc.
 *
 *  1. Notification bell + panel (togglePanel, markAllRead)
 *  2. Ticket slide panel (closePanel, updateTicketStatus, send message)
 *  3. editActive checkbox injected into edit modal at runtime
 *  4. Company logo upload + remove
 *  5. Punch log switchTab (index context only)
 *  6. Upgrade button → modal
 *  7. filterLogs bridge (punchlogs._filterLogsImpl → window.filterLogs)
 */
import { auth, db } from "./core/firebase.js";
import {
  collection, doc, query, where,
  orderBy, getDocs, addDoc, updateDoc,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const cid = () => window.companyId;

/* ─────────────────────────────────────────
   TOAST
───────────────────────────────────────── */
function showToast(msg, type = "success") {
  const existing = $("wfm-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "wfm-toast";
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:${type === "error" ? "#ef4444" : "#16a34a"};color:#fff;
    padding:10px 20px;border-radius:10px;font-size:.85rem;font-weight:600;
    z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ─────────────────────────────────────────
   WAIT FOR companyId
───────────────────────────────────────── */
function waitForCid(cb, tries = 0) {
  if (window.companyId) return cb();
  if (tries > 60) return;
  setTimeout(() => waitForCid(cb, tries + 1), 200);
}

/* ═════════════════════════════════════════
   1. NOTIFICATION BELL + PANEL
═════════════════════════════════════════ */
let _notifUnsub = null;

window.togglePanel = function(e) {
  if (e) e.stopPropagation();
  const panel = $("notifPanel");
  if (!panel) return;
  const isOpen = panel.style.display !== "none";
  panel.style.display = isOpen ? "none" : "block";
  if (!isOpen) _loadNotifications();
};

document.addEventListener("click", (e) => {
  const panel = $("notifPanel");
  const bell  = $("notifBell");
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.style.display = "none";
  }
});

window.markAllRead = function(e) {
  if (e) e.stopPropagation();
  if (!cid()) return;
  getDocs(query(
    collection(db, "companies", cid(), "notifications"),
    where("read", "==", false)
  )).then(snap => {
    snap.forEach(d => updateDoc(d.ref, { read: true }));
    _renderNotifications([]);
  }).catch(err => console.warn("markAllRead:", err));
};

function _loadNotifications() {
  if (!cid()) return;
  getDocs(query(
    collection(db, "companies", cid(), "notifications"),
    orderBy("createdAt", "desc")
  )).then(snap => {
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderNotifications(notifs.filter(n => !n.read));
  }).catch(err => console.warn("loadNotifications:", err));
}

function _renderNotifications(notifs) {
  const list    = $("notifList");
  const empty   = $("notifEmpty");
  const markBtn = $("notifMarkAll");
  const countEl = $("notifCount");
  if (!list) return;

  list.innerHTML = "";
  const count = notifs.length;

  if (countEl) {
    countEl.style.display = count > 0 ? "flex" : "none";
    countEl.textContent   = count > 9 ? "9+" : count;
  }
  if (markBtn) {
    markBtn.disabled    = count === 0;
    markBtn.textContent = count > 0 ? "Mark all read" : "All caught up";
  }
  if (empty) empty.style.display = count === 0 ? "block" : "none";

  notifs.forEach(n => {
    const item = document.createElement("div");
    item.style.cssText = "padding:10px 14px;border-bottom:1px solid var(--chrome-border);cursor:pointer;font-size:.82rem;";
    item.innerHTML = `
      <div style="font-weight:600;color:var(--text);margin-bottom:3px;">${n.title || "Notification"}</div>
      <div style="color:var(--text-muted);line-height:1.4;">${n.message || ""}</div>
    `;
    item.onclick = () => {
      if (cid()) updateDoc(doc(db, "companies", cid(), "notifications", n.id), { read: true });
      item.style.opacity = "0.5";
    };
    list.appendChild(item);
  });
}

// Live badge
waitForCid(() => {
  if (_notifUnsub) _notifUnsub();
  _notifUnsub = onSnapshot(
    query(collection(db, "companies", cid(), "notifications"), where("read", "==", false)),
    snap => {
      const count = snap.size;
      const el = $("notifCount");
      if (el) {
        el.style.display = count > 0 ? "flex" : "none";
        el.textContent   = count > 9 ? "9+" : count;
      }
    }
  );
});

/* ═════════════════════════════════════════
   2. TICKET SLIDE PANEL
   closePanel / updateTicketStatus / send
   were called inline but never defined.
═════════════════════════════════════════ */
let _activePanelTicketId = null;
let _panelMsgUnsub       = null;

window.closePanel = function() {
  $("ticketPanel")?.classList.remove("open");
  $("overlay")?.classList.remove("active");
  document.body.style.overflow = "";
  _activePanelTicketId = null;
  if (_panelMsgUnsub) { _panelMsgUnsub(); _panelMsgUnsub = null; }
};

window.openTicketPanel = function(ticketId, title, sub) {
  _activePanelTicketId = ticketId;
  if ($("panelTitle")) $("panelTitle").textContent = title || "Ticket";
  if ($("panelSub"))   $("panelSub").textContent   = sub   || "—";
  $("ticketPanel")?.classList.add("open");
  $("overlay")?.classList.add("active");
  document.body.style.overflow = "hidden";
  _loadPanelMessages(ticketId);
};

window.updateTicketStatus = function(status, btn) {
  if (!_activePanelTicketId || !cid()) return;
  updateDoc(doc(db, "companies", cid(), "tickets", _activePanelTicketId), { status })
    .then(() => {
      document.querySelectorAll(".status-btn").forEach(b => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
      showToast("Status updated");
    })
    .catch(() => showToast("Failed to update status", "error"));
};

function _loadPanelMessages(ticketId) {
  if (_panelMsgUnsub) _panelMsgUnsub();
  const container = $("panelMessages");
  if (!container || !cid()) return;
  container.innerHTML = "";

  _panelMsgUnsub = onSnapshot(
    query(
      collection(db, "companies", cid(), "tickets", ticketId, "messages"),
      orderBy("createdAt")
    ),
    snap => {
      container.innerHTML = "";
      if (snap.empty) {
        container.innerHTML = `<div class="empty"><div class="empty-icon">💬</div><div>No messages yet</div></div>`;
        return;
      }
      snap.forEach(d => {
        const m     = d.data();
        const ts    = m.createdAt?.toDate
          ? m.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "";
        const isMgr = m.senderRole === "manager";
        const div   = document.createElement("div");
        div.style.cssText = `display:flex;flex-direction:column;align-items:${isMgr ? "flex-end" : "flex-start"};margin-bottom:10px;padding:0 16px;`;
        div.innerHTML = `
          <div style="max-width:80%;background:${isMgr ? "var(--accent)" : "var(--surface)"};
            color:${isMgr ? "#fff" : "var(--text)"};border-radius:12px;
            padding:8px 12px;font-size:.845rem;line-height:1.45;">${m.text}</div>
          <div style="font-size:.68rem;color:var(--text-muted);margin-top:3px;">${ts}</div>
        `;
        container.appendChild(div);
      });
      container.scrollTop = container.scrollHeight;
    }
  );
}

async function _sendPanelMessage() {
  const inp  = $("panelMsgInput");
  const text = inp?.value?.trim();
  if (!text || !_activePanelTicketId || !cid()) return;
  inp.value = "";
  try {
    await addDoc(
      collection(db, "companies", cid(), "tickets", _activePanelTicketId, "messages"),
      { text, senderRole: "manager", createdAt: serverTimestamp() }
    );
    await updateDoc(doc(db, "companies", cid(), "tickets", _activePanelTicketId), {
      lastMessage: text, lastMessageAt: serverTimestamp()
    });
  } catch(err) {
    showToast("Failed to send", "error");
  }
}

$("panelSendBtn")?.addEventListener("click", _sendPanelMessage);
$("panelMsgInput")?.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _sendPanelMessage(); }
});

/* ═════════════════════════════════════════
   3. editActive CHECKBOX — RUNTIME PATCH
   employee.js saves editActive.checked but
   the HTML edit modal never had that field.
   Injecting it so saves don't crash silently.
═════════════════════════════════════════ */
(function patchEditModal() {
  if ($("editActive")) return; // already exists, skip
  const modal = $("editEmployeeModal");
  if (!modal) return;
  const body = modal.querySelector(".modal-body");
  if (!body) return;
  const row = document.createElement("div");
  row.className = "field";
  row.style.marginTop = "8px";
  row.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.845rem;font-weight:600;">
      <input type="checkbox" id="editActive" checked>
      Active Employee
    </label>
  `;
  body.appendChild(row);
})();

/* ═════════════════════════════════════════
   4. COMPANY LOGO UPLOAD + REMOVE
═════════════════════════════════════════ */
function _applyLogo(dataUrl) {
  const preview   = $("logoPreview");
  const brandMark = $("brandMark");
  const removeBtn = $("removeLogoBtn");
  if (preview)   preview.innerHTML   = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:9px;">`;
  if (brandMark) brandMark.innerHTML = `<img src="${dataUrl}" style="width:28px;height:28px;object-fit:cover;border-radius:6px;">`;
  if (removeBtn) removeBtn.style.display = "inline-flex";
}

try {
  const saved = localStorage.getItem("companyLogo");
  if (saved) _applyLogo(saved);
} catch(e) {}

$("logoFileInput")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return showToast("Logo must be under 2MB", "error");
  const reader = new FileReader();
  reader.onload = ev => {
    localStorage.setItem("companyLogo", ev.target.result);
    _applyLogo(ev.target.result);
    showToast("Logo saved");
  };
  reader.readAsDataURL(file);
});

$("removeLogoBtn")?.addEventListener("click", () => {
  localStorage.removeItem("companyLogo");
  const preview   = $("logoPreview");
  const brandMark = $("brandMark");
  const removeBtn = $("removeLogoBtn");
  const input     = $("logoFileInput");
  if (preview)   preview.innerHTML   = "⚡";
  if (brandMark) brandMark.innerHTML = "⚡";
  if (removeBtn) removeBtn.style.display = "none";
  if (input)     input.value = "";
  showToast("Logo removed");
});

/* ═════════════════════════════════════════
   5. PUNCH LOG TAB SWITCHER (index context)
   Only overrides window.switchTab when we
   are NOT on the employee portal page.
═════════════════════════════════════════ */
if (!window.location.pathname.includes("employee-portal")) {
  window.switchTab = function(tabId) {
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    const content = $(tabId);
    const btn     = $("btn-" + tabId);
    if (content) content.classList.add("active");
    if (btn)     btn.classList.add("active");
  };
}

/* ═════════════════════════════════════════
   6. UPGRADE BUTTON → MODAL
═════════════════════════════════════════ */
$("upgradeBtn")?.addEventListener("click", () => {
  const modal = $("upgradeModal");
  if (modal) modal.style.display = "flex";
});

window.handleUpgradeClick = function() {
  // TODO: replace with Microsoft IAP call when ready:
  // window.Windows?.Services?.Store?.StoreContext?.getDefault()?.requestPurchaseAsync(storeId)
  showToast("Upgrade coming soon — thank you for your interest! ⚡");
};

/* ═════════════════════════════════════════
   7. SEARCH BRIDGE
   index.html calls filterLogs() inline.
   punchlogs.js exposes _filterLogsImpl.
   employee.js handles its own search
   internally so we only need this for
   the punch logs tab.
═════════════════════════════════════════ */
window.filterLogs = function(value) {
  if (typeof window._filterLogsImpl === "function") {
    window._filterLogsImpl(value);
  }
};

console.info("✅ fixes.js loaded");