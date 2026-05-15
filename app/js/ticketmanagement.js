import { db } from "./firebase.js";
import {
  collection, query, where, orderBy,
  onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs, getDoc, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let companyId = null;
let _ticketsUnsub = null;
let _activeMessageUnsub = null;
let _notifInitialized = false;

/* ═══════════════════════════════════════════════
   AUTH READY
═══════════════════════════════════════════════ */
window.addEventListener("authReady", async (e) => {
  companyId = e.detail.companyId;
  if (!companyId) return;

listenTicketKPIs();
  loadEmployees();
  listenTickets();
});

/* ═══════════════════════════════════════════════
   LOAD EMPLOYEES
═══════════════════════════════════════════════ */
async function loadEmployees() {
  try {
    const snap = await getDocs(
      query(
        collection(db, "companies", companyId, "employees"),
        where("isActive", "==", true)
      )
    );
    const data = snap.docs.map(d => ({
      id: d.id,
      name: d.data().fullName || d.data().name || "Unknown"
    }));
    if (typeof window.ticketUI?.setEmployees === "function") {
      window.ticketUI.setEmployees(data);
    }
  } catch (err) {
    console.error("loadEmployees:", err);
  }
}
function listenTicketKPIs() {

  const q = query(
    collection(db, "companies", companyId, "tickets")
  );

  onSnapshot(q, (snap) => {

    let open = 0;
    let progress = 0;
    let overdue = 0;

    snap.forEach(docSnap => {

      const t = docSnap.data();

      const status = (t.status || "").toLowerCase();

      // OPEN
      if (status === "open") {
        open++;
      }

      // IN PROGRESS
      if (
        status === "in_progress" ||
        status === "progress"
      ) {
        progress++;
      }

      // OVERDUE
      if (t.overdue === true) {
        overdue++;
      }

    });

    // DASHBOARD KPI
    document.getElementById("ticketOpen").textContent = open;
    document.getElementById("ticketProgress").textContent = progress;
    document.getElementById("ticketOverdue").textContent = overdue;

    // TICKET PAGE KPI
    const tovOpen = document.getElementById("tov-open");
    const tovProgress = document.getElementById("tov-progress");
    const tovOverdue = document.getElementById("tov-overdue");

    if (tovOpen) tovOpen.textContent = open;
    if (tovProgress) tovProgress.textContent = progress;
    if (tovOverdue) tovOverdue.textContent = overdue;

  });

}
/* ═══════════════════════════════════════════════
   LISTEN TICKETS — real-time list
═══════════════════════════════════════════════ */
function listenTickets() {
  if (_ticketsUnsub) _ticketsUnsub();

 const q = query(
  collection(db, "companies", companyId, "tickets"),
  orderBy("createdAt", "desc")
);

_ticketsUnsub = onSnapshot(q, async (snap) => {
    // Detect new employee-submitted tickets and push manager notifications
    if (_notifInitialized) {
      snap.docChanges().forEach(change => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (data.submittedByEmployee) {
            const reason = data.type || data.reason || "General";
            createNotification(
              notifTitleForReason(reason),
              `${data.employeeName || "An employee"} submitted a ${reason.toLowerCase()} request.`,
              "new_ticket"
            );
          }
        }
      });
    }
    _notifInitialized = true;

    const tickets = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();

        let messages = [];
        try {
          const msgSnap = await getDocs(
            query(
              collection(db, "companies", companyId, "tickets", d.id, "messages"),
              orderBy("createdAt", "asc")
            )
          );
          messages = msgSnap.docs.map(m => {
            const md = m.data();
            return {
              sender: md.senderRole || "employee",
              name: md.senderName || "",
              text: md.text || "",
              isSystem: md.senderRole === "system",
              timestamp: md.createdAt
                ? new Date(md.createdAt.seconds * 1000).toLocaleTimeString([], {
                    hour: "2-digit", minute: "2-digit"
                  })
                : ""
            };
          });
        } catch (_) {}

        return {
          id: d.id,
          employee: data.employeeName || "Unknown",
          employeeId: data.employeeId || "",
          reason: data.type || data.reason || "General",
          shift: data.shift || data.defaultShift || "—",
          status: data.status || "open",
          archived: data.archived || false,
          unread: data.unreadManager || false,
          mgrNotes: data.mgrNotes || "",
          warnings: data.warnings || 0,
          createdAt: data.createdAt || null,
          // Time off specific
          startDate: data.startDate || null,
          endDate: data.endDate || null,
          timeOffApproved: data.timeOffApproved ?? null,
          // Swap specific
          swapTargetId: data.swapTargetId || null,
          swapTargetName: data.swapTargetName || null,
          swapDate: data.swapDate || null,
          swapApproved: data.swapApproved || false,
          messages
        };
      })
    );

    if (typeof window.ticketUI?.setTickets === "function") {
      window.ticketUI.setTickets(tickets);
    }
  }, (err) => {
    console.error("listenTickets:", err);
  });
}

/* ═══════════════════════════════════════════════
   NOTIFICATION HELPERS
═══════════════════════════════════════════════ */
function notifTitleForReason(reason) {
  if (!reason) return "New Ticket";
  const r = reason.toLowerCase();
  if (r.includes("time off")) return "📅 Time Off Request";
  if (r.includes("callout") || r.includes("call out")) return "⚠️ Employee Callout";
  if (r.includes("swap")) return "🔄 Shift Swap Request";
  if (r.includes("payroll")) return "💰 Payroll Issue";
  if (r.includes("performance")) return "📋 Performance Report";
  return "🎫 New Ticket";
}

async function createNotification(title, message, type = "general") {
  if (!companyId) return;
  try {
    await addDoc(collection(db, "companies", companyId, "notifications"), {
      title,
      message,
      type,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("createNotification:", err);
  }
}
window.createTicketAction = async function(data) {
  if (!companyId) return;

  try {

    const employeeSnap = await getDoc(
      doc(db, "companies", companyId, "employees", data.empId)
    );

    const employee = employeeSnap.data();

    const ticketRef = await addDoc(
      collection(db, "companies", companyId, "tickets"),
      {
        employeeId: data.empId,
        employeeName: employee?.fullName || employee?.name || "Unknown",

        type: data.reason,
        reason: data.reason,

        shift: data.shift,

        note: data.note || "",

        startDate: data.startDate || null,
        endDate: data.endDate || null,
        swapDate: data.swapDate || null,

        status: "open",
        archived: false,

        unreadManager: false,
        unreadEmployee: true,

        submittedByEmployee: false,

        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp()
      }
    );

    // Optional starter message
    if (data.note?.trim()) {
      await addDoc(
        collection(
          db,
          "companies",
          companyId,
          "tickets",
          ticketRef.id,
          "messages"
        ),
        {
          text: data.note.trim(),
          senderRole: "manager",
          senderName: "Manager",
          createdAt: serverTimestamp()
        }
      );
    }

  } catch (err) {
    console.error("createTicketAction:", err);
  }
};
/* ═══════════════════════════════════════════════
   LISTEN MESSAGES — live chat for active ticket
═══════════════════════════════════════════════ */
window.listenTicketMessages = function(ticketId, onUpdate) {
  if (_activeMessageUnsub) _activeMessageUnsub();

  const q = query(
    collection(db, "companies", companyId, "tickets", ticketId, "messages"),
    orderBy("createdAt", "asc")
  );

  _activeMessageUnsub = onSnapshot(q, (snap) => {
    const messages = snap.docs.map(m => {
      const md = m.data();
      return {
        sender: md.senderRole || "employee",
        name: md.senderName || "",
        text: md.text || "",
        isSystem: md.senderRole === "system",
        timestamp: md.createdAt
          ? new Date(md.createdAt.seconds * 1000).toLocaleTimeString([], {
              hour: "2-digit", minute: "2-digit"
            })
          : ""
      };
    });
    if (typeof onUpdate === "function") onUpdate(messages);
  });
};

/* ═══════════════════════════════════════════════
   SEND MESSAGE
═══════════════════════════════════════════════ */
window.sendTicketMessage = async function(ticketId, text) {
  if (!ticketId || !text?.trim()) return;
  try {
    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: text.trim(),
        senderRole: "manager",
        senderName: "Manager",
        createdAt: serverTimestamp()
      }
    );
    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      unreadEmployee: true,
      unreadManager: false,
      lastMessage: text.trim(),
      lastMessageAt: serverTimestamp()
    });
    // Notify dashboard of the reply activity
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const data = ticketSnap.data();
    await createNotification(
      "💬 Reply Sent",
      `Manager replied to ${data?.employeeName || "employee"}'s ${data?.type || "ticket"}.`,
      "ticket_reply"
    );
  } catch (err) {
    console.error("sendTicketMessage:", err);
  }
};



/* ═══════════════════════════════════════════════
   RESOLVE TICKET
═══════════════════════════════════════════════ */
window.resolveTicketAction = async function(ticketId) {
  if (!ticketId) return;
  try {
    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      unreadEmployee: true
    });
  } catch (err) {
    console.error("resolveTicketAction:", err);
  }
};

/* ═══════════════════════════════════════════════
   ARCHIVE TICKET
═══════════════════════════════════════════════ */
window.archiveTicketAction = async function(ticketId) {
  if (!ticketId) return;
  try {
    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      archived: true
    });
  } catch (err) {
    console.error("archiveTicketAction:", err);
  }
};

/* ═══════════════════════════════════════════════
   SAVE MANAGER NOTES
═══════════════════════════════════════════════ */
window.saveTicketNotes = async function(ticketId, notes) {
  if (!ticketId) return;
  try {
    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      mgrNotes: notes
    });
  } catch (err) {
    console.error("saveTicketNotes:", err);
  }
};

/* ═══════════════════════════════════════════════
   ISSUE WARNING
═══════════════════════════════════════════════ */
window.issueWarningAction = async function(ticketId) {
  if (!ticketId) return;
  try {
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const empId = ticketSnap.data()?.employeeId;
    const empName = ticketSnap.data()?.employeeName || "Employee";

    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      warnings: increment(1),
      status: "resolved_warning"
    });

    if (empId) {
      await updateDoc(doc(db, "companies", companyId, "employees", empId), {
        warnings: increment(1)
      });
    }

    // System message in chat
    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: "⚠️ A formal warning has been issued for this incident.",
        senderRole: "system",
        senderName: "System",
        createdAt: serverTimestamp()
      }
    );

    await createNotification(
      "⚠️ Warning Issued",
      `A formal warning was issued to ${empName}.`,
      "warning_issued"
    );
  } catch (err) {
    console.error("issueWarningAction:", err);
  }
};

/* ═══════════════════════════════════════════════
   APPROVE TIME OFF
   — Writes to time_off_requests (read by schedule.js getApprovedTimeOff)
═══════════════════════════════════════════════ */
window.approveTimeOffAction = async function(ticketId) {
  if (!ticketId || !companyId) return;
  try {
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const data = ticketSnap.data();
    if (!data) throw new Error("Ticket not found");

    // Write to time_off_requests collection — schedule.js reads status:"approved" from here
    await addDoc(collection(db, "companies", companyId, "time_off_requests"), {
      employeeId:   data.employeeId,
      employeeName: data.employeeName,
      startDate:    data.startDate || null,
      endDate:      data.endDate   || data.startDate || null,
      status:       "approved",
      ticketId,
      approvedAt:   serverTimestamp()
      
    });

    // Update the ticket itself
    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      status: "resolved",
      timeOffApproved: true,
      resolvedAt: serverTimestamp(),
      unreadEmployee: true
    });

    // Auto-post system message so employee sees the decision in chat
    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: "✅ Your time off request has been approved. It will automatically block out your schedule for those days.",
        senderRole: "system",
        senderName: "System",
        createdAt: serverTimestamp()
      }
    );

    await createNotification(
      "✅ Time Off Approved",
      `${data.employeeName}'s time off request was approved and applied to the schedule.`,
      "time_off_approved"
    );
  } catch (err) {
    console.error("approveTimeOffAction:", err);
    throw err;
  }
};

/* ═══════════════════════════════════════════════
   DECLINE TIME OFF
═══════════════════════════════════════════════ */
window.declineTimeOffAction = async function(ticketId) {
  if (!ticketId || !companyId) return;
  try {
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const data = ticketSnap.data();
    if (!data) throw new Error("Ticket not found");

    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      status: "resolved",
      timeOffApproved: false,
      resolvedAt: serverTimestamp(),
      unreadEmployee: true
    });

    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: "❌ Your time off request has been declined. Please contact your manager if you have questions.",
        senderRole: "system",
        senderName: "System",
        createdAt: serverTimestamp()
      }
    );

    await createNotification(
      "❌ Time Off Declined",
      `${data.employeeName}'s time off request was declined.`,
      "time_off_declined"
    );
  } catch (err) {
    console.error("declineTimeOffAction:", err);
    throw err;
  }
};

/* ═══════════════════════════════════════════════
   APPROVE SHIFT SWAP
   — Writes to shift_swaps (read by schedule.js in autoGenerate)
═══════════════════════════════════════════════ */
window.approveSwapAction = async function(ticketId) {
  if (!ticketId) return;
  try {
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const data = ticketSnap.data();
    if (!data) throw new Error("Ticket not found");

    // Write to shift_swaps collection — schedule.js reads this to apply swap overrides
    await addDoc(collection(db, "companies", companyId, "shift_swaps"), {
      requesterId:   data.employeeId,
      requesterName: data.employeeName,
      targetId:      data.swapTargetId   || null,
      targetName:    data.swapTargetName || null,
      swapDate:      data.swapDate       || null,
      status:        "approved",
      ticketId,
      approvedAt:    serverTimestamp()
    });

    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      status: "resolved",
      swapApproved: true,
      resolvedAt: serverTimestamp(),
      unreadEmployee: true
    });

    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: "✅ Your shift swap has been approved. The schedule will reflect this change on the specified date.",
        senderRole: "system",
        senderName: "System",
        createdAt: serverTimestamp()
      }
    );

    await createNotification(
      "🔄 Shift Swap Approved",
      `${data.employeeName}'s shift swap request has been approved.`,
      "swap_approved"
    );
  } catch (err) {
    console.error("approveSwapAction:", err);
    throw err;
  }
};

/* ═══════════════════════════════════════════════
   DECLINE SHIFT SWAP
═══════════════════════════════════════════════ */
window.declineSwapAction = async function(ticketId) {
  if (!ticketId) return;
  try {
    const ticketSnap = await getDoc(doc(db, "companies", companyId, "tickets", ticketId));
    const data = ticketSnap.data();

    await updateDoc(doc(db, "companies", companyId, "tickets", ticketId), {
      status: "resolved",
      swapApproved: false,
      resolvedAt: serverTimestamp(),
      unreadEmployee: true
    });

    await addDoc(
      collection(db, "companies", companyId, "tickets", ticketId, "messages"),
      {
        text: "❌ Your shift swap request has been declined.",
        senderRole: "system",
        senderName: "System",
        createdAt: serverTimestamp()
      }
    );

    await createNotification(
      "❌ Shift Swap Declined",
      `${data?.employeeName || "Employee"}'s shift swap request was declined.`,
      "swap_declined"
    );
  } catch (err) {
    console.error("declineSwapAction:", err);
    throw err;
  }
};