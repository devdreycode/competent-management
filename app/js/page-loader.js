// js/page-loader.js
// Fetches page HTML partials into #pageMount, then fires "pagesReady"
// so main.js knows it's safe to restore the last visited page.

const PAGES = [
  "dashboard", "employees", "schedule", "timeclock",
  "punchlogs", "payroll", "tickets", "settings"
];

const mount = document.getElementById("pageMount");

async function loadPage(name) {
  if (document.getElementById(`page-${name}`)) return;

  try {
    const res = await fetch(`/pages/${name}.html`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const pageEl = tmp.firstElementChild;
    if (pageEl) mount.appendChild(pageEl);
  } catch (err) {
    console.error(`[page-loader] Failed to load: ${name}`, err);
    const errDiv = document.createElement("div");
    errDiv.id = `page-${name}`;
    errDiv.className = "page";
    errDiv.innerHTML = `
      <div style="padding:40px;color:#ef4444;font-family:sans-serif;">
        <h3>⚠️ Failed to load ${name} page</h3>
        <p style="margin-top:8px;font-size:.9rem;color:#64748b;">
          Check that <code>/pages/${name}.html</code> exists on the server.
        </p>
      </div>`;
    mount.appendChild(errDiv);
  }
}

async function loadAllPages() {
  await Promise.all(PAGES.map(loadPage));

  // Tell main.js all pages are in the DOM — safe to restore nav state now
  window.dispatchEvent(new CustomEvent("pagesReady"));
}

loadAllPages();