// js/script.js — Signup handler
// Pinned to firebase 10.7.1 to match firebase.js
import { auth ,db } from "../app/js/core/firebase.js";

import {
  createUserWithEmailAndPassword,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

console.log("✅ script.js loaded");

const finalAgreeBtn = document.getElementById("finalAgreeBtn");
const messageDiv    = document.getElementById("message");
const legalModal    = document.getElementById("legalModal");

/* ─── Simple rate limit — prevent double-submit ──────────── */
let submitting = false;

finalAgreeBtn?.addEventListener("click", async () => {
  if (submitting) return;
  submitting = true;

  const email       = document.getElementById("email")?.value?.trim();
  const password    = document.getElementById("password")?.value;
  const fullName    = document.getElementById("fullname")?.value?.trim();
  const companyName = document.getElementById("companyname")?.value?.trim();
  const city        = document.getElementById("city")?.value?.trim();
  const state       = document.getElementById("state")?.value?.trim();

  // Basic field validation
  if (!email || !password || !fullName || !companyName || !city || !state) {
    showMsg("Please fill in all fields.", "error");
    submitting = false;
    return;
  }

  if (password.length < 6) {
    showMsg("Password must be at least 6 characters.", "error");
    submitting = false;
    return;
  }

  finalAgreeBtn.disabled   = true;
  finalAgreeBtn.innerHTML  = 'Creating Account... <i class="fas fa-spinner fa-spin"></i>';

  try {
    // 1. Create Firebase Auth user
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // 2. Send email verification
    await sendEmailVerification(user);

    // 3. Create company doc — Firestore generates the ID
  const trialEnd = new Date();
trialEnd.setDate(trialEnd.getDate() + 14);

const companyRef = await addDoc(collection(db, "companies"), {
  name:         companyName,
  ownerName:    fullName,
  ownerUid:     user.uid,
  city,
  state,
  tier:         "free",
  trialEndsAt:  trialEnd,
  createdAt:    serverTimestamp()
});

    // 4. Create default settings doc for this company
    await setDoc(
      doc(db, "companies", companyRef.id, "settings", "config"),
      {
        darkMode:             false,
        compactView:          false,
        accentColor:          "#0891b2",
        notifTickets:         true,
        notifCallouts:        true,
        notifCoverage:        true,
        notifOvertime:        true,
        notifLateClockIn:     false,
        overtimeThreshold:    40,
        overtimeMultiplier:   "1.5",
        payPeriod:            "weekly",
        showPayrollEstimates: true,
        breaksCountAsHours:   false,
        roundPunches:         false,
        requirePin:           true,
        allowEarlyClockIn:    true,
        earlyClockInWindow:   15,
        autoClockOut:         false,
        autoClockOutHours:    12,
        requireLateReason:    false,
        logIpOnPunch:         false,
        weekStart:            "1",
        defaultView:          "week",
        publishToPortal:      true,
        notifyOnPublish:      true,
        portalAllowSwaps:     true,
        portalAllowTimeOff:   true,
        portalAllowCallout:   true,
        portalShowHours:      true,
        portalShowPayRate:    false,
        updatedAt:            serverTimestamp()
      }
    );

   await setDoc(doc(db, "app_user", user.uid), {
  fullName,
  email:       user.email,
  companyId:   companyRef.id,
  companyName,
  role:        "owner",
  tier:        "free",
  createdAt:   serverTimestamp()
});

    legalModal?.classList.remove("open");
    showMsg("Account created! Check your email to verify, then sign in.", "success");

    setTimeout(() => {
      window.location.href = "/login.html";
    }, 3000);

  } catch (error) {
    submitting = false;
    finalAgreeBtn.disabled  = false;
    finalAgreeBtn.innerHTML = 'I Agree &amp; Finish <i class="fas fa-check"></i>';
    legalModal?.classList.remove("open");

    const code = error.code;
    if (code === "auth/email-already-in-use") {
      showMsg("An account with this email already exists.", "error");
    } else if (code === "auth/invalid-email") {
      showMsg("Please enter a valid email address.", "error");
    } else if (code === "auth/weak-password") {
      showMsg("Password must be at least 6 characters.", "error");
    } else {
      showMsg("Registration failed. Please try again.", "error");
      console.error("[signup]", error.message);
    }
  }
});

function showMsg(text, type) {
  if (!messageDiv) return;
  messageDiv.textContent  = text;
  messageDiv.className    = `status-msg ${type}`;
  messageDiv.style.display = "block";
}