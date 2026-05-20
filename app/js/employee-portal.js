import { auth, db } from "./core/firebase.js";
import { 
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  setDoc,
  doc,
  onSnapshot,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let companyId = new URLSearchParams(window.location.search).get("companyId") || localStorage.getItem("companyId");
if(!companyId){
 alert("Missing company ID. Please access the portal through your company link.");
 throw new Error("CompanyId missing");
}

localStorage.setItem("companyId",companyId);

// ── Declare ALL shared state BEFORE any function calls or auto-login ──
let verifiedEmployee = null;
let activeTicketId = null;
let typingTimer;
let _ticketsUnsub = null;
let _typingUnsub = null;
let _messagesUnsub = null;

// ── Expose switchTab to window BEFORE auto-login block runs ──
// (full implementation is defined further below but window assignment happens here
//  so that inline onclick attributes in the HTML can call it immediately)
window.switchTab = (tab) => {
  document.querySelectorAll('.form-section')
    .forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-links a')
    .forEach(a => a.classList.remove('active'));
  const targetForm = document.getElementById(`form-${tab}`);
  const targetNav  = document.getElementById(`nav-${tab}`);
  if (targetForm) targetForm.classList.add('active');
  if (targetNav)  targetNav.classList.add('active');
  if (tab === 'support')       loadEmployeeTickets();
  if (tab === 'hours')         loadHoursAndPay();
  if (tab === 'archive')       loadArchivedTickets();
  if (tab === 'notifications') loadEmployeeNotifications();
};

const savedSession = localStorage.getItem("employeeSession");

if(savedSession){
  verifiedEmployee = JSON.parse(savedSession);

  if (typeof window.showPortalContent === "function") {
    window.showPortalContent({
      name:  verifiedEmployee.fullName,
      role:  verifiedEmployee.position || verifiedEmployee.role || "—",
      shift: verifiedEmployee.defaultShift || verifiedEmployee.shift || "—"
    });
  }

  loadEmployeeTickets();
  loadCoworkers();
  loadEmployeeNotifications();
  loadHomeDashboard();
}

document.getElementById("chatPanelMsgInput")?.addEventListener("input", async () => {

  if (!activeTicketId) return;

  await setDoc(
  doc(db,"companies",companyId,"tickets",activeTicketId,"typing","status"),
  { employee: true },
  { merge: true }
);

  clearTimeout(typingTimer);

  typingTimer = setTimeout(async () => {

    await setDoc(
      doc(db, "companies", companyId, "tickets", activeTicketId, "typing", "status"),
      { employee: false },
      { merge: true }
    );

  }, 1500);

});
function listenTyping(ticketId) {
  // Unsubscribe previous listener before attaching a new one
  if (_typingUnsub) { _typingUnsub(); _typingUnsub = null; }

  _typingUnsub = onSnapshot(
    doc(db, "companies", companyId, "tickets", ticketId, "typing", "status"),
    (snap) => {
      const indicator = document.getElementById("chatPanelTyping");
      if (!indicator) return;
      // Only show when the MANAGER is typing — employee doesn't need to see themselves
      indicator.innerText = (snap.exists() && snap.data().manager)
        ? "Manager is typing..."
        : "";
    }
  );
}
// --- UTILS ---
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay() || 7; // Mon=1..Sun=7
  x.setDate(x.getDate() - day + 1);
  return startOfDay(x);
}

// --- COWORKER APPROVES SWAP ---
window.confirmSwap = async (notifId) => {
  try {
    const notifSnap = await getDoc(doc(db, "companies", companyId, "notifications", notifId));
    if (!notifSnap.exists()) return;
    const n = notifSnap.data();

   await addDoc(collection(db, "companies", companyId, "tickets"), {
  type: "shift_swap",
  reason: "Swap Request",                          // ← fixed
  employeeId:       n.requesterId,
  employeeName:     n.requesterName,
  swapTargetId:     verifiedEmployee.id,           // ← was targetEmployeeId (wrong field name)
  swapTargetName:   verifiedEmployee.fullName,     // ← was targetEmployeeName (wrong field name)
  swapDate:         n.date,
  status: "open",
  submittedByEmployee: true,
  unreadManager: true,
  unreadEmployee: false,
  createdAt: serverTimestamp()
});
    // 2. Send "Good News" back to the requester
    await addDoc(collection(db, "companies", companyId, "notifications"), {
      employeeId: n.requesterId, // Sent to the person who started the swap
      title: "✅ Swap Accepted",
      message: `${verifiedEmployee.fullName} accepted your swap for ${n.date}. Waiting for manager approval.`,
      status: "unread",
      type: "info",
      createdAt: serverTimestamp()
    });

    // 3. Hide the old notification
    await updateDoc(doc(db, "companies", companyId, "notifications", notifId), { status: "read" });

    alert("Swap approved and sent to manager.");
    loadEmployeeNotifications();
  } catch (e) {
    
  }
};
window.declineSwap = async (notifId) => {
  if (!confirm("Are you sure you want to decline this swap?")) return;
  
  try {
    const notifSnap = await getDoc(doc(db, "companies", companyId, "notifications", notifId));
    if (!notifSnap.exists()) return;
    const n = notifSnap.data();

    // 1. Send "Bad News" back to the requester
    await addDoc(collection(db, "companies", companyId, "notifications"), {
      employeeId: n.requesterId,
      title: "❌ Swap Declined",
      message: `${verifiedEmployee.fullName} cannot swap with you on ${n.date}.`,
      status: "unread",
      type: "info",
      createdAt: serverTimestamp()
    });

    // 2. Hide the old notification
    await updateDoc(doc(db, "companies", companyId, "notifications", notifId), { status: "read" });

    alert("Swap request declined.");
    loadEmployeeNotifications();
  } catch (e) {
    
  }
};
// The Final Sync: Pushes to Calendar


async function loadEmployeeNotifications() {
 
  const list = $("notifList");
  const q = query(
    collection(db, "companies", companyId, "notifications"),
    where("employeeId", "==", verifiedEmployee.id),
    where("status", "==", "unread")
  );

  onSnapshot(q, (snap) => {
    list.innerHTML = snap.empty
      ? `<div class="empty-state"><i class="fas fa-bell"></i><p>You're all caught up!</p></div>`
      : "";

    snap.forEach(docSnap => {
      const n = docSnap.data();
      const div = document.createElement("div");
      div.className = "notif-item unread";
      div.id = `notif-${docSnap.id}`;

      div.innerHTML = `
        <div class="notif-dot"></div>
        <div class="notif-body">
          <div class="notif-msg"><strong>${n.title || "Notification"}</strong> — ${n.message || ""}</div>
          <div class="notif-time">${n.createdAt?.toDate?.().toLocaleString() || ""}</div>
        </div>
        ${n.type === "swap_request" ? `
          <div style="display:flex; gap:5px; align-items:flex-start;">
            <button onclick="confirmSwap('${docSnap.id}')"
                    style="background:#16a34a; color:white; border:none; border-radius:6px; padding:6px 12px; cursor:pointer; font-weight:600; font-size:0.8rem;">
              Accept
            </button>
            <button onclick="declineSwap('${docSnap.id}')"
                    style="background:#dc2626; color:white; border:none; border-radius:6px; padding:6px 12px; cursor:pointer; font-weight:600; font-size:0.8rem;">
              Decline
            </button>
          </div>
        ` : `
          <button onclick="markAsRead('${docSnap.id}')"
                  style="background:transparent; color:#9ca3af; border:1px solid #e5e7eb; border-radius:6px;
                         padding:5px 10px; cursor:pointer; font-size:0.75rem; font-weight:600;
                         transition:all 0.15s; white-space:nowrap;"
                  onmouseover="this.style.background='#f3f4f6';this.style.color='#374151';"
                  onmouseout="this.style.background='transparent';this.style.color='#9ca3af';">
            ✕ Dismiss
          </button>
        `}
      `;

      list.appendChild(div);
    });

    // ── Badge update — OUTSIDE the innerHTML string ──
    const badge = document.getElementById("notifBadge");
    if (badge) {
      badge.textContent = snap.size;
      badge.style.display = snap.size > 0 ? "inline-block" : "none";
    }
  });
}


// --- PIN VERIFICATION ---
$("verifyPinBtn").onclick = async () => {
  const pin = $("employeePin").value;

  const q = query(
    collection(db, "companies", companyId, "employees"),
    where("pin", "==", pin)
  );

  const snap = await getDocs(q);

  if (!snap.empty) {
   verifiedEmployee = {
  id: snap.docs[0].id,
  ...snap.docs[0].data()
};

localStorage.setItem("employeeSession", JSON.stringify(verifiedEmployee));

    if (typeof window.showPortalContent === "function") {
      window.showPortalContent({
        name:  verifiedEmployee.fullName,
        role:  verifiedEmployee.position || verifiedEmployee.role || "—",
        shift: verifiedEmployee.defaultShift || verifiedEmployee.shift || "—"
      });
    }

    loadEmployeeTickets();
    loadCoworkers();
    loadEmployeeNotifications();
    loadHomeDashboard();
  } else {
    alert("❌ Invalid PIN.");
  }
};

// --- DATA LOADING ---
async function loadHoursAndPay() {
  $("payDisplay").innerText = `$${verifiedEmployee.hourlyRate || '0.00'}`;

  const now = new Date();
  const windowStart = startOfWeek(now);

  const q = query(
    collection(db, "companies", companyId, "punchLogs"),
    where("companyId", "==", companyId),
    where("employeeId", "==", verifiedEmployee.id),
    orderBy("ts", "asc")
  );

  const snap = await getDocs(q);
  let totalMinutes = 0;
  let activeShiftStart = null;
  let activeBreakStart = null;

  const logs = snap.docs
    .map(d => d.data())
    .filter(l => l.ts && typeof l.ts.seconds === "number")
    .map(l => ({ ...l, time: l.ts.toDate() }))
    .filter(l => l.time >= windowStart && l.time <= now);

  for (const log of logs) {
    const time = log.time;
    if (log.eventType === "punch_in") activeShiftStart = time;
    if (log.eventType === "break_start" && activeShiftStart) activeBreakStart = time;
    if (log.eventType === "break_end" && activeBreakStart) {
      totalMinutes -= (time - activeBreakStart) / 60000;
      activeBreakStart = null;
    }
    if (log.eventType === "punch_out" && activeShiftStart) {
      totalMinutes += (time - activeShiftStart) / 60000;
      activeShiftStart = null;
      activeBreakStart = null;
    }
  }

  const hours = totalMinutes / 60;

  const hoursEl = $("empTotalHours");
  if (hoursEl) hoursEl.textContent = hours.toFixed(2);

  // ── Est. Earnings ──
  const rate   = parseFloat(verifiedEmployee.hourlyRate) || 0;
  const estEl  = $("estEarnings");
  if (estEl) estEl.textContent = "$" + (hours * rate).toFixed(2);

  // ── Punch log list ──
  const logList = $("punchLogList");
  if (!logList) return;

  if (snap.empty) {
    logList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-clock"></i>
        <p>No punches recorded this week.</p>
      </div>`;
    return;
  }

  logList.innerHTML = "";
  snap.docs
    .map(d => d.data())
    .sort((a, b) => (b.ts?.seconds || 0) - (a.ts?.seconds || 0))
    .forEach(p => {
      const isIn   = p.eventType === "punch_in";
      const isOut  = p.eventType === "punch_out";
      const date   = p.ts ? p.ts.toDate().toLocaleString() : "Processing...";
      const label  = p.eventType.replace(/_/g, " ").toUpperCase();
      const dotCls = isIn ? "punch-in-dot" : isOut ? "punch-out-dot" : "";

      const div = document.createElement("div");
      div.className = "punch-row";
      div.innerHTML = `
        <div class="punch-dot ${dotCls}"></div>
        <span class="punch-label">${label}</span>
        <span class="punch-time">${date}</span>
      `;
      logList.appendChild(div);
    });
}
// ── Published Schedule Viewer ────────────────────────────────────────────────
async function loadPublishedSchedule() {
  const container = $("scheduleContainer");
  if (!container) return;

  container.innerHTML = `<p style="color:#6b7280; font-size:0.85rem;">Loading schedule...</p>`;

  try {
    // Build this week's Monday key — matches scheduleDocId() in schedule.js
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(now);
    mon.setDate(diff);
    mon.setHours(0, 0, 0, 0);
    const weekKey = `${companyId}_${mon.toISOString().slice(0, 10)}`;

    const snap = await getDoc(doc(db, "weekly_schedules", weekKey));

    if (!snap.exists() || snap.data().published !== true) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; background:#f9fafb;
                    border:1px solid #e5e7eb; border-radius:10px; color:#6b7280; font-size:0.85rem;">
          📭 No schedule published yet for this week.
        </div>`;
      return;
    }

    const schedData = snap.data().schedule_data || {};
    const myShifts  = schedData[verifiedEmployee.id];

    if (!myShifts || myShifts.every(s => !s || s.toUpperCase() === "OFF" || s === "")) {
      container.innerHTML = `
        <div style="text-align:center; padding:16px; background:#f9fafb;
                    border:1px solid #e5e7eb; border-radius:10px; color:#6b7280; font-size:0.85rem;">
          ℹ️ You are not on the schedule this week.
        </div>`;
      return;
    }

    const DAYS      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const FULL_DAYS = { Mon:"Monday", Tue:"Tuesday", Wed:"Wednesday", Thu:"Thursday",
                        Fri:"Friday", Sat:"Saturday", Sun:"Sunday" };

    // Published date label
    let pubLabel = "";
    if (snap.data().publishedAt) {
      const d = snap.data().publishedAt.toDate();
      pubLabel = `<p style="color:#9ca3af; font-size:0.72rem; margin:0 0 10px;">
        Published ${d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" })}
      </p>`;
    }

    let html = pubLabel;
    DAYS.forEach((day, i) => {
      const shift = myShifts[i] || "";
      const isOff = !shift || shift.toUpperCase() === "OFF";
      const isSwappedIn  = shift.toLowerCase().includes("swap") || false;

      // Actual calendar date for this day
      const dayDate = new Date(mon);
      dayDate.setDate(mon.getDate() + i);
      const dateLabel = dayDate.toLocaleDateString(undefined, { month:"short", day:"numeric" });

      // Color scheme
      let bg = isOff ? "#f9fafb" : isSwappedIn ? "#f3e8ff" : "#eff6ff";
      let border = isOff ? "#e5e7eb" : isSwappedIn ? "#a855f7" : "#bfdbfe";
      let textColor = isOff ? "#9ca3af" : isSwappedIn ? "#6b21a8" : "#1d4ed8";

      html += `
        <div style="display:flex; justify-content:space-between; align-items:center;
                    padding:11px 14px; margin-bottom:8px; border-radius:10px;
                    background:${bg}; border:1px solid ${border};">
          <div>
            <div style="font-weight:700; color:${isOff ? "#9ca3af" : "#1e3a8a"}; font-size:0.9rem;">
              ${FULL_DAYS[day]}
            </div>
            <div style="font-size:0.75rem; color:#9ca3af;">${dateLabel}</div>
          </div>
          <div style="font-weight:800; font-size:0.9rem; color:${textColor};">
            ${isOff ? "OFF" : shift}
            ${isSwappedIn ? '<span style="font-size:0.65rem; background:#f3e8ff; color:#7e22ce; padding:2px 6px; border-radius:6px; margin-left:4px;">⇄ swap</span>' : ""}
          </div>
        </div>`;
    });

    container.innerHTML = html;

  } catch (err) {
    console.error("loadPublishedSchedule:", err);
    container.innerHTML = `<p style="color:#ef4444; font-size:0.85rem;">Could not load schedule.</p>`;
  }
}

// --- TICKETS & CHAT ---
function loadEmployeeTickets() {
  if (!verifiedEmployee?.id) {
    console.warn("loadEmployeeTickets: verifiedEmployee not ready");
    return;
  }

  // Clean up previous listener
  if (_ticketsUnsub) { _ticketsUnsub(); _ticketsUnsub = null; }

  const list = $("ticketList");
  if (!list) return;
  list.innerHTML = `<p style="color:#6b7280; font-size:0.85rem;">Loading tickets...</p>`;

  console.log("Loading tickets for employeeId:", verifiedEmployee.id, "companyId:", companyId);

  const q = query(
    collection(db, "companies", companyId, "tickets"),
    where("employeeId", "==", verifiedEmployee.id),
    orderBy("createdAt", "desc")
  );

  _ticketsUnsub = onSnapshot(q, (snap) => {
    console.log("Tickets snapshot — count:", snap.size);
    list.innerHTML = "";

    if (snap.empty) {
      list.innerHTML = `<p style="color:#6b7280; font-size:0.85rem; padding:12px 0;">
        No tickets yet. Submit a request if you need help.
      </p>`;
      return;
    }

    snap.forEach(docSnap => {
      const t = docSnap.data();
      const div = document.createElement("div");
      div.className = "ticket-item";

      let badgeClass = "badge-open";
      let badgeText = t.status || "open";

      if (t.status === "resolved_warning") { badgeClass = "badge-warning";  badgeText = "RESOLVED ⚠"; }
      if (t.status === "resolved")         { badgeClass = "badge-resolved"; badgeText = "RESOLVED"; }
      if (t.status === "in_progress")      { badgeClass = "badge-open";     badgeText = "IN PROGRESS"; }

      let extra = "";
      if (t.type === "shift_swap") {
        extra = `<div style="font-size:0.8rem;color:#6b7280;">
          Swap with ${t.targetEmployeeName || "?"} on ${t.date || ""}
        </div>`;
      }

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${(t.type || t.reason || "Ticket").toUpperCase()}</strong>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        ${extra}
        <div style="font-size:0.75rem;color:#6b7280;margin-top:4px;">
          ID: ${docSnap.id.slice(0,6)}
        </div>
      `;

      div.onclick = () => {
        activeTicketId = docSnap.id;
        const title = (t.type || t.reason || "Ticket");
        const readonly = (t.status === "resolved" || t.status === "resolved_warning");
        openChatPanel("Chat: " + title, "Ticket #" + docSnap.id.slice(0,6), readonly);
        loadMessages(docSnap.id);
        listenTyping(docSnap.id);
      };

      list.appendChild(div);
    });

  }, (err) => {
    console.error("loadEmployeeTickets error:", err);
    list.innerHTML = `<p style="color:#ef4444; font-size:0.85rem;">
      Could not load tickets. (${err.code || err.message})
    </p>`;
  });
}
window.logoutEmployee = function(){
  localStorage.removeItem("employeeSession");
  location.reload();
};
function loadMessages(id) {
  if (_messagesUnsub) { _messagesUnsub(); _messagesUnsub = null; }
  const q = query(collection(db, "companies", companyId, "tickets", id, "messages"), orderBy("createdAt"));
  
  _messagesUnsub = onSnapshot(q, (snap) => {
    const container = document.getElementById("chatPanelMessages");
    container.innerHTML = "";
    
    snap.forEach(mDoc => {
      const m = mDoc.data();
      
      // System messages (like approval notifications)
      if (m.senderRole === "system") {
        const sysDiv = document.createElement("div");
        sysDiv.style.cssText = "text-align:center; font-size:.76rem; color:var(--text-muted); padding:6px 14px; background:var(--bg2); border-radius:100px; align-self:center; border:1px solid var(--border); margin: 4px 0;";
        sysDiv.innerText = m.text;
        container.appendChild(sysDiv);
        return;
      }

      const isMe = m.senderRole === "employee";
      const mDiv = document.createElement("div");
      
      // Match the CSS classes from employee-portal.html
      mDiv.className = `msg-wrap ${isMe ? 'outgoing' : 'incoming'}`;

      const avatarStr = isMe ? (m.senderName ? m.senderName[0].toUpperCase() : 'E') : 'M';
      const avatarClass = isMe ? 'av-emp' : 'av-mgr';

      let timeStr = "";
      if (m.createdAt) {
        timeStr = new Date(m.createdAt.seconds * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      mDiv.innerHTML = `
        <div class="msg-avatar ${avatarClass}">${avatarStr}</div>
        <div class="msg-bubble">
          ${m.text}
          <span class="msg-ts">${timeStr}</span>
        </div>
      `;

      container.appendChild(mDiv);
    });
    
    // Auto-scroll to latest message
    container.scrollTop = container.scrollHeight;
  });
}
async function loadCoworkers() {
  const dropdown = $("targetEmployee");
  
  // 1. Get everyone in this company who is currently active
  const q = query(
  collection(db, "companies", companyId, "employees"),
    where("isActive", "==", true)
  );
  
  const snap = await getDocs(q);
  dropdown.innerHTML = '<option value="">Select a coworker...</option>';

  // 2. Create an object to hold our groups (Preschool Style: like cubbies for names)
  const groups = {};

  snap.forEach(docSnap => {
    const data = docSnap.data();
    
    // Skip the person who is logged in
    if (docSnap.id === verifiedEmployee.id) return;

    const shift = data.defaultShift || "Unassigned";
    
    // If we haven't seen this shift cubby yet, make it
    if (!groups[shift]) {
      groups[shift] = document.createElement("optgroup");
      groups[shift].label = `--- ${shift} Shift ---`;
    }

  
const option = document.createElement("option");
option.value = docSnap.id; // Store the ID here for the database!
option.textContent = `${data.fullName} (${data.position || 'Staff'})`;
    
    groups[shift].appendChild(option);
  });

  // 4. Put all the finished cubbies into the dropdown
  Object.values(groups).forEach(group => dropdown.appendChild(group));
}



window._portalSubmitRequest = async function({ type, start, end, swap, notes }) {
  if (!verifiedEmployee) return;
  const startDate = start;

  try {
    /* ================= CALL OUT ================= */
    if (type === "call_out") {
      // Tell the manager
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        companyId,
        title: "⚠️ Employee Call-Out",
        message: `${verifiedEmployee.fullName} called out for ${startDate}`,
        read: false,
        target: "manager",
        type: "call_out",
        createdAt: serverTimestamp()
      });
      // Tell the employee it was sent
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        employeeId: verifiedEmployee.id,
        title: "✅ Call-Out Submitted",
        message: `Your call-out for ${startDate} was sent to your manager.`,
        status: "unread",
        type: "info",
        createdAt: serverTimestamp()
      });
    }

    /* ================= RUNNING LATE ================= */
    if (type === "running_late") {
      // Tell the manager
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        companyId,
        title: "⏰ Running Late",
        message: `${verifiedEmployee.fullName} is running late for ${startDate}`,
        read: false,
        target: "manager",
        type: "running_late",
        createdAt: serverTimestamp()
      });
      // Tell the employee it was sent
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        employeeId: verifiedEmployee.id,
        title: "✅ Manager Notified",
        message: `Your manager has been notified that you're running late for ${startDate}.`,
        status: "unread",
        type: "info",
        createdAt: serverTimestamp()
      });
    }

    /* ================= TIME OFF ================= */
    if (type === "time_off") {
      const endDate = end || startDate;

      await addDoc(collection(db, "companies", companyId, "time_off_requests"), {
        companyId,
        employeeId: verifiedEmployee.id,
        fullName: verifiedEmployee.fullName,
        startDate,
        endDate,
        notes: notes || "",
        status: "pending",
        createdAt: serverTimestamp()
      });

      // Tell the manager
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        companyId,
        title: "📅 Time Off Request",
        message: `${verifiedEmployee.fullName} requested time off: ${startDate}`,
        read: false,
        target: "manager",
        type: "time_off_request",
        createdAt: serverTimestamp()
      });

      // Create ticket
      const ticketRef = await addDoc(collection(db, "companies", companyId, "tickets"), {
        companyId,
        employeeId: verifiedEmployee.id,
        employeeName: verifiedEmployee.fullName,
        type: "Time Off Request",
        reason: "Time Off Request",
        startDate,
        endDate,
        status: "open",
        submittedByEmployee: true,
        unreadManager: true,
        unreadEmployee: false,
        createdAt: serverTimestamp()
      });

      if (notes) {
        await addDoc(collection(db, "companies", companyId, "tickets", ticketRef.id, "messages"), {
          text: notes,
          senderRole: "employee",
          senderName: verifiedEmployee.fullName,
          createdAt: serverTimestamp()
        });
      }

      // Tell the employee it was sent
      await addDoc(collection(db, "companies", companyId, "notifications"), {
        employeeId: verifiedEmployee.id,
        title: "✅ Time Off Requested",
        message: `Your time off request for ${startDate} was submitted. Check back for manager approval.`,
        status: "unread",
        type: "info",
        createdAt: serverTimestamp()
      });
    }

    /* ================= SHIFT SWAP ================= */
    if (type === "shift_swap") {
      if (!swap) { alert("Please select a coworker."); return; }

      await addDoc(collection(db, "companies", companyId, "notifications"), {
        type: "swap_request",
        title: "🔄 Shift Swap Request",
        message: `${verifiedEmployee.fullName} wants to swap with you on ${startDate}`,
        employeeId: swap,
        requesterId: verifiedEmployee.id,
        requesterName: verifiedEmployee.fullName,
        date: startDate,
        status: "unread",
        createdAt: serverTimestamp()
      });
    }

  } catch (e) {
    console.error("_portalSubmitRequest error:", e);
    alert("❌ Request failed. Try again.");
  }
};
async function loadArchivedTickets(){

  const q = query(
  collection(db,"companies",companyId,"tickets"),
    where("employeeId","==",verifiedEmployee.id),
    where("status","==","archived")
  );

  const snap = await getDocs(q);

  const list = $("archiveTicketList");
  list.innerHTML = "";

  if(snap.empty){
    list.innerHTML = "<p>No archived tickets.</p>";
    return;
  }

  snap.forEach(docSnap=>{

    const t = docSnap.data();

    const div = document.createElement("div");
    div.className = "ticket-item";

    div.innerHTML = `
      <div style="display:flex; justify-content:space-between;">
        <strong>${(t.type || t.reason || "ticket").toUpperCase()}</strong>
        <span class="badge">ARCHIVED</span>
      </div>
      <div style="font-size:0.75rem;color:#6b7280;">
        ID: ${docSnap.id.slice(0,6)}
      </div>
    `;

    div.onclick = () => {
      activeTicketId = docSnap.id;
      openChatPanel("Archived: " + (t.type || t.reason), true);
      loadMessages(docSnap.id);
    };

    list.appendChild(div);

  });

}
window.markAsRead = async (notifId) => {
  try {
    await updateDoc(doc(db, "companies", companyId, "notifications", notifId), {
      status: "read"
    });
    // This part refreshes the list so the message disappears
    loadEmployeeNotifications(); 
  } catch (e) {
    
  }
};
// ── Window bridges: connect HTML inline handlers to this module ──────────────

// Fix: messages disappear because HTML calls window._portalSendMsg but it was
// never assigned — the send button listener below was standalone and not exposed.
window._portalSendMsg = async function(text) {
  if (!text || !activeTicketId) return;
  try {
    await setDoc(
      doc(db, "companies", companyId, "tickets", activeTicketId, "typing", "status"),
      { employee: false },
      { merge: true }
    );
   await addDoc(
      collection(db, "companies", companyId, "tickets", activeTicketId, "messages"),
      { text, senderRole: "employee", senderName: verifiedEmployee.fullName, createdAt: serverTimestamp() }
    );

    await updateDoc(doc(db, "companies", companyId, "tickets", activeTicketId), {
      unreadManager: true,
      unreadEmployee: false,
      lastMessage: text,
      lastMessageAt: serverTimestamp()
    });
  } catch(e) {
    console.error("Failed to send message:", e);
  }
};

// Fix: ticket rows rendered by renderPortalTickets() use
// onclick="window._portalOpenTicket && window._portalOpenTicket('id')"
// but window._portalOpenTicket was never assigned — clicks did nothing.
window._portalOpenTicket = function(ticketId, readonly, reason) {
  if (!ticketId) return;
  activeTicketId = ticketId;
  const title = reason || "Ticket";
  openChatPanel("Chat: " + title, "Ticket #" + ticketId.slice(0, 6), !!readonly);
  loadMessages(ticketId);
  listenTyping(ticketId);
};



// ── HOME DASHBOARD ────────────────────────────────────────────────────────────
// Populates the overview page: hours stat, open ticket count, next shift,
// this week's schedule strip, and the 3 most recent tickets.
async function loadHomeDashboard() {
  if (!verifiedEmployee?.id) return;

  // ── 1. Hours this week ───────────────────────────────────────────────────
 // ── 2. Open ticket count ─────────────────────────────────────────────────
try {
  const ticketEl = document.getElementById("statTickets");

  const [openSnap, progressSnap] = await Promise.all([
    getDocs(query(collection(db, "companies", companyId, "tickets"),
      where("employeeId", "==", verifiedEmployee.id), where("status", "==", "open"))),
    getDocs(query(collection(db, "companies", companyId, "tickets"),
      where("employeeId", "==", verifiedEmployee.id), where("status", "==", "in_progress")))
  ]);

  if (ticketEl) ticketEl.textContent = openSnap.size + progressSnap.size;
} catch (e) {
  console.warn("loadHomeDashboard — tickets:", e);
  }


  // ── 3. Schedule: next shift + weekly strip ───────────────────────────────
  try {
    const now  = new Date();
    const day  = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(now);
    mon.setDate(diff);
    mon.setHours(0, 0, 0, 0);
    const weekKey = `${companyId}_${mon.toISOString().slice(0, 10)}`;

    const schedSnap = await getDoc(doc(db, "weekly_schedules", weekKey));

    const DAYS      = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const FULL_DAYS = {
      Mon:"Monday", Tue:"Tuesday", Wed:"Wednesday", Thu:"Thursday",
      Fri:"Friday", Sat:"Saturday", Sun:"Sunday"
    };
    const todayIndex = day === 0 ? 6 : day - 1; // 0=Mon … 6=Sun

    // ── Next shift stat ──
    const nextShiftEl  = document.getElementById("statNextShift");
    const nextShiftSub = document.getElementById("statNextShiftSub");

    if (!schedSnap.exists() || schedSnap.data().published !== true) {
      if (nextShiftEl) nextShiftEl.textContent = "—";
      if (nextShiftSub) nextShiftSub.textContent = "No schedule yet";
    } else {
      const myShifts = schedSnap.data().schedule_data?.[verifiedEmployee.id] || [];

      // Find the next non-OFF shift from today onwards
      let found = false;
      for (let i = todayIndex; i < 7; i++) {
        const s = (myShifts[i] || "").trim();
        if (s && s.toUpperCase() !== "OFF") {
          if (nextShiftEl)  nextShiftEl.textContent  = s;
          if (nextShiftSub) nextShiftSub.textContent = i === todayIndex ? "Today" : FULL_DAYS[DAYS[i]];
          found = true;
          break;
        }
      }
      if (!found) {
        if (nextShiftEl)  nextShiftEl.textContent  = "None";
        if (nextShiftSub) nextShiftSub.textContent = "Rest of week off";
      }

      // ── Weekly schedule strip ──
      const homeSchedule = document.getElementById("homeSchedule");
      if (homeSchedule) {
        if (!myShifts.length || myShifts.every(s => !s || s.toUpperCase() === "OFF")) {
          homeSchedule.innerHTML = `
            <div style="text-align:center;padding:16px;background:#f9fafb;
                        border:1px solid #e5e7eb;border-radius:10px;
                        color:#6b7280;font-size:0.85rem;">
              ℹ️ You are not on the schedule this week.
            </div>`;
        } else {
          let html = "";
          DAYS.forEach((d, i) => {
            const shift      = myShifts[i] || "";
            const isOff      = !shift || shift.toUpperCase() === "OFF";
            const isToday    = i === todayIndex;
            const isSwap     = shift.toLowerCase().includes("swap");

            const dayDate = new Date(mon);
            dayDate.setDate(mon.getDate() + i);
            const dateLabel = dayDate.toLocaleDateString(undefined, { month:"short", day:"numeric" });

            const bg      = isToday ? "#1e3a8a"  : isOff ? "#f9fafb"  : isSwap ? "#f3e8ff" : "#eff6ff";
            const border  = isToday ? "#1e3a8a"  : isOff ? "#e5e7eb"  : isSwap ? "#a855f7" : "#bfdbfe";
            const dayCol  = isToday ? "#fff"      : isOff ? "#9ca3af"  : "#1e3a8a";
            const shiftCol= isToday ? "#bfdbfe"   : isOff ? "#9ca3af"  : isSwap ? "#6b21a8" : "#1d4ed8";

            html += `
              <div style="display:flex;justify-content:space-between;align-items:center;
                          padding:11px 14px;margin-bottom:8px;border-radius:10px;
                          background:${bg};border:1px solid ${border};">
                <div>
                  <div style="font-weight:700;color:${dayCol};font-size:0.9rem;">
                    ${FULL_DAYS[d]}${isToday ? " <span style='font-size:0.65rem;background:#3b82f6;color:#fff;padding:2px 6px;border-radius:6px;margin-left:4px;'>TODAY</span>" : ""}
                  </div>
                  <div style="font-size:0.75rem;color:${isToday ? '#93c5fd' : '#9ca3af'};">${dateLabel}</div>
                </div>
                <div style="font-weight:800;font-size:0.9rem;color:${shiftCol};">
                  ${isOff ? "OFF" : shift}
                  ${isSwap ? '<span style="font-size:0.65rem;background:#f3e8ff;color:#7e22ce;padding:2px 6px;border-radius:6px;margin-left:4px;">⇄ swap</span>' : ""}
                </div>
              </div>`;
          });
          homeSchedule.innerHTML = html;
        }
      }
    }
  } catch (e) {
    console.warn("loadHomeDashboard — schedule:", e);
  }

  // ── 4. Recent tickets (last 3) ───────────────────────────────────────────
  try {
    const recentQ = query(
      collection(db, "companies", companyId, "tickets"),
      where("employeeId", "==", verifiedEmployee.id),
      orderBy("createdAt", "desc"),
      limit(3)
    );

    const recentSnap = await getDocs(recentQ);
    const container  = document.getElementById("homeRecentTickets");
    if (!container) return;

    if (recentSnap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-ticket"></i>
          <p>No tickets yet. Submit a request to get started.</p>
        </div>`;
      return;
    }

    container.innerHTML = "";
    recentSnap.forEach(docSnap => {
      const t   = docSnap.data();
      const div = document.createElement("div");
      div.className = "ticket-item";

      let badgeClass = "badge-open";
      let badgeText  = t.status || "open";
      if (t.status === "resolved_warning") { badgeClass = "badge-warning";  badgeText = "RESOLVED ⚠"; }
      if (t.status === "resolved")         { badgeClass = "badge-resolved"; badgeText = "RESOLVED"; }
      if (t.status === "in_progress")      { badgeClass = "badge-open";     badgeText = "IN PROGRESS"; }

      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong>${(t.type || t.reason || "Ticket").toUpperCase()}</strong>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div style="font-size:0.75rem;color:#6b7280;margin-top:4px;">
          ID: ${docSnap.id.slice(0,6)}
        </div>`;

      div.onclick = () => {
        window._portalOpenTicket && window._portalOpenTicket(
          docSnap.id,
          t.status === "resolved" || t.status === "resolved_warning",
          t.type || t.reason
        );
      };

      container.appendChild(div);
    });
  } catch (e) {
    console.warn("loadHomeDashboard — recent tickets:", e);
  }
}