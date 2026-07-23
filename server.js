// Eveni — Gestão de Eventos
// Servidor Express + MySQL. pt-PT.
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// --- fail-fast em segredos fracos ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET é obrigatório');
if (JWT_SECRET.length < 32) {
  throw new Error(`JWT_SECRET é demasiado curto (${JWT_SECRET.length} chars). Mínimo: 32 caracteres aleatórios.`);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL é obrigatório');

const pool = mysql.createPool({
  uri: DATABASE_URL,
  connectionLimit: 10,
  dateStrings: true,   // devolve DATE como "YYYY-MM-DD"
  timezone: 'Z',
});

// Railway/Proxies: precisamos do IP real para rate limit
if (IS_PROD) app.set('trust proxy', 1);

// ---------- static & body parsing ----------
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // recomendação moderna: desligar filtro legado
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (IS_PROD) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self' data:; " +
    "connect-src 'self'; " +
    "form-action 'self'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'self'; " +
    "object-src 'none'"
  );
  next();
});

// ---------- rate limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiadas tentativas. Aguarde 15 minutos.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'demasiados pedidos. Aguarde um momento.' },
});
app.use('/api/', apiLimiter);

// ---------- brute-force por e-mail ----------
const loginAttempts = new Map(); // email -> { count, firstAt }
const LOGIN_WINDOW_MS = 60 * 60 * 1000; // 1h
const LOGIN_MAX_ATTEMPTS = 10;

function recordLoginFailure(email) {
  const now = Date.now();
  const rec = loginAttempts.get(email);
  if (!rec || now - rec.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAt: now });
  } else {
    rec.count += 1;
  }
}
function clearLoginFailures(email) { loginAttempts.delete(email); }
function isEmailLocked(email) {
  const rec = loginAttempts.get(email);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOGIN_WINDOW_MS) { loginAttempts.delete(email); return false; }
  return rec.count >= LOGIN_MAX_ATTEMPTS;
}
// limpeza periódica
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [k, v] of loginAttempts) if (v.firstAt < cutoff) loginAttempts.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- validação de palavras-passe ---------
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwerty123', 'qwerty1234', 'abc12345', 'iloveyou', 'admin123', 'welcome1',
  'letmein1', 'monkey123', '11111111', '00000000', 'senha1234', 'senha1234',
  'palavra-passe', 'palavrapasse', 'benfica1', 'sporting1', 'porto1234',
  'football', 'baseball', 'sunshine', 'princess', 'dragon12', 'master123',
]);
function validatePassword(pw) {
  if (typeof pw !== 'string') return 'palavra-passe inválida';
  if (pw.length < 10) return 'palavra-passe deve ter no mínimo 10 caracteres';
  if (pw.length > 128) return 'palavra-passe demasiado longa';
  if (!/[A-Za-z]/.test(pw)) return 'palavra-passe deve conter pelo menos uma letra';
  if (!/[0-9]/.test(pw)) return 'palavra-passe deve conter pelo menos um número';
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return 'palavra-passe demasiado comum';
  return null;
}

// ---------- data ----------
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/templates.json'), 'utf8'));
const TEMPLATES_META = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/templates-meta.json'), 'utf8'));
const PLANS = [
  {
    code: 'singular', name: 'Singular / Wedding Planner',
    max_projects: 2, max_users: 1,
    allowed_templates: ['T02'],
    price_annual: 0,
    features: ['Template Casamento', '2 projectos', '1 utilizador', 'Suporte por e-mail'],
  },
  {
    code: 'empresarial', name: 'Empresarial',
    max_projects: 999999, max_users: 10,
    allowed_templates: ['T01', 'T02', 'T03', 'T04'],
    price_annual: 0,
    features: ['Todos os templates', 'Projectos ilimitados', 'Até 10 utilizadores', 'Suporte prioritário'],
  },
  {
    code: 'grandes', name: 'Grandes Empresas',
    max_projects: 999999, max_users: 999,
    allowed_templates: ['T01', 'T02', 'T03', 'T04'],
    price_annual: 0,
    features: ['Todos os templates', 'Utilizadores ilimitados', 'Gestor de conta dedicado', 'Personalização'],
  },
];
const PLAN_BY_CODE = Object.fromEntries(PLANS.map(p => [p.code, p]));

// ---------- migrations ----------
async function migrate() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(120) NOT NULL,
      plan_code VARCHAR(20),
      plan_started_at DATETIME,
      plan_expires_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      template_code VARCHAR(10),
      event_date DATE,
      location VARCHAR(200),
      audience INT,
      budget DECIMAL(12,2),
      brand_color VARCHAR(20),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      ext_id VARCHAR(30),
      phase VARCHAR(60) NOT NULL,
      category VARCHAR(120) NOT NULL,
      title VARCHAR(300) NOT NULL,
      role VARCHAR(80),
      responsible VARCHAR(120),
      offset_start INT,
      offset_end INT,
      start_date DATE,
      end_date DATE,
      critical TINYINT(1) DEFAULT 0,
      done TINYINT(1) DEFAULT 0,
      note TEXT,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(120),
      contact VARCHAR(200),
      phone VARCHAR(60),
      email VARCHAR(190),
      quoted DECIMAL(12,2),
      contracted DECIMAL(12,2),
      paid DECIMAL(12,2),
      status VARCHAR(30) DEFAULT 'em_negociacao',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS guests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(190),
      phone VARCHAR(60),
      party_size INT DEFAULT 1,
      rsvp_status VARCHAR(20) DEFAULT 'pendente',
      rsvp_token VARCHAR(64) UNIQUE,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_token (rsvp_token)
    )
  `);
}

// ---------- helpers ----------
const trim = (s, max) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const asInt = (v) => (v === null || v === undefined || v === '' ? null : Number.parseInt(v, 10));
const asDec = (v) => (v === null || v === undefined || v === '' ? null : Number.parseFloat(v));
const asDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
const todayISO = () => new Date().toISOString().slice(0, 10);

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'token inválido' });
  }
}

async function loadUser(id) {
  const [rows] = await pool.execute('SELECT id, email, name, plan_code, plan_started_at, plan_expires_at FROM users WHERE id=?', [id]);
  return rows[0] || null;
}

async function ensureProject(userId, projectId) {
  const [rows] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [projectId, userId]);
  return rows.length > 0;
}

function planOf(user) {
  if (!user?.plan_code) return null;
  return PLAN_BY_CODE[user.plan_code] || null;
}

// ---------- auth routes ----------
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email = trim(req.body?.email, 190).toLowerCase();
    const password = String(req.body?.password || '');
    const name = trim(req.body?.name, 120);
    const planCode = trim(req.body?.plan_code, 20);
    if (!email || !password || !name) return res.status(400).json({ error: 'e-mail, palavra-passe e nome são obrigatórios' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'e-mail inválido' });
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    if (planCode && !PLAN_BY_CODE[planCode]) return res.status(400).json({ error: 'plano inválido' });

    const hash = await bcrypt.hash(password, 12);
    let result;
    try {
      const started = planCode ? new Date() : null;
      const expires = planCode ? new Date(Date.now() + 365 * 24 * 3600 * 1000) : null;
      [result] = await pool.execute(
        'INSERT INTO users (email, password_hash, name, plan_code, plan_started_at, plan_expires_at) VALUES (?,?,?,?,?,?)',
        [email, hash, name, planCode || null, started, expires]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'e-mail já registado' });
      throw e;
    }
    const user = { id: result.insertId, email, name };
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ user: { ...user, plan_code: planCode || null }, token });
  } catch (e) {
    console.error('[register] error', e.code || '', e.message);
    res.status(500).json({ error: 'erro ao registar. Tente novamente.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = trim(req.body?.email, 190).toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'e-mail e palavra-passe obrigatórios' });
    if (isEmailLocked(email)) {
      return res.status(429).json({ error: 'conta temporariamente bloqueada por múltiplas tentativas. Aguarde 1 hora.' });
    }
    const [rows] = await pool.execute('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) {
      recordLoginFailure(email);
      // Timing: dummy hash para não revelar existência do e-mail
      await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000ab');
      return res.status(400).json({ error: 'credenciais inválidas' });
    }
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      recordLoginFailure(email);
      return res.status(400).json({ error: 'credenciais inválidas' });
    }
    clearLoginFailures(email);
    const user = { id: u.id, email: u.email, name: u.name };
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ user: { ...user, plan_code: u.plan_code }, token });
  } catch (e) {
    console.error('[login] error', e.code || '', e.message);
    res.status(500).json({ error: 'erro no início de sessão. Tente novamente.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: 'utilizador não existe' });
  const plan = planOf(u);
  res.json({ user: u, plan });
});

// ---------- plans ----------
app.get('/api/plans', (req, res) => {
  res.json({ plans: PLANS });
});

app.post('/api/account/plan', auth, async (req, res) => {
  const code = trim(req.body?.plan_code, 20);
  if (!PLAN_BY_CODE[code]) return res.status(400).json({ error: 'plano inválido' });
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  await pool.execute('UPDATE users SET plan_code=?, plan_started_at=NOW(), plan_expires_at=? WHERE id=?', [code, expires, req.user.id]);
  const u = await loadUser(req.user.id);
  res.json({ ok: true, user: u, plan: planOf(u) });
});

// ---------- templates ----------
app.get('/api/templates', auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  const plan = planOf(u);
  const list = [];
  for (const [code, meta] of Object.entries(TEMPLATES_META)) {
    const tpl = TEMPLATES[code];
    if (!tpl) continue;
    const allowed = plan ? plan.allowed_templates.includes(code) : false;
    // resumo por fase
    const phases = {};
    for (const t of tpl.tasks) phases[t.phase] = (phases[t.phase] || 0) + 1;
    list.push({
      code, name: meta.name, description: meta.description,
      days_recommended: meta.days_recommended, audience: meta.audience,
      task_count: tpl.tasks.length, phases, allowed,
    });
  }
  res.json({ templates: list, plan });
});

// ---------- projects ----------
app.get('/api/projects', auth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.done=1) AS task_done
     FROM projects p WHERE p.user_id=? ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json({ projects: rows });
});

app.post('/api/projects', auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  const plan = planOf(u);
  if (!plan) return res.status(400).json({ error: 'escolha um plano antes de criar projectos' });

  const [cnt] = await pool.execute('SELECT COUNT(*) AS c FROM projects WHERE user_id=?', [req.user.id]);
  if (cnt[0].c >= plan.max_projects) {
    return res.status(400).json({ error: `plano ${plan.name} limita a ${plan.max_projects} projectos` });
  }

  const name = trim(req.body?.name, 200);
  const template_code = trim(req.body?.template_code, 10);
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });
  if (!template_code || !TEMPLATES[template_code]) return res.status(400).json({ error: 'template inválido' });
  if (!plan.allowed_templates.includes(template_code)) return res.status(400).json({ error: 'template não permitido no seu plano' });

  const event_date = asDate(req.body?.event_date);
  const location = trim(req.body?.location, 200) || null;
  const audience = asInt(req.body?.audience);
  const budget = asDec(req.body?.budget);
  const brand_color = trim(req.body?.brand_color, 20) || null;
  const notes = trim(req.body?.notes, 4000) || null;

  const [r] = await pool.execute(
    `INSERT INTO projects (user_id, name, template_code, event_date, location, audience, budget, brand_color, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.user.id, name, template_code, event_date, location, audience, budget, brand_color, notes]
  );
  const projectId = r.insertId;

  const today = todayISO();
  const warnings = [];
  let i = 0;
  for (const t of TEMPLATES[template_code].tasks) {
    let sd = null, ed = null;
    if (event_date) {
      if (t.offset_start != null) sd = addDays(event_date, t.offset_start);
      if (t.offset_end != null) ed = addDays(event_date, t.offset_end);
      if (t.critical && sd && sd < today) warnings.push({ task: t.title, needed_start: sd });
    }
    await pool.execute(
      `INSERT INTO tasks (project_id, ext_id, phase, category, title, role, offset_start, offset_end, start_date, end_date, critical, note, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [projectId, t.id || null, t.phase || '', t.category || '', t.title, t.role || null,
       t.offset_start ?? null, t.offset_end ?? null, sd, ed, t.critical ? 1 : 0, t.note || null, i++]
    );
  }

  const [rows] = await pool.execute('SELECT * FROM projects WHERE id=?', [projectId]);
  res.json({ project: rows[0], warnings });
});

app.get('/api/projects/:id', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
  const [tasks] = await pool.execute('SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, id', [req.params.id]);
  res.json({ project: rows[0], tasks });
});

app.put('/api/projects/:id', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.id)) return res.status(404).json({ error: 'não encontrado' });
  const name = trim(req.body?.name, 200);
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const event_date = asDate(req.body?.event_date);
  const location = trim(req.body?.location, 200) || null;
  const audience = asInt(req.body?.audience);
  const budget = asDec(req.body?.budget);
  const brand_color = trim(req.body?.brand_color, 20) || null;
  const notes = trim(req.body?.notes, 4000) || null;

  // Se event_date mudou, opcionalmente recalcular datas via query ?reset_dates=1
  const [cur] = await pool.execute('SELECT event_date FROM projects WHERE id=?', [req.params.id]);
  const oldDate = cur[0]?.event_date || null;
  await pool.execute(
    `UPDATE projects SET name=?, event_date=?, location=?, audience=?, budget=?, brand_color=?, notes=? WHERE id=?`,
    [name, event_date, location, audience, budget, brand_color, notes, req.params.id]
  );

  if (req.query.reset_dates === '1' && event_date) {
    const [tks] = await pool.execute('SELECT id, offset_start, offset_end FROM tasks WHERE project_id=?', [req.params.id]);
    for (const t of tks) {
      const sd = t.offset_start != null ? addDays(event_date, t.offset_start) : null;
      const ed = t.offset_end != null ? addDays(event_date, t.offset_end) : null;
      await pool.execute('UPDATE tasks SET start_date=?, end_date=? WHERE id=?', [sd, ed, t.id]);
    }
  }

  res.json({ ok: true, event_date_changed: oldDate !== event_date });
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.id)) return res.status(404).json({ error: 'não encontrado' });
  await pool.execute('DELETE FROM tasks WHERE project_id=?', [req.params.id]);
  await pool.execute('DELETE FROM vendors WHERE project_id=?', [req.params.id]);
  await pool.execute('DELETE FROM guests WHERE project_id=?', [req.params.id]);
  await pool.execute('DELETE FROM projects WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- tasks ----------
app.post('/api/projects/:pid/tasks', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'não encontrado' });
  const title = trim(req.body?.title, 300);
  if (!title) return res.status(400).json({ error: 'título obrigatório' });
  const phase = trim(req.body?.phase, 60) || 'Pré Produção';
  const category = trim(req.body?.category, 120) || 'Geral';
  const responsible = trim(req.body?.responsible, 120) || null;
  const start_date = asDate(req.body?.start_date);
  const end_date = asDate(req.body?.end_date);
  const [m] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS o FROM tasks WHERE project_id=?', [req.params.pid]);
  const [r] = await pool.execute(
    `INSERT INTO tasks (project_id, phase, category, title, responsible, start_date, end_date, sort_order)
     VALUES (?,?,?,?,?,?,?,?)`,
    [req.params.pid, phase, category, title, responsible, start_date, end_date, m[0].o]
  );
  const [rows] = await pool.execute('SELECT * FROM tasks WHERE id=?', [r.insertId]);
  res.json({ task: rows[0] });
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
  const cur = rows[0];
  const b = req.body || {};
  const done = b.done !== undefined ? (b.done ? 1 : 0) : cur.done;
  await pool.execute(
    `UPDATE tasks SET phase=?, category=?, title=?, responsible=?, start_date=?, end_date=?, done=?, note=? WHERE id=?`,
    [
      b.phase != null ? trim(b.phase, 60) : cur.phase,
      b.category != null ? trim(b.category, 120) : cur.category,
      b.title != null ? trim(b.title, 300) : cur.title,
      b.responsible !== undefined ? (trim(b.responsible, 120) || null) : cur.responsible,
      b.start_date !== undefined ? asDate(b.start_date) : cur.start_date,
      b.end_date !== undefined ? asDate(b.end_date) : cur.end_date,
      done,
      b.note !== undefined ? (trim(b.note, 4000) || null) : cur.note,
      req.params.id,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
  await pool.execute('DELETE FROM tasks WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- vendors ----------
app.get('/api/projects/:pid/vendors', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'não encontrado' });
  const [rows] = await pool.execute('SELECT * FROM vendors WHERE project_id=? ORDER BY name', [req.params.pid]);
  res.json({ vendors: rows });
});

app.post('/api/projects/:pid/vendors', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'não encontrado' });
  const b = req.body || {};
  const name = trim(b.name, 200);
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const [r] = await pool.execute(
    `INSERT INTO vendors (project_id, name, category, contact, phone, email, quoted, contracted, paid, status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [req.params.pid, name, trim(b.category, 120) || null, trim(b.contact, 200) || null,
     trim(b.phone, 60) || null, trim(b.email, 190) || null,
     asDec(b.quoted), asDec(b.contracted), asDec(b.paid),
     trim(b.status, 30) || 'em_negociacao', trim(b.notes, 4000) || null]
  );
  const [rows] = await pool.execute('SELECT * FROM vendors WHERE id=?', [r.insertId]);
  res.json({ vendor: rows[0] });
});

app.put('/api/vendors/:id', auth, async (req, res) => {
  const [check] = await pool.execute(
    'SELECT v.* FROM vendors v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!check.length) return res.status(404).json({ error: 'não encontrado' });
  const cur = check[0];
  const b = req.body || {};
  await pool.execute(
    `UPDATE vendors SET name=?, category=?, contact=?, phone=?, email=?, quoted=?, contracted=?, paid=?, status=?, notes=? WHERE id=?`,
    [
      b.name != null ? trim(b.name, 200) : cur.name,
      b.category !== undefined ? (trim(b.category, 120) || null) : cur.category,
      b.contact !== undefined ? (trim(b.contact, 200) || null) : cur.contact,
      b.phone !== undefined ? (trim(b.phone, 60) || null) : cur.phone,
      b.email !== undefined ? (trim(b.email, 190) || null) : cur.email,
      b.quoted !== undefined ? asDec(b.quoted) : cur.quoted,
      b.contracted !== undefined ? asDec(b.contracted) : cur.contracted,
      b.paid !== undefined ? asDec(b.paid) : cur.paid,
      b.status != null ? trim(b.status, 30) : cur.status,
      b.notes !== undefined ? (trim(b.notes, 4000) || null) : cur.notes,
      req.params.id,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/vendors/:id', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT v.id FROM vendors v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
  await pool.execute('DELETE FROM vendors WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- guests + RSVP ----------
app.get('/api/projects/:pid/guests', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'não encontrado' });
  const [rows] = await pool.execute('SELECT * FROM guests WHERE project_id=? ORDER BY name', [req.params.pid]);
  res.json({ guests: rows });
});

app.post('/api/projects/:pid/guests', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'não encontrado' });
  const b = req.body || {};
  const name = trim(b.name, 200);
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const token = crypto.randomBytes(16).toString('hex');
  const [r] = await pool.execute(
    `INSERT INTO guests (project_id, name, email, phone, party_size, note, rsvp_token) VALUES (?,?,?,?,?,?,?)`,
    [req.params.pid, name, trim(b.email, 190) || null, trim(b.phone, 60) || null,
     asInt(b.party_size) || 1, trim(b.note, 4000) || null, token]
  );
  const [rows] = await pool.execute('SELECT * FROM guests WHERE id=?', [r.insertId]);
  res.json({ guest: rows[0] });
});

app.put('/api/guests/:id', auth, async (req, res) => {
  const [check] = await pool.execute(
    'SELECT g.* FROM guests g JOIN projects p ON p.id=g.project_id WHERE g.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!check.length) return res.status(404).json({ error: 'não encontrado' });
  const cur = check[0];
  const b = req.body || {};
  await pool.execute(
    `UPDATE guests SET name=?, email=?, phone=?, party_size=?, rsvp_status=?, note=? WHERE id=?`,
    [
      b.name != null ? trim(b.name, 200) : cur.name,
      b.email !== undefined ? (trim(b.email, 190) || null) : cur.email,
      b.phone !== undefined ? (trim(b.phone, 60) || null) : cur.phone,
      b.party_size !== undefined ? (asInt(b.party_size) || 1) : cur.party_size,
      b.rsvp_status != null ? trim(b.rsvp_status, 20) : cur.rsvp_status,
      b.note !== undefined ? (trim(b.note, 4000) || null) : cur.note,
      req.params.id,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/guests/:id', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT g.id FROM guests g JOIN projects p ON p.id=g.project_id WHERE g.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'não encontrado' });
  await pool.execute('DELETE FROM guests WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// Public RSVP endpoints
app.get('/api/rsvp/:token', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT g.id, g.name, g.rsvp_status, g.party_size, p.name AS project_name, p.event_date, p.location
     FROM guests g JOIN projects p ON p.id=g.project_id WHERE g.rsvp_token=?`,
    [req.params.token]
  );
  if (!rows.length) return res.status(404).json({ error: 'convite não encontrado' });
  res.json({ guest: rows[0] });
});

app.post('/api/rsvp/:token', async (req, res) => {
  const status = trim(req.body?.status, 20);
  if (!['sim', 'nao', 'talvez'].includes(status)) return res.status(400).json({ error: 'estado inválido' });
  const party = asInt(req.body?.party_size);
  const [r] = await pool.execute(
    `UPDATE guests SET rsvp_status=?, party_size=COALESCE(?, party_size) WHERE rsvp_token=?`,
    [status, party, req.params.token]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'convite não encontrado' });
  res.json({ ok: true });
});

// ---------- PDF ----------
app.get('/api/projects/:id/pdf', auth, async (req, res) => {
  const [prows] = await pool.execute('SELECT * FROM projects WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!prows.length) return res.status(404).json({ error: 'não encontrado' });
  const project = prows[0];
  const [tasks] = await pool.execute('SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, id', [req.params.id]);
  const [vendors] = await pool.execute('SELECT * FROM vendors WHERE project_id=? ORDER BY name', [req.params.id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="eveni-${project.id}.pdf"`);
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  const brand = project.brand_color || '#4f46e5';
  doc.fillColor(brand).fontSize(22).text('Eveni — Relatório de Projecto', { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor('#111').fontSize(16).text(project.name);
  doc.fontSize(10).fillColor('#555');
  const meta = [];
  if (project.event_date) meta.push(`Data do evento: ${project.event_date}`);
  if (project.location) meta.push(`Local: ${project.location}`);
  if (project.audience) meta.push(`Público: ${project.audience}`);
  if (project.budget) meta.push(`Orçamento: ${Number(project.budget).toLocaleString('pt-PT')} €`);
  doc.text(meta.join('  ·  '));
  doc.moveDown(1);

  // Tarefas por fase
  const phases = {};
  for (const t of tasks) (phases[t.phase] = phases[t.phase] || []).push(t);
  doc.fillColor('#111').fontSize(14).text('Tarefas');
  doc.moveDown(0.3);
  for (const [phase, list] of Object.entries(phases)) {
    doc.fillColor(brand).fontSize(12).text(phase);
    doc.fillColor('#111').fontSize(10);
    for (const t of list) {
      const chk = t.done ? '[x]' : '[ ]';
      const dates = [t.start_date, t.end_date].filter(Boolean).join(' → ');
      const crit = t.critical ? '  ⚠' : '';
      doc.text(`${chk} ${t.title}${crit}${dates ? '  (' + dates + ')' : ''}`, { indent: 10 });
    }
    doc.moveDown(0.4);
  }

  if (vendors.length) {
    doc.addPage();
    doc.fillColor('#111').fontSize(14).text('Fornecedores');
    doc.moveDown(0.3);
    doc.fontSize(10);
    for (const v of vendors) {
      doc.fillColor(brand).text(v.name);
      doc.fillColor('#333').text(
        `  ${v.category || '—'}  ·  ${v.status || '—'}  ·  contratado: ${v.contracted || 0} €  ·  pago: ${v.paid || 0} €`
      );
      if (v.contact || v.phone || v.email) {
        doc.fillColor('#666').text(`  ${[v.contact, v.phone, v.email].filter(Boolean).join(' · ')}`);
      }
      doc.moveDown(0.3);
    }
  }

  doc.moveDown(2);
  doc.fillColor('#888').fontSize(8).text(`Gerado por Eveni em ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, { align: 'right' });
  doc.end();
});

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ ok: true, version: '1.0.0' }));

// ---------- 404 for API ----------
app.use('/api/', (req, res) => res.status(404).json({ error: 'endpoint não existe' }));

// ---------- SPA fallback ----------
app.get('/rsvp/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rsvp.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- global error handler (sanitiza mensagens) ----------
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.code || '', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'erro interno. Tente novamente mais tarde.' });
});

// ---------- boot ----------
(async () => {
  await migrate();
  app.listen(PORT, '0.0.0.0', () => console.log(`Eveni a escutar em ${PORT}`));
})();
