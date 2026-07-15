// Server for Planejamento Estratégico de Eventos
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod-' + Math.random().toString(36);

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const pool = mysql.createPool(url);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- MIGRATIONS ----------
async function migrate() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(120) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
}

// ---------- AUTH ----------
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password e nome são obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'senha deve ter no mínimo 6 caracteres' });
    const hash = await bcrypt.hash(password, 10);
    let result;
    try {
      [result] = await pool.execute('INSERT INTO users (email, password_hash, name) VALUES (?,?,?)', [email.toLowerCase(), hash, name]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'email já cadastrado' });
      throw e;
    }
    const user = { id: result.insertId, email: email.toLowerCase(), name };
    // Auto-seed a starter project with the template
    await seedDefaultProject(user.id);
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ user, token });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'erro ao registrar' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email e senha obrigatórios' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE email=?', [email.toLowerCase()]);
    if (!rows.length) return res.status(400).json({ error: 'credenciais inválidas' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(400).json({ error: 'credenciais inválidas' });
    const user = { id: u.id, email: u.email, name: u.name };
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    res.json({ user, token });
  } catch (e) {
    console.error(e); res.status(500).json({ error: 'erro no login' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ user: req.user });
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

// ---------- PROJECTS ----------
app.get('/api/projects', auth, async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM projects WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
  res.json({ projects: rows });
});

app.post('/api/projects', auth, async (req, res) => {
  const { name, event_date, start_date, location, audience, ticket_price, expected_revenue, seed } = req.body || {};
  if (!name) return res.status(400).json({ error: 'nome é obrigatório' });
  const [r] = await pool.execute(
    'INSERT INTO projects (user_id, name, event_date, start_date, location, audience, ticket_price, expected_revenue) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, name, event_date || null, start_date || null, location || null, audience || null, ticket_price || null, expected_revenue || null]
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
  const [rows] = await pool.execute('SELECT * FROM projects WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const [tasks] = await pool.execute('SELECT * FROM tasks WHERE project_id=? ORDER BY sort_order, id', [req.params.id]);
  res.json({ project: rows[0], tasks });
});

app.put('/api/projects/:id', auth, async (req, res) => {
  const { name, event_date, start_date, location, audience, ticket_price, expected_revenue } = req.body || {};
  const [check] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!check.length) return res.status(404).json({ error: 'not found' });
  await pool.execute(
    'UPDATE projects SET name=?, event_date=?, start_date=?, location=?, audience=?, ticket_price=?, expected_revenue=? WHERE id=?',
    [name, event_date || null, start_date || null, location || null, audience || null, ticket_price || null, expected_revenue || null, req.params.id]
  );
  res.json({ ok: true });
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  const [check] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!check.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM tasks WHERE project_id=?', [req.params.id]);
  await pool.execute('DELETE FROM projects WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ---------- TASKS ----------
async function ensureProject(userId, projectId) {
  const [rows] = await pool.execute('SELECT id FROM projects WHERE id=? AND user_id=?', [projectId, userId]);
  return rows.length > 0;
}

app.post('/api/projects/:pid/tasks', auth, async (req, res) => {
  if (!await ensureProject(req.user.id, req.params.pid)) return res.status(404).json({ error: 'not found' });
  const { phase, category, title, responsible, start_date, end_date } = req.body || {};
  if (!title) return res.status(400).json({ error: 'título obrigatório' });
  const [max] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 AS o FROM tasks WHERE project_id=?', [req.params.pid]);
  const [r] = await pool.execute(
    'INSERT INTO tasks (project_id, phase, category, title, responsible, start_date, end_date, sort_order) VALUES (?,?,?,?,?,?,?,?)',
    [req.params.pid, phase || 'PRÉ', category || 'Geral', title, responsible || null, start_date || null, end_date || null, max[0].o]
  );
  const [rows] = await pool.execute('SELECT * FROM tasks WHERE id=?', [r.insertId]);
  res.json({ task: rows[0] });
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const [rows] = await pool.execute(
    'SELECT t.* FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.user_id=?',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  const cur = rows[0];
  const b = req.body || {};
  const done = b.done !== undefined ? (b.done ? 1 : 0) : cur.done;
  await pool.execute(
    'UPDATE tasks SET phase=?, category=?, title=?, responsible=?, start_date=?, end_date=?, done=? WHERE id=?',
    [
      b.phase ?? cur.phase,
      b.category ?? cur.category,
      b.title ?? cur.title,
      b.responsible !== undefined ? b.responsible : cur.responsible,
      b.start_date !== undefined ? (b.start_date || null) : cur.start_date,
      b.end_date !== undefined ? (b.end_date || null) : cur.end_date,
      done,
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
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  await pool.execute('DELETE FROM tasks WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

(async () => {
  await migrate();
  app.listen(PORT, '0.0.0.0', () => console.log('listening on', PORT));
})();
