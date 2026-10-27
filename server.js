// Load settings such as database credentials from the .env file.
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(express.json());

// Log each request to help track what the server receives.
app.use((req, res, next) => { console.log(new Date().toLocaleTimeString(), req.method, req.url); next(); });

/* ---------- sessions: remembers who is logged in ---------- */
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 2 },   // 2 hours
}));

// Send users without a session to the login page.
const requireLogin = (req, res, next) =>
  req.session.user ? next() : res.status(401).json({ error: 'Please log in first.' });

// Let staff and admins continue, but block students from staff-only routes.
const requireStaff = (req, res, next) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ error: 'Please log in first.' });
  if (u.role === 'student') return res.status(403).json({ error: 'You are not allowed to do that.' });
  next();
};

/* Protect the pages: must be logged in; students only get the Update page. */
app.use((req, res, next) => {
  const p = req.path === '/' ? '/login.html' : req.path;
  if (!p.endsWith('.html') || p === '/login.html') return next();
  const u = req.session.user;
  if (!u) return res.redirect('/login.html');
  if (u.role === 'student' && p !== '/update-user.html') return res.redirect('/update-user.html');
  next();
});

// Serve the website files from the public folder.
app.use(express.static(path.join(__dirname, 'public')));   // only /public is exposed

// Keep a pool of database connections ready for requests to reuse.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mtqc_accounts',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,            // DATE columns come back as 'YYYY-MM-DD'
});

/* ---------- helpers ---------- */
// Accepted Philippine mobile number formats "09XXXXXXXXX" or "+639XXXXXXXXX".
const PHONE = /^(09\d{9}|\+639\d{9})$/;

// Turn empty values into null and trim spaces from values that are provided.
const blank = v => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

// Send an error response with a message and HTTP status code.
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// Run a CALL and return the rows of its (first) result set.
async function callProc(sql, params = []) {
  const [res] = await pool.query(sql, params);
  return Array.isArray(res[0]) ? res[0] : res;
}

// "Next ID" preview. MySQL 8+ caches information_schema stats, so turn the cache off first.
async function nextId(proc, col) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET SESSION information_schema_stats_expiry = 0');
    const [res] = await conn.query(`CALL ${proc}()`);
    return res[0][0][col];
  } finally { conn.release(); }
}

// Turn common database errors into messages the page can display.
function handleError(res, e) {
  if (e.code === 'ER_DUP_ENTRY') return bad(res, 'That email is already registered.', 409);
  if (e.code === 'ER_NO_REFERENCED_ROW_2') return bad(res, 'Invalid program or department selected.');
  console.error(e);
  return bad(res, 'Server error. Check the server console.', 500);
}

/* ---------- lookups for the dropdowns ---------- */
// The forms call these routes to fill their program and department lists.
app.get('/api/programs', async (req, res) => {
  try { const [r] = await pool.query('SELECT program_id, program_name FROM programs ORDER BY program_name'); res.json(r); }
  catch (e) { handleError(res, e); }
});
app.get('/api/departments', async (req, res) => {
  try { const [r] = await pool.query('SELECT department_id, department_name FROM departments ORDER BY department_name'); res.json(r); }
  catch (e) { handleError(res, e); }
});

/* ---------- next auto-generated ID (preview) ---------- */
// Show the next student or staff ID on the form before an account is created.
app.get('/api/next-id/:role', requireStaff, async (req, res) => {
  try {
    if (req.params.role === 'student') return res.json({ id: await nextId('sp_next_student_id', 'next_student_id') });
    if (req.params.role === 'staff')   return res.json({ id: await nextId('sp_next_staff_id',   'next_staff_id') });
    bad(res, 'Unknown role', 404);
  } catch (e) { handleError(res, e); }
});

/* ---------- create student ---------- */
// Check the submitted details before asking the database to create the student account.
app.post('/api/students', requireStaff, async (req, res) => {
  const b = req.body || {};
  if (!blank(b.lastName) || !blank(b.firstName)) return bad(res, 'Last name and first name are required.');
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) return bad(res, 'Enter a valid email address.');
  if (!b.programId) return bad(res, 'Please select a program.');
  if (!blank(b.birthday)) return bad(res, 'Birthday is required.');
  if (!PHONE.test(b.contact || '') || !PHONE.test(b.guardianContact || '')) return bad(res, 'Contact numbers must look like 09XXXXXXXXX.');
  if (!/^[^,]+,\s*[^,]+$/.test((b.guardian || '').trim())) return bad(res, 'Guardian name must follow the format: LN, FN MN.');
  if (!blank(b.address)) return bad(res, 'Address is required.');
  if (!['Freshmen', 'Transferee'].includes(b.studentType)) return bad(res, 'Select Freshmen or Transferee.');
  if (!['Aligned', 'Misaligned'].includes(b.alignment)) return bad(res, 'Select Aligned or Misaligned.');
  if (!['BTZ', 'ALS_GRADUATE', 'HSG', 'FORMER_SHS', 'SHS'].includes(b.background)) return bad(res, 'Select a background option.');
  if (b.alignment === 'Misaligned' && !['NSHSBP', 'SHSBP'].includes(b.bridging)) return bad(res, 'Select a bridging program.');
  const score = b.examScore === null || b.examScore === undefined || b.examScore === '' ? null : Number(b.examScore);
  if (score !== null && (Number.isNaN(score) || score < 0 || score > 100)) return bad(res, 'Entrance exam score must be 0-100.');

  try {
    // The stored procedure saves the student and returns the new ID and temporary password.
    const rows = await callProc('CALL sp_create_student(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [
      b.lastName.trim(), b.firstName.trim(), blank(b.middleName), blank(b.suffix),
      b.email.trim(), Number(b.programId), b.birthday, b.contact, b.address.trim(),
      b.guardian.trim(), b.guardianContact, b.studentType, b.alignment,
      b.alignment === 'Misaligned' ? b.bridging : null, b.background, score,
    ]);
    res.json(rows[0]);                       // { student_id, temporary_password }
  } catch (e) { handleError(res, e); }
});

/* ---------- create staff ---------- */
// Check the staff details before asking the database to create the account.
app.post('/api/staff', requireStaff, async (req, res) => {
  const b = req.body || {};
  if (!blank(b.lastName) || !blank(b.firstName)) return bad(res, 'Last name and first name are required.');
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) return bad(res, 'Enter a valid email address.');
  if (!b.departmentId) return bad(res, 'Please select a department.');
  if (!blank(b.birthday)) return bad(res, 'Birthday is required.');
  if (!PHONE.test(b.contact || '')) return bad(res, 'Contact no. must look like 09XXXXXXXXX.');
  if (!blank(b.address)) return bad(res, 'Address is required.');

  try {
    const rows = await callProc('CALL sp_create_staff(?,?,?,?,?,?,?,?,?)', [
      b.lastName.trim(), b.firstName.trim(), blank(b.middleName), blank(b.suffix),
      b.email.trim(), Number(b.departmentId), b.birthday, b.contact, b.address.trim(),
    ]);
    res.json(rows[0]);                       // { staff_id, temporary_password }
  } catch (e) { handleError(res, e); }
});

/* ---------- load / update a user by Student ID or Staff ID ---------- */
const USER_SQL = `
  SELECT u.user_id, u.role, u.username, u.last_name, u.first_name, u.middle_name, u.suffix_name,
         u.birthday, u.contact_no, u.address, s.guardian_name, s.guardian_contact_no
  FROM users u LEFT JOIN students s ON s.user_id = u.user_id
  WHERE u.username = ?`;

// Staff use this route to look up a user's details by ID.
app.get('/api/users/:id', requireStaff, async (req, res) => {
  try {
    const [r] = await pool.query(USER_SQL, [req.params.id]);
    if (!r.length) return bad(res, 'No user found with that ID.', 404);
    res.json(r[0]);
  } catch (e) { handleError(res, e); }
});

// This update logic is shared by users editing their own details and staff editing another account.
const updateUserHandler = async (req, res) => {
  const b = req.body || {};
  if (!blank(b.lastName) || !blank(b.firstName)) return bad(res, 'Last name and first name are required.');
  if (!blank(b.birthday)) return bad(res, 'Birthday is required.');
  if (!PHONE.test(b.contact || '')) return bad(res, 'Contact no. must look like 09XXXXXXXXX.');
  if (!blank(b.address)) return bad(res, 'Address is required.');
  try {
    const [r] = await pool.query(USER_SQL, [req.params.id]);
    if (!r.length) return bad(res, 'No user found with that ID.', 404);
    const u = r[0];
    if (u.role === 'student') {
      if (!/^[^,]+,\s*[^,]+$/.test((b.guardian || '').trim())) return bad(res, 'Guardian name must follow the format: LN, FN MN.');
      if (!PHONE.test(b.guardianContact || '')) return bad(res, 'Guardian contact no. must look like 09XXXXXXXXX.');
    }
    await pool.query('CALL sp_update_user_details(?,?,?,?,?,?,?,?,?,?)', [
      u.user_id, b.lastName.trim(), b.firstName.trim(), blank(b.middleName), blank(b.suffix),
      b.birthday, b.contact, b.address.trim(), blank(b.guardian), blank(b.guardianContact),
    ]);
    res.json({ ok: true });
  } catch (e) { handleError(res, e); }
};
app.put('/api/users/:id', requireStaff, updateUserHandler);        // staff/admin edit anyone

/* ---------- the logged-in person's own details ---------- */
// These routes let a signed-in user view or update their own account.
app.get('/api/me', requireLogin, async (req, res) => {
  try {
    const [r] = await pool.query(USER_SQL, [req.session.user.username]);
    if (!r.length) return bad(res, 'Account not found.', 404);
    res.json(r[0]);
  } catch (e) { handleError(res, e); }
});
app.put('/api/me', requireLogin, (req, res) => {                   // you can only edit yourself
  req.params = { id: req.session.user.username };
  return updateUserHandler(req, res);
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

/* ---------- login (admin and staff only) ---------- */
// Check the login with MySQL. Student accounts are not allowed into this system.
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return bad(res, 'Enter your username and password.');
  try {
    const rows = await callProc('CALL sp_login(?,?)', [String(username).trim(), String(password)]);
    if (!rows.length) return bad(res, 'Invalid username or password.', 401);
    req.session.user = { userId: rows[0].user_id, username: String(username).trim(), role: rows[0].role };
    res.json({ ok: true, role: rows[0].role, mustChangePassword: !!rows[0].must_change_password });
  } catch (e) { handleError(res, e); }
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`MTQC accounts running at http://localhost:${PORT}/login.html`));
