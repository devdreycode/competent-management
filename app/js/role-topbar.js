// js/role-topbar.js
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./core/firebase.js";

export async function loadUserRole() {
  const user = auth.currentUser;
  if (!user) return;

  const snap = await getDoc(doc(db, "app_user", user.uid));
  if (!snap.exists()) return;

  const role = snap.data().role || "—";
  const roleEl = document.getElementById("userRole");
  if (!roleEl) return;

  roleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
  roleEl.style.cssText = `
    font-size:.68rem;font-weight:700;text-transform:uppercase;
    letter-spacing:.06em;padding:3px 9px;border-radius:20px;
    background:var(--accent-bg,#eff4ff);color:var(--accent,#0891b2);
    border:1px solid var(--accent-border,#bfcfff);
  `;
}