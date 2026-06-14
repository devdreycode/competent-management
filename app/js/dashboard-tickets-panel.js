/* ================= IMPORTS ================= */
import { auth, db } from "./core/firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);

/* ================= STATE ================= */
let companyId   = null;
let unsub       = null;

/* ================= RELATIVE TIME ================= */
function formatRelativeTime(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10)  return "Just now";
  if (diff < 60)  return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60)  return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7)   return `${days}d ago`;
  return date.toLocaleDateString();
}

/* ================= STATUS PILL ================= */
function statusPill(status) {
  const map = {
    open:        { label: "Open",        color: "#3b82f6" },
    in_progress: { label: "In Progress", color: "#f59e0b" },
    resolved:    { label: "Resolved",    color: "#22c55e" },
    closed:      { label: "Closed",      color: "#94a3b8" },
  };
  const s = map[status] || { label: status || "—", color: "#94a3b8" };
  return `<span style="
    display:inline-block;
    font-size:.65rem;
    font-weight:700;
    padding:1px 6px;
    border-radius:99px;
    background:${s.color}22;
    color:${s.color};
    border:1px solid ${s.color}44;
    letter-spacing:.03em;
    text-transform:uppercase;
    flex-shrink:0;
  ">${s.label}</span>`;
}

/* ================= AUTH READY ================= */
window.addEventListener("authReady", (e) => {
  companyId = e.detail?.companyId || window.companyId;
  if (!companyId) return;
  subscribeTickets();
});

/* ================= PANEL CONTROLS ================= */
window.toggleTicketPanel = (e) => {
  e?.stopPropagation();
  const panel = $("ticketPanel");
  if (!panel) return;
  const isOpen = panel.style.display === "block";
  // Close notif panel if open
  const notifPanel = $("notifPanel");
  if (notifPanel) notifPanel.style.display = "none";
  panel.style.display = isOpen ? "none" : "block";
};

window.closeTicketPanel = () => {
  const panel = $("ticketPanel");
  if (panel) panel.style.display = "none";
};

/* ================= RENDER ================= */
function renderTicketPanel(snap) {
  const list    = $("ticketPanelList");
  const badge   = $("ticketPanelCount");
  const empty   = $("ticketPanelEmpty");

  if (!list || !badge || !empty) return;

  const docs = snap.docs;

  // Badge = open + in_progress count
  const activeCount = docs.filter(d => {
    const s = d.data().status;
    return s === "open" || s === "in_progress";
  }).length;

  badge.textContent   = activeCount;
  badge.style.display = activeCount ? "inline-block" : "none";

  if (docs.length === 0) {
    list.innerHTML      = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";

  list.innerHTML = docs.map(d => {
    const t  = d.data();
    const ts = t.createdAt?.toDate?.().getTime() || 0;
    const isDue = t.dueDate && t.status !== "resolved" && t.dueDate.toDate() < new Date();

    return `
      <div class="tpanel-item"
           data-id="${d.id}"
           onclick="window.location.href='/app/pages/ticketmanagement.html?companyId=${companyId}&ticketId=${d.id}'"
           style="cursor:pointer;">
        <div class="tpanel-top">
          <span class="tpanel-reason">${t.reason || "Ticket"}</span>
          ${statusPill(t.status)}
        </div>
        <div class="tpanel-meta">
          <span class="tpanel-who">👤 ${t.employeeName || "—"}</span>
          <span class="tpanel-time">${formatRelativeTime(t.createdAt)}</span>
          ${isDue ? `<span class="tpanel-overdue">⚠ Overdue</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

/* ================= SUBSCRIBE ================= */
function subscribeTickets() {
  if (!companyId) return;
  if (unsub) unsub();

  const q = query(
    collection(db, "companies", companyId, "tickets"),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  unsub = onSnapshot(q, renderTicketPanel);
}

/* ================= CLICK OUTSIDE TO CLOSE ================= */
document.addEventListener("click", (e) => {
  const panel = $("ticketPanel");
  const icon  = $("ticketPanelBell");
  if (panel && icon && !panel.contains(e.target) && !icon.contains(e.target)) {
    window.closeTicketPanel();
  }
});