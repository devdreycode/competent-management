/* ================= IMPORTS ================= */
import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ================= HELPERS ================= */
const $ = (id) => document.getElementById(id);

/* ================= STATE ================= */
let companyId        = null;
let unsub            = null;
let notifInitialized = false;

/* ================= RELATIVE TIME ================= */
function formatRelativeTime(ts) {
  if (!ts) return "Just now";
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

/* ================= DING ================= */
// Self-contained ding — no dependency on window.playNotifSound.
// Uses the Web Audio API to synthesize a soft two-tone chime.
// Falls back gracefully if the browser blocks autoplay.
function dingNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Resume in case the context is suspended (common before a user gesture)
    const play = () => {
      // First tone  — higher pitch
      const osc1  = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type      = "sine";
      osc1.frequency.setValueAtTime(880, ctx.currentTime);           // A5
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.4);

      // Second tone — lower pitch, slight delay
      const osc2  = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type      = "sine";
      osc2.frequency.setValueAtTime(660, ctx.currentTime + 0.15);   // E5
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.55);
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(play);
    } else {
      play();
    }

    // Also call the legacy hook if it exists (keeps compatibility)
    if (typeof window.playNotifSound === "function") {
      window.playNotifSound("new_ticket");
    }
  } catch (err) {
    console.warn("dingNotification: audio unavailable", err);
  }
}

/* ================= AUTH READY ================= */
window.addEventListener("authReady", (e) => {
  companyId = e.detail?.companyId || window.companyId;
  if (!companyId) {
    console.warn("dashboard-notifications: no companyId");
    return;
  }
  subscribe();
});

/* ================= PANEL CONTROLS ================= */
// NOTE: named closeNotifPanel (not closePanel) to avoid conflicting
// with the ticket slide panel's closePanel() in ticketOverview.js
window.toggleNotifPanel = (e) => {
  e?.stopPropagation();
  const panel = $("notifPanel");
  if (!panel) return;
  panel.style.display = panel.style.display === "block" ? "none" : "block";
};

window.closeNotifPanel = () => {
  const panel = $("notifPanel");
  if (panel) panel.style.display = "none";
};

// Keep togglePanel as alias so the bell onclick still works
window.togglePanel = window.toggleNotifPanel;

/* ================= MARK ALL READ ================= */
window.markAllRead = async (e) => {
  e?.stopPropagation();
  if (!companyId) return;

  try {
    const q = query(
      collection(db, "companies", companyId, "notifications"),
      where("read", "==", false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.forEach(docSnap => batch.update(docSnap.ref, { read: true }));
    await batch.commit();

    const badge = $("notifCount");
    if (badge) {
      badge.style.display = "none";
      badge.textContent  = "0";
    }
  } catch (err) {
    console.error("markAllRead failed:", err);
  }
};

/* ================= FILTER (manager-only view) ================= */
// Filters the raw Firestore snapshot down to notifications that belong
// to the manager panel (no employeeId, target is "manager" or unset).
function filterManagerDocs(snapshot) {
  const docs = snapshot.docs.filter(d => {
    const data = d.data();
    return !data.employeeId && (data.target === "manager" || !data.target);
  });
  return { docs, empty: docs.length === 0 };
}

/* ================= RENDER ================= */
function render(snapshot) {
  const list      = $("notifList");
  const badge     = $("notifCount");
  const empty     = $("notifEmpty");
  const markAllBtn = $("notifMarkAll");

  if (!list || !badge || !empty) return;

  // Work only with manager-targeted notifications in the UI
  const { docs, empty: isEmpty } = filterManagerDocs(snapshot);
  const unreadDocs = docs.filter(d => !d.data().read);

  // Badge
  badge.textContent  = unreadDocs.length;
  badge.style.display = unreadDocs.length ? "inline-block" : "none";

  // Mark-all button state
  if (markAllBtn) {
    const allCaughtUp = isEmpty || unreadDocs.length === 0;
    markAllBtn.disabled    = allCaughtUp;
    markAllBtn.textContent = allCaughtUp ? "All caught up" : "Mark all read";
  }

  if (isEmpty) {
    list.innerHTML          = "";
    empty.style.display     = "block";
    return;
  }

  empty.style.display = "none";

  list.innerHTML = docs.map(d => {
    const n  = d.data();
    const ts = n.createdAt?.toDate?.().getTime() || 0;
    return `
      <div class="notif-item ${n.read ? "" : "unread"}"
           data-id="${d.id}"
           data-ts="${ts}">
        <div class="notif-title">${n.title || "Notification"}</div>
        <div class="notif-meta">
          ${n.message || ""}
          <div class="notif-time">${formatRelativeTime(n.createdAt)}</div>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".notif-item").forEach(el => {
    el.onclick = async () => {
      const id = el.dataset.id;
      try {
        const batch = writeBatch(db);
        batch.update(
          doc(db, "companies", companyId, "notifications", id),
          { read: true, readAt: serverTimestamp() }
        );
        await batch.commit();
        el.classList.remove("unread");
      } catch (err) {
        console.error("Mark notification read failed:", err);
      }
    };
  });
}

/* ================= SUBSCRIBE ================= */
function subscribe() {
  if (!companyId) return;
  if (unsub) unsub();

  const q = query(
    collection(db, "companies", companyId, "notifications"),
    orderBy("createdAt", "desc"),
    limit(25)
  );

  unsub = onSnapshot(q, (snap) => {
    render(snap);

    // Only ding for genuinely new unread docs that arrive after first load.
    // We check docChanges() against the raw snapshot (before manager filter)
    // so we don't miss a ding due to the filter running first.
    if (notifInitialized) {
      const hasNew = snap.docChanges().some(change =>
        change.type === "added" && change.doc.data().read === false
      );
      if (hasNew) dingNotification();
    }

    notifInitialized = true;
  });
}

/* ================= CLICK OUTSIDE TO CLOSE ================= */
document.addEventListener("click", (e) => {
  const panel = $("notifPanel");
  const bell  = $("notifBell");
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
    window.closeNotifPanel();
  }
});

/* ================= DEBUG: FAKE NOTIFICATION ================= */
window.addFakeNotification = (title, message) => {
  const list  = $("notifList");
  const badge = $("notifCount");

  const fakeId = "fake-" + Date.now();
  const html = `
    <div class="notif-item unread" id="${fakeId}">
      <div class="notif-title">${title}</div>
      <div class="notif-meta">
        ${message}
        <div class="notif-time">Just now</div>
      </div>
    </div>
  `;

  if (list) {
    list.insertAdjacentHTML("afterbegin", html);
    document.getElementById(fakeId).onclick = (e) => {
      e.currentTarget.classList.remove("unread");
    };
  }

  if (badge) {
    badge.textContent  = parseInt(badge.textContent || "0") + 1;
    badge.style.display = "inline-block";
  }

  dingNotification();
};