// js/join.js — Staff invite-based signup
// Pinned to firebase 10.7.1 to match firebase.js

import { auth, db } from "../js/core/firebase.js";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

console.log("✅ join.js loaded");

const joinBtn  = document.getElementById("joinBtn");
const msgDiv   = document.getElementById("joinMsg");

let submitting = false;

joinBtn?.addEventListener("click", async () => {
  if (submitting) return;
  submitting = true;

  const fullName  = document.getElementById("fullname")?.value?.trim();
  const email     = document.getElementById("email")?.value?.trim().toLowerCase();
  const password  = document.getElementById("password")?.value;
  const rawCode   = document.getElementById("inviteCode")?.value?.trim().toUpperCase();

  // Validation
  if (!fullName || !email || !password || !rawCode) {
    showMsg("Please fill in all fields including your invite code.", "error");
    submitting = false;
    return;
  }

  if (password.length < 6) {
    showMsg("Password must be at least 6 characters.", "error");
    submitting = false;
    return;
  }

  joinBtn.disabled  = true;
  joinBtn.innerHTML = 'Creating Account... <i class="fas fa-spinner fa-spin"></i>';

  let user = null;

  try {
    // 1. Look up invite code across all companies
    // We query a collectionGroup so the staff member doesn't need to know their companyId
    const inviteQuery = query(
      collection(db, "invites_global"), // see note below
      where("code", "==", rawCode),
      where("active", "==", true)
    );

    // Since invites live under companies/{id}/invites, we use a flat lookup approach:
    // The owner stores a mirror doc in top-level "invite_codes" collection for easy lookup
    const codeSnap = await getDocs(
      query(
        collection(db, "invite_codes"),
        where("code", "==", rawCode),
        where("active", "==", true)
      )
    );

    if (codeSnap.empty) {
      showMsg("Invalid or expired invite code.", "error");
      reset(); return;
    }

    const codeDoc  = codeSnap.docs[0];
    const invite   = codeDoc.data();

    // 2. Verify email matches
    if (invite.email !== email) {
      showMsg("This code was issued for a different email address.", "error");
      reset(); return;
    }

    // 3. Check uses
    if (invite.uses >= invite.maxUses && invite.maxUses !== 999) {
      showMsg("This invite code has already been used.", "error");
      reset(); return;
    }

    const companyId   = invite.companyId;
    const companyName = invite.companyName || "";
    const role        = invite.role;

    // 4. Create Firebase Auth user
    ({ user } = await createUserWithEmailAndPassword(auth, email, password));

    // 5. Send email verification
    await sendEmailVerification(user);

    // 6. Create user profile doc
    await setDoc(doc(db, "app_user", user.uid), {
      fullName,
      email:       user.email,
      companyId,
      companyName,
      role,
      createdAt:   serverTimestamp()
    });

    // 7. Mark code used — update both the subcollection and the top-level mirror
    const newUses   = invite.uses + 1;
    const nowActive = invite.maxUses === 999 ? true : newUses < invite.maxUses;

    await updateDoc(doc(db, "invite_codes", codeDoc.id), {
      uses:   newUses,
      active: nowActive
    });

    await updateDoc(
      doc(db, "companies", companyId, "invites", invite.subcollectionId),
      { uses: newUses, active: nowActive }
    );

    showMsg("✅ Account created! Check your email to verify, then sign in.", "success");
    setTimeout(() => { window.location.href = "/login.html"; }, 3000);

  } catch (error) {
    if (user) {
      try { await user.delete(); } catch (_) {}
    }
    reset();

    console.error("[join]", error.code, error.message);

    const code = error.code;
    if (code === "auth/email-already-in-use") {
      showMsg("An account with this email already exists.", "error");
    } else if (code === "auth/invalid-email") {
      showMsg("Please enter a valid email address.", "error");
    } else if (code === "auth/weak-password") {
      showMsg("Password must be at least 6 characters.", "error");
    } else {
      showMsg(`Something went wrong: ${error.code ?? error.message}`, "error");
    }
  }
});

function reset() {
  submitting        = false;
  joinBtn.disabled  = false;
  joinBtn.innerHTML = 'Create Account &nbsp;<i class="fas fa-arrow-right"></i>';
}

function showMsg(text, type) {
  if (!msgDiv) return;
  msgDiv.textContent   = text;
  msgDiv.className     = `status-msg ${type}`;
  msgDiv.style.display = "block";
}