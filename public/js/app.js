/* Shared behaviour: header/menu, demo "database", validation, toast.
   DEMO MODE: data is kept in localStorage so the screens work without a server.
   To use the real MySQL database, replace the db.* functions with fetch() calls
   to a backend (PHP / Node) that runs the stored procedures in schema.sql. */

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

/* ---------- Demo database ---------- */
const db = {
  load(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  save(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  nextId(role) {                       // mimics AUTO_INCREMENT start values
    const start = role === 'student' ? 2410001 : 1422377;
    const users = this.load('users', []).filter(u => u.role === role);
    return users.length ? Math.max(...users.map(u => +u.id)) + 1 : start;
  },
  tempPassword() {                     // mimics fn_generate_temp_password()
    const a = new Uint8Array(4); crypto.getRandomValues(a);
    return 'MTQ-' + [...a].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  },
  addUser(u) { const users = this.load('users', []); users.push(u); this.save('users', users); },
};

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
function setToday(input) { input.max = new Date().toISOString().slice(0, 10); }