/**
 * portal-qr.js
 * Generates a QR code for the employee self-service portal.
 *
 * Fix 1: Uses "authReady" event (dispatched by auth-share.js) instead of
 *         onAuthStateChanged directly — eliminates the race condition where
 *         companyId wasn't ready yet.
 *
 * Fix 2: Defers buildQR until the portal tab is actually visible, so the
 *         QRCode library has a real container to render into.
 *
 * Requires qrcodejs (already in index.html <head>):
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
 */
import { auth, db } from "./core/firebase.js";
const LS_KEY = "portalPagePath";

let companyId  = null;
let qrInstance = null;
let uiReady    = false;

/* ─── Wait for authReady (companyId is verified from Firestore) ─── */
window.addEventListener("authReady", (e) => {
  companyId = e.detail?.companyId;
  if (!companyId) {
    console.warn("portal-qr: no companyId in authReady");
    return;
  }
  initUI();
});

/* ─── UI setup ───────────────────────────────────────────── */
function initUI() {
  if (uiReady) return;
  uiReady = true;

  const pathInput = document.getElementById("portalPathInput");
  const saveBtn   = document.getElementById("portalPathSaveBtn");
  const testBtn   = document.getElementById("portalTestBtn");
  const dlBtn     = document.getElementById("qrDownloadBtn");
  const copyBtn   = document.getElementById("qrCopyBtn");

  const savedPath = localStorage.getItem(LS_KEY) || guessPortalPath();
  if (pathInput) pathInput.value = savedPath;

  // Don't buildQR yet — the portal tab is hidden on load.
  // Build it the first time the manager clicks the Portal tab.
  hookPortalTab(savedPath);

  // Save + rebuild
  saveBtn?.addEventListener("click", () => {
    const path = pathInput?.value?.trim();
    if (!path) return;
    localStorage.setItem(LS_KEY, path);
    buildQR(path);
    saveBtn.textContent = "✅ Saved";
    setTimeout(() => (saveBtn.textContent = "Save"), 2000);
  });

  // Live rebuild on type (debounced)
  let debounce;
  pathInput?.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const path = pathInput.value.trim();
      if (path) buildQR(path);
    }, 600);
  });

  // Test link
  testBtn?.addEventListener("click", () => {
    const url = makePortalUrl(pathInput?.value?.trim() || savedPath);
    window.open(url, "_blank");
  });

  // Download QR as PNG
  dlBtn?.addEventListener("click", () => {
    const canvas = document.querySelector("#qrCode canvas");
    if (!canvas) return alert("QR not ready yet.");
    const a       = document.createElement("a");
    a.href        = canvas.toDataURL("image/png");
    a.download    = "employee-portal-qr.png";
    a.click();
  });

  // Copy link
  copyBtn?.addEventListener("click", async () => {
    const url = makePortalUrl(pathInput?.value?.trim() || savedPath);
    try {
      await navigator.clipboard.writeText(url);
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✅ Copied!";
      setTimeout(() => (copyBtn.textContent = orig), 2000);
    } catch {
      prompt("Copy this portal link:", url);
    }
  });
}

/* ─── Hook portal tab click to trigger first render ─────── */
// setStab('portal') is called when the manager clicks the Portal tab.
// We wrap it to trigger buildQR the first time.
let qrBuilt = false;

function hookPortalTab(initialPath) {
  // Try immediately in case portal tab is already visible
  setTimeout(() => {
    const portalSection = document.getElementById("stab-portal") 
      || document.querySelector('[data-stab="portal"]')
      || document.getElementById("portal");
    if (portalSection && portalSection.style.display !== "none" && !qrBuilt && companyId) {
      buildQR(initialPath);
      qrBuilt = true;
    }
  }, 300);

  // Also wrap setStab for when the tab is clicked later
  const tryHook = () => {
    if (typeof window.setStab !== "function") {
      setTimeout(tryHook, 100); // keep trying until it exists
      return;
    }
    const originalSetStab = window.setStab;
    window.setStab = function(id, btn) {
      originalSetStab(id, btn);
      if (id === "portal" && !qrBuilt && companyId) {
        setTimeout(() => {
          const path = document.getElementById("portalPathInput")?.value?.trim() || initialPath;
          buildQR(path);
          qrBuilt = true;
        }, 150);
      }
    };
  };
  tryHook();
}

/* ─── Build / rebuild QR ─────────────────────────────────── */
function buildQR(path) {
  const container = document.getElementById("qrCode");
  const urlLabel  = document.getElementById("qrPortalUrl");
  if (!container || !companyId) return;

  const fullUrl = makePortalUrl(path);

  if (urlLabel) {
    urlLabel.textContent  = fullUrl;
    urlLabel.title        = "Click to open portal";
    urlLabel.style.cursor = "pointer";
    urlLabel.onclick      = () => window.open(fullUrl, "_blank");
  }

  // Clear previous instance
  container.innerHTML = "";
  qrInstance = null;

  if (typeof QRCode === "undefined") {
    container.innerHTML = `
      <p style="color:#ef4444;font-size:.8rem;padding:12px;">
        QR library not loaded.<br>
        Make sure qrcodejs &lt;script&gt; is in your &lt;head&gt;.
      </p>`;
    return;
  }

  qrInstance = new QRCode(container, {
    text:         fullUrl,
    width:        180,
    height:       180,
    colorDark:    "#0f172a",
    colorLight:   "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

/* ─── Helpers ────────────────────────────────────────────── */
function makePortalUrl(path) {
  if (!path) return "";
  let base;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    base = path;
  } else {
    base = window.location.origin + (path.startsWith("/") ? "" : "/") + path;
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}companyId=${encodeURIComponent(companyId)}`;
}

function guessPortalPath() {
  const dir = window.location.pathname.replace(/\/[^/]*$/, "");
  return `${dir}/employee-portal.html`;
}