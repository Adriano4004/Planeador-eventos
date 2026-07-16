// Server for Planejamento Estratégico de Eventos — Secure Edition v1.1
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

// ---------- SECRETS ----------
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET missing or too short (min 32 chars). Set a strong random value in Railway Variables.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = mysql.createPool({ uri: url, connectionLimit: 10 });

const PUBLIC_URL = process.env.PUBLIC_URL || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'nao-responder@example.com';

// ---------- EMAIL ----------
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
async function sendMail(to, subject, html) {
  if (!mailer) {
    console.log('[email:skipped no SMTP configured] to=%s subject=%s', to, subject);
    return;
  }
  try {
    await mailer.sendMail({ from: EMAIL_FROM, to, subject, html });
  } catch (e) {
    console.error('sendMail error:', e.message);
  }
}

// ---------- MIDDLEWARE ----------
app.set('trust proxy', 1); // needed on Railway/behind proxy for correct IP in rate-limits
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'", 'data:'],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '200kb' })); // reduced from 2mb
app.use(cookieParser());

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // 10 tentativas por IP por 15 min
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'muitas tentativas. Tente novamente em 15 minutos.' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'limite de registos atingido. Tente novamente mais tarde.' },
});
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'muitos pedidos de recuperação. Tente novamente mais tarde.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120, // 120 requests / minute per IP for regular API
  standardHeaders: true, legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// Static (after helmet to keep headers)
app.use(express.static(path.join(__dirname, 'public')));

// ---------- MIGRATIONS ----------
async function migrate() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(120) NOT NULL,
      email_verified TINYINT(1) DEFAULT 0,
      verify_token VARCHAR(64),
      verify_expires DATETIME,
      reset_token VARCHAR(64),
      reset_expires DATETIME,
      failed_logins INT DEFAULT 0,
      locked_until DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Best-effort add columns if table already exists from v1.0
  const alters = [
    "ALTER TABLE users ADD COLUMN email_verified TINYINT(1) DEFAULT 0",
    "ALTER TABLE users ADD COLUMN verify_token VARCHAR(64)",
    "ALTER TABLE users ADD COLUMN verify_expires DATETIME",
    "ALTER TABLE users ADD COLUMN reset_token VARCHAR(64)",
    "ALTER TABLE users ADD COLUMN reset_expires DATETIME",
    "ALTER TABLE users ADD COLUMN failed_logins INT DEFAULT 0",
    "ALTER TABLE users ADD COLUMN locked_until DATETIME",
  ];
  for (const sql of alters) {
    try { await pool.execute(sql); } catch (e) {
      if (!/duplicate|exists|Duplicate/.test(e.message)) console.warn('migration warning:', sql, '-', e.message);
    }
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(200) NOT NULL,
      event_date DATE,
      start_date DATE,
      location VARCHAR(200),
      audience INT,
      ticket_price DECIMAL(10,2),
      expected_revenue DECIMAL(12,2),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      phase VARCHAR(20) NOT NULL,
      category VARCHAR(200) NOT NULL,
      title VARCHAR(300) NOT NULL,
      responsible VARCHAR(120),
      start_date DATE,
      end_date DATE,
      done TINYINT(1) DEFAULT 0,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      project_id INT,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(120),
      contact_name VARCHAR(120),
      email VARCHAR(190),
      phone VARCHAR(60),
      city VARCHAR(120),
      rating TINYINT,
      status VARCHAR(30) DEFAULT 'novo',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
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
      category VARCHAR(120),
      table_no VARCHAR(30),
      companions INT DEFAULT 0,
      rsvp_status VARCHAR(20) DEFAULT 'pendente',
      notes VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS budget_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      category VARCHAR(120) NOT NULL,
      description VARCHAR(300) NOT NULL,
      unit_price DECIMAL(14,2) DEFAULT 0,
      quantity DECIMAL(10,2) DEFAULT 1,
      planned DECIMAL(14,2) DEFAULT 0,
      actual DECIMAL(14,2) DEFAULT 0,
      supplier_id INT,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS project_rsvp_tokens (
      project_id INT PRIMARY KEY,
      token VARCHAR(48) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // brand fields on users (for PDF header)
  const brandAlters = [
    "ALTER TABLE users ADD COLUMN company_name VARCHAR(160)",
    "ALTER TABLE users ADD COLUMN company_phone VARCHAR(60)",
    "ALTER TABLE users ADD COLUMN company_email VARCHAR(190)",
    "ALTER TABLE users ADD COLUMN brand_color VARCHAR(16)",
  ];
  for (const sql of brandAlters) {
    try { await pool.execute(sql); } catch (e) { /* ignore */ }
  }
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      event VARCHAR(50) NOT NULL,
      ip VARCHAR(64),
      user_agent VARCHAR(300),
      metadata TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_event (event, created_at)
    )
  `);
}

async function auditLog(userId, event, req, metadata) {
  try {
    const ip = (req.ip || '').slice(0, 60);
    const ua = String(req.headers['user-agent'] || '').slice(0, 290);
    const meta = metadata ? JSON.stringify(metadata).slice(0, 1000) : null;
    await pool.execute('INSERT INTO audit_log (user_id, event, ip, user_agent, metadata) VALUES (?,?,?,?,?)',
      [userId, event, ip, ua, meta]);
  } catch (e) { /* never break request due to logging */ }
}

// ---------- HELPERS ----------
function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 190;
}
function validPassword(s) {
  if (typeof s !== 'string' || s.length < 8 || s.length > 128) return false;
  const hasLetter = /[A-Za-zÀ-ÿ]/.test(s);
  const hasDigit = /\d/.test(s);
  return hasLetter && hasDigit;
}
function trim(s, max) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  return str.slice(0, max);
}

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: IS_PROD, // in production Railway serves HTTPS
  maxAge: 30 * 24 * 3600 * 1000,
  path: '/',
});

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// CSRF: double-submit cookie pattern (state-changing requests must send header token == cookie value)
function csrfSet(req, res, next) {
  if (!req.cookies.csrf) {
    const t = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf', t, {
      httpOnly: false, // must be readable by JS to echo in header
      sameSite: 'strict',
      secure: IS_PROD,
      maxAge: 30 * 24 * 3600 * 1000,
      path: '/',
    });
    req.cookies.csrf = t;
  }
  next();
}
function csrfCheck(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const cookieToken = req.cookies.csrf;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'csrf token inválido' });
  }
  next();
}
app.use(csrfSet);
app.use('/api/', csrfCheck);

// ---------- AUTH ROUTES ----------

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const email = trim(req.body?.email, 190)?.toLowerCase();
    const name = trim(req.body?.name, 120);
    const password = req.body?.password;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, nome e senha são obrigatórios' });
    if (!validEmail(email)) return res.status(400).json({ error: 'email inválido' });
    if (!validPassword(password)) return res.status(400).json({ error: 'senha deve ter mínimo 8 caracteres com letras e números' });
    const hash = await bcrypt.hash(password, 12); // slightly stronger than 10
    const verifyToken = crypto.randomBytes(24).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 3600 * 1000);
    let result;
    try {
      [result] = await pool.execute(
        'INSERT INTO users (email, password_hash, name, verify_token, verify_expires) VALUES (?,?,?,?,?)',
        [email, hash, name, verifyToken, verifyExpires]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'email já cadastrado' });
      throw e;
    }
    const user = { id: result.insertId, email, name };
    await seedDefaultProject(user.id);
    await auditLog(user.id, 'register', req, { email });

    // Send verification email (soft: user can still log in but sees warning)
    if (PUBLIC_URL) {
      const link = `${PUBLIC_URL.replace(/\/$/, '')}/api/auth/verify?token=${verifyToken}`;
      await sendMail(email, 'Confirme o seu e-mail', `
        <p>Olá ${escapeHtml(name)},</p>
        <p>Confirme o seu e-mail clicando no link abaixo (válido por 24h):</p>
        <p><a href="${link}">${link}</a></p>
        <p>Se não foi você, ignore este e-mail.</p>
      `);
    }

    const token = signToken(user);
    res.cookie('token', token, cookieOpts());
    res.json({ user, token, email_verified: false });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'erro ao registrar' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = trim(req.body?.email, 190)?.toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return res.status(400).json({ error: 'email e senha obrigatórios' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) {
      // Deliberate delay to blunt user enumeration
      await bcrypt.compare(password, '$2a$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ12345678');
      return res.status(400).json({ error: 'credenciais inválidas' });
    }
    const u = rows[0];
    if (u.locked_until && new Date(u.locked_until) > new Date()) {
      return res.status(429).json({ error: 'conta temporariamente bloqueada. Tente mais tarde.' });
    }
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      const failed = (u.failed_logins || 0) + 1;
      let lockedUntil = null;
      if (failed >= 5) { lockedUntil = new Date(Date.now() + 15 * 60 * 1000); }
      await pool.execute('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [failed, lockedUntil, u.id]);
      await auditLog(u.id, 'login_failed', req, { email });
      return res.status(400).json({ error: 'credenciais inválidas' });
    }
    // Success — clear failure counters
    await pool.execute('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [u.id]);
    const user = { id: u.id, email: u.email, name: u.name };
    const token = signToken(user);
    res.cookie('token', token, cookieOpts());
    await auditLog(u.id, 'login_success', req);
    res.json({ user, token, email_verified: !!u.email_verified });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'erro no login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT id, email, name, email_verified FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) return res.status(401).json({ error: 'not found' });
  res.json({ user: { id: rows[0].id, email: rows[0].email, name: rows[0].name }, email_verified: !!rows[0].email_verified });
});

// Password reset — request
app.post('/api/auth/forgot', passwordResetLimiter, async (req, res) => {
  try {
    const email = trim(req.body?.email, 190)?.toLowerCase();
    if (!email || !validEmail(email)) return res.json({ ok: true }); // don't reveal
    const [rows] = await pool.execute('SELECT id, name FROM users WHERE email=?', [email]);
    if (rows.length) {
      const token = crypto.randomBytes(24).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await pool.execute('UPDATE users SET reset_token=?, reset_expires=? WHERE id=?', [token, expires, rows[0].id]);
      await auditLog(rows[0].id, 'password_reset_request', req);
      if (PUBLIC_URL) {
        const link = `${PUBLIC_URL.replace(/\/$/, '')}/redefinir-senha?token=${token}`;
        await sendMail(email, 'Redefinição de senha', `
          <p>Olá ${escapeHtml(rows[0].name)},</p>
          <p>Recebemos um pedido para redefinir a sua senha. Clique no link abaixo (válido por 1 hora):</p>
          <p><a href="${link}">${link}</a></p>
          <p>Se não foi você, ignore este e-mail. A sua senha continua inalterada.</p>
        `);
      }
    }
    // Always respond success to avoid user enumeration
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.json({ ok: true });
  }
});

// Password reset — perform
app.post('/api/auth/reset', passwordResetLimiter, async (req, res) => {
  try {
    const token = trim(req.body?.token, 64);
    const password = req.body?.password;
    if (!token || !validPassword(password)) return res.status(400).json({ error: 'dados inválidos' });
    const [rows] = await pool.execute(
      'SELECT id FROM users WHERE reset_token=? AND reset_expires > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'link inválido ou expirado' });
    const hash = await bcrypt.hash(password, 12);
    await pool.execute(
      'UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL, failed_logins=0, locked_until=NULL WHERE id=?',
      [hash, rows[0].id]
    );
    await auditLog(rows[0].id, 'password_reset_success', req);
    res.json({ ok: true });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'erro' });
  }
});

// Email verification
app.get('/api/auth/verify', async (req, res) => {
  const token = String(req.query.token || '').slice(0, 64);
  if (!token) return res.redirect('/?verified=0');
  const [rows] = await pool.execute(
    'SELECT id FROM users WHERE verify_token=? AND verify_expires > NOW()',
    [token]
  );
  if (!rows.length) return res.redirect('/?verified=0');
  await pool.execute(
    'UPDATE users SET email_verified=1, verify_token=NULL, verify_expires=NULL WHERE id=?',
    [rows[0].id]
  );
  await auditLog(rows[0].id, 'email_verified', req);
  res.redirect('/?verified=1');
});

// Resend verification
app.post('/api/auth/resend-verify', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT email, name, email_verified FROM users WHERE id=?', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  if (rows[0].email_verified) return res.json({ ok: true });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 24 * 3600 * 1000);
  await pool.execute('UPDATE users SET verify_token=?, verify_expires=? WHERE id=?', [token, expires, req.user.id]);
  if (PUBLIC_URL) {
    const link = `${PUBLIC_URL.replace(/\/$/, '')}/api/auth/verify?token=${token}`;
    await sendMail(rows[0].email, 'Confirme o seu e-mail', `
      <p>Olá ${escapeHtml(rows[0].name)},</p>
      <p>Confirme o seu e-mail (link válido por 24h):</p>
      <p><a href="${link}">${link}</a></p>
    `);
  }
  res.json({ ok: true });
});

// Export account data (LGPD/GDPR — right to data portability)
app.get('/api/account/export', auth, async (req, res) => {
  const [u] = await pool.execute('SELECT id, email, name, email_verified, created_at FROM users WHERE id=?', [req.user.id]);
  const [projects] = await pool.execute('SELECT * FROM projects WHERE user_id=?', [req.user.id]);
  const [tasks] = await pool.execute(
    'SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.user_id=?',
    [req.user.id]
  );
  res.setHeader('Content-Disposition', 'attachment; filename="meus-dados.json"');
  res.json({ user: u[0], projects, tasks, exported_at: new Date().toISOString() });
});

// Delete account (LGPD/GDPR — right to erasure)
app.delete('/api/account', auth, async (req, res) => {
  const [projects] = await pool.execute('SELECT id FROM projects WHERE user_id=?', [req.user.id]);
  const projectIds = projects.map(p => p.id);
  if (projectIds.length) {
    const placeholders = projectIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM tasks WHERE project_id IN (${placeholders})`, projectIds);
    await pool.execute(`DELETE FROM guests WHERE project_id IN (${placeholders})`, projectIds);
    await pool.execute(`DELETE FROM budget_items WHERE project_id IN (${placeholders})`, projectIds);
    await pool.execute(`DELETE FROM project_rsvp_tokens WHERE project_id IN (${placeholders})`, projectIds);
  }
  await pool.execute('DELETE FROM suppliers WHERE user_id=?', [req.user.id]);
  await pool.execute('DELETE FROM projects WHERE user_id=?', [req.user.id]);
  await pool.execute('DELETE FROM users WHERE id=?', [req.user.id]);
  await auditLog(req.user.id, 'account_deleted', req);
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

// ---------- DEFAULT TEMPLATE ----------
const DEFAULT_TEMPLATE = [
  ['PRÉ', 'Planejamento da ação', 'Avaliação do cenário sócio-econômico'],
  ['PRÉ', 'Planejamento da ação', 'Delimitação do conceito'],
  ['PRÉ', 'Planejamento da ação', 'Objetivo do evento'],
  ['PRÉ', 'Planejamento da ação', 'Público Alvo'],
  ['PRÉ', 'Planejamento da ação', 'Definição do local'],
  ['PRÉ', 'Planejamento da ação', 'Definição da data'],
  ['PRÉ', 'Planejamento da ação', 'Definição do horário'],
  ['PRÉ', 'Planejamento da ação', 'Levantamento de custos'],
  ['PRÉ', 'Formação das equipes', 'Técnica'],
  ['PRÉ', 'Formação das equipes', 'Logística'],
  ['PRÉ', 'Formação das equipes', 'Infra-estrutura'],
  ['PRÉ', 'Formação das equipes', 'Comunicação'],
  ['PRÉ', 'Formação das equipes', 'Segurança'],
  ['PRÉ', 'Programação', 'Definição completa da programação'],
  ['PRÉ', 'Administrativo-financeiro', 'Definição do orçamento'],
  ['PRÉ', 'Administrativo-financeiro', 'Levantamento de planilha/controle de orçamento'],
  ['PRÉ', 'Montagem de check-lists', 'Fornecedores'],
  ['PRÉ', 'Montagem de check-lists', 'Compras'],
  ['PRÉ', 'Captação de recursos', 'Patrocínio'],
  ['PRÉ', 'Captação de recursos', 'Permutas'],
  ['PRÉ', 'Captação de recursos', 'Venda de ingressos/inscrições'],
  ['PRÉ', 'Jurídico', 'Levantamento/negociação dos direitos autorais'],
  ['PRÉ', 'Jurídico', 'Definição de contrapartidas'],
  ['PRÉ', 'Jurídico', 'Assinatura de contratos'],
  ['PRODUÇÃO', 'Cronograma de execução', 'Cronogramas'],
  ['PRODUÇÃO', 'Jurídico', 'Alvarás'],
  ['PRODUÇÃO', 'Jurídico', 'Taxas públicas'],
  ['PRODUÇÃO', 'Jurídico', 'Regulamento do evento'],
  ['PRODUÇÃO', 'Jurídico', 'Levantamento de documentação'],
  ['PRODUÇÃO', 'Artístico', 'Transporte'],
  ['PRODUÇÃO', 'Artístico', 'Translado'],
  ['PRODUÇÃO', 'Artístico', 'Hospedagem (rooming list)'],
  ['PRODUÇÃO', 'Artístico', 'Alimentação'],
  ['PRODUÇÃO', 'Artístico', 'Camarim'],
  ['PRODUÇÃO', 'Artístico', 'Receptivo'],
  ['PRODUÇÃO', 'Artístico', 'Tradutor'],
  ['PRODUÇÃO', 'Técnica', 'Definição do orçamento'],
  ['PRODUÇÃO', 'Técnica', 'Cenário'],
  ['PRODUÇÃO', 'Técnica', 'Figurino/maquiagem'],
  ['PRODUÇÃO', 'Técnica', 'Equipamentos (iluminação, sonorização…)'],
  ['PRODUÇÃO', 'Técnica', 'Uniforme'],
  ['PRODUÇÃO', 'Técnica', 'Transporte'],
  ['PRODUÇÃO', 'Técnica', 'Translado'],
  ['PRODUÇÃO', 'Técnica', 'Alimentação'],
  ['PRODUÇÃO', 'Local', 'Ambientação/Decoração'],
  ['PRODUÇÃO', 'Local', 'Sinalização (Posicionamento)'],
  ['PRODUÇÃO', 'Local', 'Credenciamento/Portaria'],
  ['PRODUÇÃO', 'Local', 'Acessibilidade'],
  ['PRODUÇÃO', 'Local', 'Rota de fuga'],
  ['PRODUÇÃO', 'Local', 'Vistorias (laudos técnicos, bombeiros)'],
  ['PRODUÇÃO', 'Local', 'Estrutura (palco, sala de produção, imprensa)'],
  ['PRODUÇÃO', 'Local', 'Infraestrutura'],
  ['PRODUÇÃO', 'Local', 'Limpeza'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Planejamento estratégico'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Cerimonial (definição de hostess, etc)'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Sinalização (criação e produção)'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Peças institucionais'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Peças gráficas'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Peças volantes'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Brindes e material promocional'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Mídia paga (rádio, tv, impressos, internet)'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Assessoria de imprensa (mídia espontânea)'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Redes sociais'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Comunicação interna'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Clipping'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Premiação'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Certificado (confecção)'],
  ['PRODUÇÃO', 'Divulgação e Marketing', 'Pesquisa de satisfação (público geral)'],
  ['PÓS', 'Desmontagem', 'Estrutura'],
  ['PÓS', 'Desmontagem', 'Equipamentos'],
  ['PÓS', 'Desmontagem', 'Limpeza'],
  ['PÓS', 'Borderô', 'Produzir borderô'],
  ['PÓS', 'Entrega dos Certificados', 'Enviar certificados'],
  ['PÓS', 'Pagamentos/Acertos finais', 'Definição do orçamento real'],
  ['PÓS', 'Pagamentos/Acertos finais', 'Equipe'],
  ['PÓS', 'Pagamentos/Acertos finais', 'Fornecedores'],
  ['PÓS', 'Pesquisa de satisfação', 'Enviar e apurar a pesquisa'],
  ['PÓS', 'Relatório final', 'Produção do relatório final'],
];

async function seedDefaultProject(userId) {
  const [r] = await pool.execute(
    'INSERT INTO projects (user_id, name, expected_revenue, audience, ticket_price) VALUES (?,?,?,?,?)',
    [userId, 'Meu Primeiro Evento', 15000, 500, 30]
  );
  const projectId = r.insertId;
  let i = 0;
  for (const [phase, category, title] of DEFAULT_TEMPLATE) {
    await pool.execute(
      'INSERT INTO tasks (project_id, phase, category, title, sort_order) VALUES (?,?,?,?,?)',
      [projectId, phase, category, title, i++]
    );
  }
  return projectId;
}

// ---------- PER-USER RESOURCE LIMITS ----------
const MAX_PROJECTS_PER_USER = 50;
const MAX_TASKS_PER_PROJECT = 500;

// ---------- PROJECTS ----------
app.get('/api/projects', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM projects WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json({ projects: rows });
});

app.post('/api/projects', auth, async (req, res) => {
  const [count] = await pool.execute('SELECT COUNT(*) AS c FROM projects WHERE user_id=?', [req.user.id]);
  if (count[0].c >= MAX_PROJECTS_PER_USER) {
    return res.status(400).json({ error: `limite de ${MAX_PROJECTS_PER_USER} projetos atingido` });
  }
  const name = trim(req.body?.name, 200);
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });
  const location = trim(req.body?.location, 200);
  const event_date = req.body?.event_date || null;
  const start_date = req.body?.start_date || null;
  const audience = req.body?.audience ? Math.max(0, Math.min(10000000, Number(req.body.audience) || 0)) : null;
  const ticket_price = req.body?.ticket_price != null ? Math.max(0, Math.min(1e10, Number(req.body.ticket_price) || 0)) : null;
  const expected_revenue = req.body?.expected_revenue != null ? Math.max(0, Math.min(1e12, Number(req.body.expected_revenue) || 0)) : null;
  const seed = req.body?.seed;

  const [r] = await pool.execute(
    'INSERT INTO projects (user_id, name, event_date, start_date, location, audience, ticket_price, expected_revenue) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, name, event_date, start_date, location, audience, ticket_price, expected_revenue]
  );
  const projectId = r.insertId;
  if (seed !== false) {
    let i = 0;
    for (const [phase, category, title] of DEFAULT_TEMPLATE) {
      await pool.execute(
        'INSERT INTO tasks (project_id, phase, category, title, sort_order) VALUES (?,?,?,?,?)',
        [projectId, phase, category, title, i++]
      );
    }
  }
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id=?', [projectId]);
  res.json({ project: rows[0] });
});

app.get('/api/projects/:id', auth, async (req, res) => {
  const pid = Number(req.params.id);
  if (!Number.isInteger(pid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id=? AND user_id=?', [pid, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const [tasks] = await pool.execute('SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, id', [pid]);
  res.json({ project: rows[0], tasks });
});

app.put('/api/projects/:id', auth, async (req, res) => {
  const pid = Number(req.params.id);
  if (!Number.isInteger(pid)) return res.status(400).json({ error: 'id inválido' });
  const [check] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [pid, req.user.id]);
  if (!check.length) return res.status(404).json({ error: 'not found' });
  const name = trim(req.body?.name, 200);
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });
  const location = trim(req.body?.location, 200);
  const event_date = req.body?.event_date || null;
  const start_date = req.body?.start_date || null;
  const audience = req.body?.audience ? Math.max(0, Math.min(10000000, Number(req.body.audience) || 0)) : null;
  const ticket_price = req.body?.ticket_price != null ? Math.max(0, Math.min(1e10, Number(req.body.ticket_price) || 0)) : null;
  const expected_revenue = req.body?.expected_revenue != null ? Math.max(0, Math.min(1e12, Number(req.body.expected_revenue) || 0)) : null;
  await pool.execute(
    'UPDATE projects SET name=?, event_date=?, start_date=?, location=?, audience=?, ticket_price=?, expected_revenue=? WHERE id=?',
    [name, event_date, start_date, location, audience, ticket_price, expected_revenue, pid]
  );
  res.json({ ok: true });
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  const pid = Number(req.params.id);
  if (!Number.isInteger(pid)) return res.status(400).json({ error: 'id inválido' });
  const [check] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [pid, req.user.id]);
  if (!check.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM tasks WHERE project_id=?', [pid]);
  await pool.execute('DELETE FROM guests WHERE project_id=?', [pid]);
  await pool.execute('DELETE FROM budget_items WHERE project_id=?', [pid]);
  await pool.execute('DELETE FROM project_rsvp_tokens WHERE project_id=?', [pid]);
  await pool.execute('UPDATE suppliers SET project_id=NULL WHERE project_id=? AND user_id=?', [pid, req.user.id]);
  await pool.execute('DELETE FROM projects WHERE id=?', [pid]);
  res.json({ ok: true });
});

// ---------- TASKS ----------
async function ensureProject(userId, projectId) {
  const [rows] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [projectId, userId]);
  return rows.length > 0;
}

app.post('/api/projects/:pid/tasks', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid)) return res.status(400).json({ error: 'id inválido' });
  if (!await ensureProject(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const [count] = await pool.execute('SELECT COUNT(*) AS c FROM tasks WHERE project_id=?', [pid]);
  if (count[0].c >= MAX_TASKS_PER_PROJECT) {
    return res.status(400).json({ error: `limite de ${MAX_TASKS_PER_PROJECT} tarefas por projeto atingido` });
  }
  const title = trim(req.body?.title, 300);
  if (!title) return res.status(400).json({ error: 'título obrigatório' });
  const phase = trim(req.body?.phase, 20) || 'PRÉ';
  const category = trim(req.body?.category, 200) || 'Geral';
  const responsible = trim(req.body?.responsible, 120);
  const start_date = req.body?.start_date || null;
  const end_date = req.body?.end_date || null;
  const [max] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS o FROM tasks WHERE project_id=?', [pid]);
  const [r] = await pool.execute(
    'INSERT INTO tasks (project_id, phase, category, title, responsible, start_date, end_date, sort_order) VALUES (?,?,?,?,?,?,?,?)',
    [pid, phase, category, title, responsible, start_date, end_date, max[0].o]
  );
  const [rows] = await pool.execute('SELECT * FROM tasks WHERE id=?', [r.insertId]);
  res.json({ task: rows[0] });
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const tid = Number(req.params.id);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?',
    [tid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const cur = rows[0];
  const b = req.body || {};
  const done = b.done !== undefined ? (b.done ? 1 : 0) : cur.done;
  const phase = b.phase !== undefined ? (trim(b.phase, 20) || cur.phase) : cur.phase;
  const category = b.category !== undefined ? (trim(b.category, 200) || cur.category) : cur.category;
  const title = b.title !== undefined ? (trim(b.title, 300) || cur.title) : cur.title;
  const responsible = b.responsible !== undefined ? trim(b.responsible, 120) : cur.responsible;
  const start_date = b.start_date !== undefined ? (b.start_date || null) : cur.start_date;
  const end_date = b.end_date !== undefined ? (b.end_date || null) : cur.end_date;
  await pool.execute(
    'UPDATE tasks SET phase=?, category=?, title=?, responsible=?, start_date=?, end_date=?, done=? WHERE id=?',
    [phase, category, title, responsible, start_date, end_date, done, tid]
  );
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  const tid = Number(req.params.id);
  if (!Number.isInteger(tid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?',
    [tid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM tasks WHERE id=?', [tid]);
  res.json({ ok: true });
});

// ---------- SUPPLIERS (mini CRM) ----------
async function ensureProjectOwn(userId, pid) {
  const [rows] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [pid, userId]);
  return rows.length > 0;
}

app.get('/api/suppliers', auth, async (req, res) => {
  const pid = req.query.project_id ? Number(req.query.project_id) : null;
  let rows;
  if (pid && Number.isInteger(pid)) {
    if (!await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
    [rows] = await pool.execute(
      'SELECT * FROM suppliers WHERE user_id=? AND (project_id=? OR project_id IS NULL) ORDER BY name',
      [req.user.id, pid]
    );
  } else {
    [rows] = await pool.execute('SELECT * FROM suppliers WHERE user_id=? ORDER BY name', [req.user.id]);
  }
  res.json({ suppliers: rows });
});

app.post('/api/suppliers', auth, async (req, res) => {
  const b = req.body || {};
  const name = trim(b.name, 200);
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const projectId = b.project_id ? Number(b.project_id) : null;
  if (projectId && !await ensureProjectOwn(req.user.id, projectId)) return res.status(400).json({ error: 'projeto inválido' });
  const rating = b.rating != null && b.rating !== '' ? Math.max(0, Math.min(5, Number(b.rating) || 0)) : null;
  const [r] = await pool.execute(
    'INSERT INTO suppliers (user_id, project_id, name, category, contact_name, email, phone, city, rating, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [req.user.id, projectId, name, trim(b.category, 120), trim(b.contact_name, 120), trim(b.email, 190), trim(b.phone, 60), trim(b.city, 120), rating, trim(b.status, 30) || 'novo', trim(b.notes, 2000)]
  );
  const [rows] = await pool.execute('SELECT * FROM suppliers WHERE id=?', [r.insertId]);
  res.json({ supplier: rows[0] });
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid)) return res.status(400).json({ error: 'id inválido' });
  const [chk] = await pool.execute('SELECT * FROM suppliers WHERE id=? AND user_id=?', [sid, req.user.id]);
  if (!chk.length) return res.status(404).json({ error: 'not found' });
  const cur = chk[0]; const b = req.body || {};
  const name = b.name !== undefined ? (trim(b.name, 200) || cur.name) : cur.name;
  const rating = b.rating != null && b.rating !== '' ? Math.max(0, Math.min(5, Number(b.rating) || 0)) : cur.rating;
  const projectId = b.project_id !== undefined ? (b.project_id ? Number(b.project_id) : null) : cur.project_id;
  if (projectId && !await ensureProjectOwn(req.user.id, projectId)) return res.status(400).json({ error: 'projeto inválido' });
  await pool.execute(
    'UPDATE suppliers SET name=?, project_id=?, category=?, contact_name=?, email=?, phone=?, city=?, rating=?, status=?, notes=? WHERE id=?',
    [
      name, projectId,
      b.category !== undefined ? trim(b.category, 120) : cur.category,
      b.contact_name !== undefined ? trim(b.contact_name, 120) : cur.contact_name,
      b.email !== undefined ? trim(b.email, 190) : cur.email,
      b.phone !== undefined ? trim(b.phone, 60) : cur.phone,
      b.city !== undefined ? trim(b.city, 120) : cur.city,
      rating,
      b.status !== undefined ? (trim(b.status, 30) || cur.status) : cur.status,
      b.notes !== undefined ? trim(b.notes, 2000) : cur.notes,
      sid,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid)) return res.status(400).json({ error: 'id inválido' });
  const [chk] = await pool.execute('SELECT id FROM suppliers WHERE id=? AND user_id=?', [sid, req.user.id]);
  if (!chk.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('UPDATE budget_items SET supplier_id=NULL WHERE supplier_id=?', [sid]);
  await pool.execute('DELETE FROM suppliers WHERE id=?', [sid]);
  res.json({ ok: true });
});

// ---------- GUESTS (RSVP) ----------
app.get('/api/projects/:pid/guests', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const [rows] = await pool.execute('SELECT * FROM guests WHERE project_id=? ORDER BY name', [pid]);
  res.json({ guests: rows });
});

app.post('/api/projects/:pid/guests', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const name = trim(b.name, 200);
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const [count] = await pool.execute('SELECT COUNT(*) AS c FROM guests WHERE project_id=?', [pid]);
  if (count[0].c >= 5000) return res.status(400).json({ error: 'limite de convidados atingido' });
  const companions = Math.max(0, Math.min(50, Number(b.companions) || 0));
  const rsvp = trim(b.rsvp_status, 20) || 'pendente';
  const [r] = await pool.execute(
    'INSERT INTO guests (project_id, name, email, phone, category, table_no, companions, rsvp_status, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    [pid, name, trim(b.email, 190), trim(b.phone, 60), trim(b.category, 120), trim(b.table_no, 30), companions, rsvp, trim(b.notes, 500)]
  );
  const [rows] = await pool.execute('SELECT * FROM guests WHERE id=?', [r.insertId]);
  res.json({ guest: rows[0] });
});

app.put('/api/guests/:id', auth, async (req, res) => {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT g.* FROM guests g JOIN projects p ON p.id=g.project_id WHERE g.id=? AND p.user_id=?',
    [gid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const cur = rows[0]; const b = req.body || {};
  await pool.execute(
    'UPDATE guests SET name=?, email=?, phone=?, category=?, table_no=?, companions=?, rsvp_status=?, notes=? WHERE id=?',
    [
      b.name !== undefined ? (trim(b.name, 200) || cur.name) : cur.name,
      b.email !== undefined ? trim(b.email, 190) : cur.email,
      b.phone !== undefined ? trim(b.phone, 60) : cur.phone,
      b.category !== undefined ? trim(b.category, 120) : cur.category,
      b.table_no !== undefined ? trim(b.table_no, 30) : cur.table_no,
      b.companions !== undefined ? Math.max(0, Math.min(50, Number(b.companions) || 0)) : cur.companions,
      b.rsvp_status !== undefined ? (trim(b.rsvp_status, 20) || cur.rsvp_status) : cur.rsvp_status,
      b.notes !== undefined ? trim(b.notes, 500) : cur.notes,
      gid,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/guests/:id', auth, async (req, res) => {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT g.id FROM guests g JOIN projects p ON p.id=g.project_id WHERE g.id=? AND p.user_id=?',
    [gid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM guests WHERE id=?', [gid]);
  res.json({ ok: true });
});

// RSVP public link — generate/get token
app.get('/api/projects/:pid/rsvp-link', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  let [rows] = await pool.execute('SELECT token FROM project_rsvp_tokens WHERE project_id=?', [pid]);
  let token;
  if (rows.length) token = rows[0].token;
  else {
    token = crypto.randomBytes(18).toString('hex');
    await pool.execute('INSERT INTO project_rsvp_tokens (project_id, token) VALUES (?,?)', [pid, token]);
  }
  const base = PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ token, url: `${base.replace(/\/$/, '')}/rsvp/${token}` });
});

// RSVP public — get event info (no auth, no CSRF for GET)
app.get('/api/rsvp/:token', async (req, res) => {
  const token = String(req.params.token || '').slice(0, 60);
  const [rows] = await pool.execute(
    'SELECT p.id, p.name, p.event_date, p.location FROM project_rsvp_tokens t JOIN projects p ON p.id=t.project_id WHERE t.token=?',
    [token]
  );
  if (!rows.length) return res.status(404).json({ error: 'link inválido' });
  res.json({ project: rows[0] });
});

// RSVP public — submit confirmation (no auth; CSRF still required from browser)
app.post('/api/rsvp/:token', async (req, res) => {
  const token = String(req.params.token || '').slice(0, 60);
  const [rows] = await pool.execute(
    'SELECT project_id FROM project_rsvp_tokens WHERE token=?', [token]
  );
  if (!rows.length) return res.status(404).json({ error: 'link inválido' });
  const pid = rows[0].project_id;
  const b = req.body || {};
  const name = trim(b.name, 200);
  const rsvp = trim(b.rsvp_status, 20);
  if (!name || !['confirmado', 'recusado'].includes(rsvp)) return res.status(400).json({ error: 'dados inválidos' });
  const [count] = await pool.execute('SELECT COUNT(*) AS c FROM guests WHERE project_id=?', [pid]);
  if (count[0].c >= 5000) return res.status(400).json({ error: 'lista cheia' });
  const companions = Math.max(0, Math.min(20, Number(b.companions) || 0));
  await pool.execute(
    'INSERT INTO guests (project_id, name, email, phone, companions, rsvp_status, category) VALUES (?,?,?,?,?,?,?)',
    [pid, name, trim(b.email, 190), trim(b.phone, 60), companions, rsvp, 'RSVP público']
  );
  res.json({ ok: true });
});

// ---------- BUDGET ----------
app.get('/api/projects/:pid/budget', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const [rows] = await pool.execute('SELECT * FROM budget_items WHERE project_id=? ORDER BY sort_order, id', [pid]);
  res.json({ items: rows });
});

app.post('/api/projects/:pid/budget', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const description = trim(b.description, 300);
  const category = trim(b.category, 120);
  if (!description || !category) return res.status(400).json({ error: 'categoria e descrição obrigatórias' });
  const [count] = await pool.execute('SELECT COUNT(*) AS c FROM budget_items WHERE project_id=?', [pid]);
  if (count[0].c >= 1000) return res.status(400).json({ error: 'limite de itens atingido' });
  const num = (v, max = 1e10) => Math.max(0, Math.min(max, Number(v) || 0));
  const unit_price = num(b.unit_price);
  const quantity = num(b.quantity, 1e6);
  const planned = ('planned' in b && b.planned != null && b.planned !== '') ? num(b.planned, 1e12) : unit_price * quantity;
  const actual = num(b.actual, 1e12);
  const supplier_id = b.supplier_id ? Number(b.supplier_id) : null;
  const [max] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS o FROM budget_items WHERE project_id=?', [pid]);
  const [r] = await pool.execute(
    'INSERT INTO budget_items (project_id, category, description, unit_price, quantity, planned, actual, supplier_id, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
    [pid, category, description, unit_price, quantity, planned, actual, supplier_id, max[0].o]
  );
  const [rows] = await pool.execute('SELECT * FROM budget_items WHERE id=?', [r.insertId]);
  res.json({ item: rows[0] });
});

app.put('/api/budget/:id', auth, async (req, res) => {
  const bid = Number(req.params.id);
  if (!Number.isInteger(bid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT bi.* FROM budget_items bi JOIN projects p ON p.id=bi.project_id WHERE bi.id=? AND p.user_id=?',
    [bid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const cur = rows[0]; const b = req.body || {};
  const num = (v, def, max = 1e12) => (v != null && v !== '') ? Math.max(0, Math.min(max, Number(v) || 0)) : def;
  const unit_price = num(b.unit_price, cur.unit_price);
  const quantity = num(b.quantity, cur.quantity, 1e6);
  const planned = num(b.planned, cur.planned);
  const actual = num(b.actual, cur.actual);
  const supplier_id = b.supplier_id !== undefined ? (b.supplier_id ? Number(b.supplier_id) : null) : cur.supplier_id;
  await pool.execute(
    'UPDATE budget_items SET category=?, description=?, unit_price=?, quantity=?, planned=?, actual=?, supplier_id=? WHERE id=?',
    [
      b.category !== undefined ? (trim(b.category, 120) || cur.category) : cur.category,
      b.description !== undefined ? (trim(b.description, 300) || cur.description) : cur.description,
      unit_price, quantity, planned, actual, supplier_id, bid,
    ]
  );
  res.json({ ok: true });
});

app.delete('/api/budget/:id', auth, async (req, res) => {
  const bid = Number(req.params.id);
  if (!Number.isInteger(bid)) return res.status(400).json({ error: 'id inválido' });
  const [rows] = await pool.execute(
    'SELECT bi.id FROM budget_items bi JOIN projects p ON p.id=bi.project_id WHERE bi.id=? AND p.user_id=?',
    [bid, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM budget_items WHERE id=?', [bid]);
  res.json({ ok: true });
});

// ---------- BRAND / PROFILE ----------
app.get('/api/brand', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT company_name, company_phone, company_email, brand_color FROM users WHERE id=?', [req.user.id]
  );
  res.json({ brand: rows[0] || {} });
});
app.put('/api/brand', auth, async (req, res) => {
  const b = req.body || {};
  const color = trim(b.brand_color, 16) || null;
  if (color && !/^#?[0-9a-fA-F]{3,8}$/.test(color)) return res.status(400).json({ error: 'cor inválida' });
  await pool.execute(
    'UPDATE users SET company_name=?, company_phone=?, company_email=?, brand_color=? WHERE id=?',
    [trim(b.company_name, 160), trim(b.company_phone, 60), trim(b.company_email, 190), color, req.user.id]
  );
  res.json({ ok: true });
});

// ---------- REPORTS ----------
// Returns full JSON snapshot for the browser to render into HTML/PDF
app.get('/api/projects/:pid/report', auth, async (req, res) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || !await ensureProjectOwn(req.user.id, pid)) return res.status(404).json({ error: 'not found' });
  const [pr] = await pool.execute('SELECT * FROM projects WHERE id=?', [pid]);
  const [tasks] = await pool.execute('SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, id', [pid]);
  const [budget] = await pool.execute('SELECT * FROM budget_items WHERE project_id=? ORDER BY sort_order, id', [pid]);
  const [guests] = await pool.execute('SELECT * FROM guests WHERE project_id=? ORDER BY name', [pid]);
  const [suppliers] = await pool.execute('SELECT * FROM suppliers WHERE user_id=? AND (project_id=? OR project_id IS NULL) ORDER BY name', [req.user.id, pid]);
  const [brand] = await pool.execute('SELECT name, email, company_name, company_phone, company_email, brand_color FROM users WHERE id=?', [req.user.id]);
  res.json({
    project: pr[0], tasks, budget, guests, suppliers,
    brand: brand[0] || {},
    generated_at: new Date().toISOString(),
  });
});

// ---------- HEALTH ----------
app.get('/health', async (req, res) => {
  try {
    await pool.execute('SELECT 1');
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
});

// ---------- UTIL ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Public RSVP page
app.get('/rsvp/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rsvp.html'));
});

// ---------- SPA fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- STARTUP ----------
(async () => {
  await migrate();
  app.listen(PORT, '0.0.0.0', () => console.log('listening on', PORT));
})();
