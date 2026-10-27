/* Shared behaviour: header/menu, API helper, validation, toast.
   The screens talk to the Node backend (server.js), which calls the MySQL stored procedures. */

const PAGES = [
  ['student-create.html', 'Student Account Creation'],
  ['staff-create.html',   'Staff Account Creation'],
  ['update-user.html',    'Update User Details'],
];

/* ---------- Header + menu ---------- */
function buildHeader(title, activeFile) {
  const header = document.createElement('div');
  header.innerHTML = `
    <div class="topbar">
      <button class="icon-btn burger" id="openMenu" aria-label="Open menu"><span></span><span></span><span></span></button>
      <h1>${title}</h1>
      <button class="icon-btn logout" id="logout" aria-label="Log out">
        <svg viewBox="0 0 40 40" fill="none" stroke="#d0d65a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 5H6a2 2 0 0 0-2 2v26a2 2 0 0 0 2 2h10"/><path d="M16 20h20M29 12l8 8-8 8"/></svg>
      </button>
    </div>
    <nav class="menu" id="menu">
      <button class="icon-btn close" id="closeMenu" aria-label="Close menu">✕</button>
      ${PAGES.map(([f, t]) => `<a href="${f}" class="${f === activeFile ? 'active' : ''}">${t}</a>`).join('')}
    </nav>`;
  document.body.prepend(header);
  document.getElementById('openMenu').onclick  = () => { menu.classList.add('open');  document.querySelector('.topbar').style.display = 'none'; };
  document.getElementById('closeMenu').onclick = () => { menu.classList.remove('open'); document.querySelector('.topbar').style.display = 'flex'; };
  document.getElementById('logout').onclick = () => { location.href = 'login.html'; };
}

/* ---------- Backend API ---------- */
const api = {
  async req(method, url, body) {
    let r;
    try {
      r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Cannot reach the server. Is "npm start" running?'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Server error');
    return data;
  },
  get:  url       => api.req('GET', url),
  post: (url, b) => api.req('POST', url, b),
  put:  (url, b) => api.req('PUT', url, b),
};

/* Fill a <select> from the database, keeping its first "Select" option. */
async function fillSelect(select, url, valueKey, textKey) {
  try {
    const rows = await api.get(url);
    select.length = 1;
    rows.forEach(r => select.add(new Option(r[textKey], r[valueKey])));
  } catch (e) { toast(e.message, 6000); }
}

/* ---------- Helpers ---------- */
function toast(html, ms = 9000) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.innerHTML = html; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
const PH_PHONE = /^(09\d{9}|\+639\d{9})$/;            // Philippine mobile numbers
function validPhone(v) { return PH_PHONE.test(v.replace(/[\s-]/g, '')); }
function guardianOk(v) { return /^[^,]+,\s*[^,]+$/.test(v.trim()); }   // "LN, FN MN"
function cleanPhone(v) { return v.replace(/[\s-]/g, ''); }
function setToday(input) { input.max = new Date().toISOString().slice(0, 10); }