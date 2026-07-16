// ================= STATE =================
const state = {
  user: null,
  projects: [],
  currentProjectId: null,
  project: null,
  tasks: [],
  budget: [],
  suppliers: [],
  guests: [],
  brand: {},
  filters: { q: '', phase: '', status: '' },
  supFilters: { q: '', status: '' },
  guestFilters: { q: '', status: '' },
  charts: {},
};

// ================= UTILITIES =================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const money = (v) => {
  if (v == null || v === '') return 'Kz 0';
  return 'Kz ' + Number(v).toLocaleString('pt-AO', { maximumFractionDigits: 0 });
};
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('pt-AO'); };
const iso = (d) => { if (!d) return ''; const dt = (d instanceof Date) ? d : new Date(d); return dt.toISOString().slice(0,10); };
const todayISO = () => iso(new Date());
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// CSRF: read the csrf cookie set by server on any request
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : '';
}

async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCookie('csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  const res = await fetch(path, { ...opts, headers, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'erro');
  return data;
}

// Priming request to ensure csrf cookie exists before first POST
fetch('/api/auth/me', { credentials: 'include' }).catch(() => {});

// ================= AUTH =================
function showAuthForm(name) {
  ['login','register','forgot','reset'].forEach(k => {
    const el = document.getElementById(k + '-form');
    if (el) el.style.display = k === name ? 'flex' : 'none';
  });
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
}
$$('.tab').forEach(t => t.addEventListener('click', () => showAuthForm(t.dataset.tab)));
const forgotLink = document.getElementById('forgot-link');
if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('forgot'); });
const backLogin = document.getElementById('back-login');
if (backLogin) backLogin.addEventListener('click', (e) => { e.preventDefault(); showAuthForm('login'); });

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = $('#login-err'); err.textContent = '';
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.user = data.user;
    state.emailVerified = data.email_verified;
    await bootApp();
  } catch (e) { err.textContent = e.message; }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = $('#register-err'); err.textContent = '';
  try {
    const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.user = data.user;
    state.emailVerified = data.email_verified;
    await bootApp();
  } catch (e) { err.textContent = e.message; }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// Password reset flow
const forgotForm = document.getElementById('forgot-form');
if (forgotForm) forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('forgot-err'); err.textContent = '';
  const fd = new FormData(e.target);
  try {
    await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    err.style.color = 'var(--ok)';
    err.textContent = 'Se o e-mail existir, enviaremos um link de recuperação em instantes.';
  } catch (e) { err.style.color = ''; err.textContent = e.message; }
});

const resetForm = document.getElementById('reset-form');
if (resetForm) resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('reset-err'); err.textContent = '';
  const params = new URLSearchParams(location.search);
  const token = params.get('token');
  const fd = new FormData(e.target);
  try {
    await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, password: fd.get('password') }) });
    err.style.color = 'var(--ok)';
    err.textContent = 'Senha redefinida! Você já pode entrar.';
    setTimeout(() => { location.href = '/'; }, 1500);
  } catch (e) { err.style.color = ''; err.textContent = e.message; }
});

// Detect reset link and show reset form
(function handleResetLink() {
  const params = new URLSearchParams(location.search);
  if (params.get('token') && location.pathname.includes('redefinir-senha')) {
    showAuthForm('reset');
  }
  if (params.get('verified') === '1') {
    toast('E-mail verificado com sucesso!', 'ok');
  }
})();

// Resend verification
const resendLink = document.getElementById('resend-verify');
if (resendLink) resendLink.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/resend-verify', { method: 'POST' });
    toast('E-mail de verificação enviado', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});

// Export account data
const exportAccBtn = document.getElementById('export-account-btn');
if (exportAccBtn) exportAccBtn.addEventListener('click', () => {
  window.location.href = '/api/account/export';
});

// Delete account (LGPD)
const delAccBtn = document.getElementById('delete-account-btn');
if (delAccBtn) delAccBtn.addEventListener('click', async () => {
  const confirmText = prompt('Esta ação apagará TODOS os seus dados de forma permanente. Digite ELIMINAR para confirmar:');
  if (confirmText !== 'ELIMINAR') return;
  try {
    await api('/api/account', { method: 'DELETE' });
    alert('Conta eliminada. Obrigado por ter experimentado.');
    location.href = '/';
  } catch (e) { toast(e.message, 'err'); }
});

// ================= NAV =================
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
function setView(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'gantt') renderGantt();
  if (view === 'dashboard') renderDashboard();
  if (view === 'alerts') renderAlerts();
  if (view === 'budget') renderBudget();
  if (view === 'suppliers') renderSuppliers();
  if (view === 'guests') renderGuests();
  if (view === 'reports') renderReports();
}

// ================= BOOT =================
async function bootApp() {
  $('#auth-screen').style.display = 'none';
  $('#app-shell').style.display = 'grid';
  $('#user-name').textContent = state.user.name;
  const banner = document.getElementById('email-verify-banner');
  if (banner) banner.style.display = state.emailVerified === false ? 'block' : 'none';
  await loadProjects();
}

async function tryAutoLogin() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    state.emailVerified = data.email_verified;
    await bootApp();
  } catch { /* not logged in */ }
}

async function loadProjects() {
  const { projects } = await api('/api/projects');
  state.projects = projects;
  const sel = $('#project-select');
  sel.innerHTML = projects.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
  if (!projects.length) {
    // Should not happen because we seed on register, but handle anyway
    return;
  }
  if (!state.currentProjectId || !projects.find(p => p.id === state.currentProjectId)) {
    state.currentProjectId = projects[0].id;
  }
  sel.value = state.currentProjectId;
  await loadProject();
}

$('#project-select').addEventListener('change', async (e) => {
  state.currentProjectId = Number(e.target.value);
  await loadProject();
});

async function loadProject() {
  if (!state.currentProjectId) return;
  const pid = state.currentProjectId;
  const data = await api('/api/projects/' + pid);
  state.project = data.project;
  state.tasks = data.tasks;
  // Load auxiliary datasets in parallel (tolerate failure)
  const [b, s, g, brand] = await Promise.all([
    api('/api/projects/' + pid + '/budget').catch(() => ({ items: [] })),
    api('/api/suppliers?project_id=' + pid).catch(() => ({ suppliers: [] })),
    api('/api/projects/' + pid + '/guests').catch(() => ({ guests: [] })),
    api('/api/brand').catch(() => ({ brand: {} })),
  ]);
  state.budget = b.items || [];
  state.suppliers = s.suppliers || [];
  state.guests = g.guests || [];
  state.brand = brand.brand || {};
  renderAll();
}

// ================= RENDER =================
function renderAll() {
  renderDashboard();
  renderTasks();
  renderGantt();
  renderAlerts();
  renderSettings();
  renderAlertBadge();
  renderBudget();
  renderSuppliers();
  renderGuests();
  renderReports();
}

function taskStatus(t) {
  if (t.done) return 'done';
  const today = todayISO();
  if (t.end_date && t.end_date < today) return 'late';
  if (t.end_date && daysBetween(today, t.end_date) <= 7) return 'soon';
  if (!t.end_date && !t.start_date) return 'nodate';
  return 'pending';
}

function computeStats() {
  const phases = { 'PRÉ': { total: 0, done: 0 }, 'PRODUÇÃO': { total: 0, done: 0 }, 'PÓS': { total: 0, done: 0 } };
  const byCategory = {};
  const byResp = {};
  for (const t of state.tasks) {
    const p = phases[t.phase] || (phases[t.phase] = { total: 0, done: 0 });
    p.total++; if (t.done) p.done++;
    const cat = (t.phase + ' — ' + t.category);
    if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 };
    byCategory[cat].total++; if (t.done) byCategory[cat].done++;
    const r = t.responsible || 'Sem responsável';
    if (!byResp[r]) byResp[r] = { total: 0, done: 0 };
    byResp[r].total++; if (t.done) byResp[r].done++;
  }
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.done).length;
  return { total, done, phases, byCategory, byResp };
}

function renderDashboard() {
  if (!state.project) return;
  if (!$('#dash-project-name')) return;
  $('#dash-project-name').textContent = state.project.name;
  const meta = [];
  if (state.project.event_date) meta.push('Evento: ' + fmtDate(iso(state.project.event_date)));
  if (state.project.location) meta.push(state.project.location);
  $('#dash-project-meta').textContent = meta.join(' · ');

  const s = computeStats();
  const pct = (d, t) => t ? Math.round(d / t * 100) : 0;
  const overall = pct(s.done, s.total);
  $('#kpi-overall').textContent = overall + '%';
  $('#kpi-overall-bar').style.width = overall + '%';
  $('#kpi-pre').textContent = pct(s.phases['PRÉ'].done, s.phases['PRÉ'].total) + '%';
  $('#kpi-pre-bar').style.width = pct(s.phases['PRÉ'].done, s.phases['PRÉ'].total) + '%';
  $('#kpi-prod').textContent = pct(s.phases['PRODUÇÃO'].done, s.phases['PRODUÇÃO'].total) + '%';
  $('#kpi-prod-bar').style.width = pct(s.phases['PRODUÇÃO'].done, s.phases['PRODUÇÃO'].total) + '%';
  $('#kpi-pos').textContent = pct(s.phases['PÓS'].done, s.phases['PÓS'].total) + '%';
  $('#kpi-pos-bar').style.width = pct(s.phases['PÓS'].done, s.phases['PÓS'].total) + '%';

  // Financial
  $('#fin-revenue').textContent = money(state.project.expected_revenue);
  $('#fin-audience').textContent = (state.project.audience || 0).toLocaleString('pt-AO');
  $('#fin-ticket').textContent = money(state.project.ticket_price);
  $('#fin-date').textContent = state.project.event_date ? fmtDate(iso(state.project.event_date)) : '—';
  $('#fin-location').textContent = state.project.location || '—';
  if (state.project.event_date) {
    const d = daysBetween(todayISO(), iso(state.project.event_date));
    $('#fin-days').textContent = d < 0 ? Math.abs(d) + ' dias atrás' : d + ' dias';
  } else {
    $('#fin-days').textContent = '—';
  }

  // Donut
  const late = state.tasks.filter(t => !t.done && t.end_date && t.end_date < todayISO()).length;
  const done = s.done;
  const pending = s.total - done - late;
  drawDonut([done, pending, late], ['Concluídas', 'Pendentes', 'Atrasadas'], ['#10b981', '#6c8cff', '#ef4444']);

  // Bar chart categories
  const catEntries = Object.entries(s.byCategory).map(([k, v]) => ({ label: k, pct: pct(v.done, v.total), total: v.total }));
  catEntries.sort((a, b) => b.total - a.total);
  drawBar(catEntries.slice(0, 12));

  // Responsible chart
  const respEntries = Object.entries(s.byResp).map(([k, v]) => ({ label: k, total: v.total, done: v.done }));
  respEntries.sort((a, b) => b.total - a.total);
  drawResp(respEntries.slice(0, 8));

  // Dashboard alerts (compact)
  const alerts = getAlerts();
  const compact = [...alerts.late.slice(0, 3), ...alerts.soon.slice(0, 3)];
  $('#dash-alerts').innerHTML = compact.length ? compact.map(alertItemHTML).join('') : '<div class="empty">Tudo tranquilo por aqui 🎉</div>';
}

function drawDonut(data, labels, colors) {
  const ctx = $('#donut-chart').getContext('2d');
  if (state.charts.donut) state.charts.donut.destroy();
  state.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { color: '#99a2c9' } } },
    }
  });
}
function drawBar(entries) {
  const ctx = $('#bar-chart').getContext('2d');
  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(e => e.label),
      datasets: [{ label: '% Concluído', data: entries.map(e => e.pct), backgroundColor: 'rgba(108,140,255,0.75)', borderRadius: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: {
        x: { max: 100, ticks: { color: '#99a2c9', callback: v => v + '%' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#e7ebf8', font: { size: 11 } }, grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    }
  });
}
function drawResp(entries) {
  const ctx = $('#resp-chart').getContext('2d');
  if (state.charts.resp) state.charts.resp.destroy();
  state.charts.resp = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: entries.map(e => e.label),
      datasets: [
        { label: 'Concluídas', data: entries.map(e => e.done), backgroundColor: '#10b981' },
        { label: 'Pendentes', data: entries.map(e => e.total - e.done), backgroundColor: '#f59e0b' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { color: '#99a2c9' }, grid: { display: false } },
        y: { stacked: true, ticks: { color: '#99a2c9' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
      plugins: { legend: { labels: { color: '#99a2c9' } } },
    }
  });
}

// ================= TASKS =================
function renderTasks() {
  const container = $('#tasks-list');
  if (!container) return;
  const q = state.filters.q.toLowerCase();
  const filtered = state.tasks.filter(t => {
    if (state.filters.phase && t.phase !== state.filters.phase) return false;
    if (state.filters.status === 'pending' && t.done) return false;
    if (state.filters.status === 'done' && !t.done) return false;
    if (state.filters.status === 'late') {
      if (t.done || !t.end_date || t.end_date >= todayISO()) return false;
    }
    if (q) {
      const hay = (t.title + ' ' + (t.category || '') + ' ' + (t.responsible || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) { container.innerHTML = '<div class="empty">Nenhuma tarefa corresponde aos filtros.</div>'; return; }
  const groups = {};
  for (const t of filtered) {
    const key = t.phase + '||' + t.category;
    (groups[key] ||= []).push(t);
  }
  container.innerHTML = Object.entries(groups).map(([key, tasks]) => {
    const [phase, category] = key.split('||');
    const done = tasks.filter(t => t.done).length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    return `
      <div class="task-group">
        <div class="task-group-head" data-toggle>
          <h4>${escapeHTML(phase)} · ${escapeHTML(category)}</h4>
          <div class="meta">
            <span>${done}/${tasks.length}</span>
            <div class="progress" style="width:120px"><div class="progress-bar" style="width:${pct}%"></div></div>
          </div>
        </div>
        <div class="task-group-body">
          ${tasks.map(taskRowHTML).join('')}
        </div>
      </div>`;
  }).join('');

  // wire up
  $$('#tasks-list .task-row').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('input[type=checkbox]').addEventListener('change', (e) => toggleDone(id, e.target.checked));
    row.querySelector('.edit-btn').addEventListener('click', () => openTaskModal(id));
    row.querySelector('.del-btn').addEventListener('click', () => deleteTask(id));
  });
}

function taskRowHTML(t) {
  const status = taskStatus(t);
  const badge = status === 'done' ? 'Concluída' : status === 'late' ? 'Atrasada' : status === 'soon' ? 'Em breve' : status === 'nodate' ? 'Sem data' : 'Pendente';
  return `
    <div class="task-row ${status}" data-id="${t.id}">
      <div class="task-check"><input type="checkbox" ${t.done ? 'checked' : ''}/></div>
      <div class="task-title">${escapeHTML(t.title)}${t.category ? `<small>${escapeHTML(t.category)}</small>` : ''}</div>
      <div class="task-owner">${escapeHTML(t.responsible || '—')}</div>
      <div class="task-date">${t.start_date ? fmtDate(iso(t.start_date)) : '—'} → ${t.end_date ? fmtDate(iso(t.end_date)) : '—'}</div>
      <div><span class="task-status-badge">${badge}</span></div>
      <div class="task-actions">
        <button class="icon-btn edit-btn" title="Editar">✏️</button>
        <button class="icon-btn del-btn" title="Excluir">🗑️</button>
      </div>
    </div>`;
}

async function toggleDone(id, done) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = done ? 1 : 0;
  try {
    await api('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify({ done }) });
    renderAll();
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteTask(id) {
  if (!confirm('Excluir esta tarefa?')) return;
  try {
    await api('/api/tasks/' + id, { method: 'DELETE' });
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderAll();
    toast('Tarefa excluída');
  } catch (e) { toast(e.message, 'err'); }
}

$('#task-search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderTasks(); });
$('#filter-phase').addEventListener('change', (e) => { state.filters.phase = e.target.value; renderTasks(); });
$('#filter-status').addEventListener('change', (e) => { state.filters.status = e.target.value; renderTasks(); });

$('#add-task-btn').addEventListener('click', () => openTaskModal(null));

// ================= TASK MODAL =================
function openTaskModal(id) {
  const form = $('#task-form');
  form.reset();
  form.dataset.editing = id || '';
  $('#task-modal-title').textContent = id ? 'Editar tarefa' : 'Nova tarefa';
  if (id) {
    const t = state.tasks.find(x => x.id === id);
    form.title.value = t.title;
    form.phase.value = t.phase;
    form.category.value = t.category || '';
    form.responsible.value = t.responsible || '';
    form.start_date.value = t.start_date ? iso(t.start_date) : '';
    form.end_date.value = t.end_date ? iso(t.end_date) : '';
    form.done.checked = !!t.done;
  }
  $('#task-modal').style.display = 'flex';
}
$('#task-modal').addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) closeModals(); });
$('#project-modal').addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) closeModals(); });
function closeModals() { $('#task-modal').style.display = 'none'; $('#project-modal').style.display = 'none'; }

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.done = e.target.done.checked;
  const editing = e.target.dataset.editing;
  try {
    if (editing) {
      await api('/api/tasks/' + editing, { method: 'PUT', body: JSON.stringify(body) });
      toast('Tarefa atualizada');
    } else {
      await api('/api/projects/' + state.currentProjectId + '/tasks', { method: 'POST', body: JSON.stringify(body) });
      toast('Tarefa criada');
    }
    closeModals();
    await loadProject();
  } catch (e) { toast(e.message, 'err'); }
});

// ================= PROJECT SETTINGS =================
function renderSettings() {
  if (!state.project) return;
  const f = $('#project-form');
  if (!f) return;
  f.name.value = state.project.name || '';
  f.event_date.value = state.project.event_date ? iso(state.project.event_date) : '';
  f.start_date.value = state.project.start_date ? iso(state.project.start_date) : '';
  f.location.value = state.project.location || '';
  f.audience.value = state.project.audience || '';
  f.ticket_price.value = state.project.ticket_price || '';
  f.expected_revenue.value = state.project.expected_revenue || '';
}

$('#project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  try {
    await api('/api/projects/' + state.currentProjectId, { method: 'PUT', body: JSON.stringify(body) });
    toast('Projeto salvo');
    await loadProjects();
  } catch (e) { toast(e.message, 'err'); }
});

$('#delete-project-btn').addEventListener('click', async () => {
  if (!confirm('Excluir o projeto "' + state.project.name + '" e todas as tarefas?')) return;
  try {
    await api('/api/projects/' + state.currentProjectId, { method: 'DELETE' });
    state.currentProjectId = null;
    await loadProjects();
    if (!state.projects.length) {
      // create default again
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'Novo Evento', seed: true }) });
      await loadProjects();
    }
    toast('Projeto excluído');
  } catch (e) { toast(e.message, 'err'); }
});

$('#new-project-btn').addEventListener('click', () => {
  $('#new-project-form').reset();
  $('#new-project-form').seed.checked = true;
  $('#project-modal').style.display = 'flex';
});

$('#new-project-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  body.seed = e.target.seed.checked;
  try {
    const { project } = await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
    state.currentProjectId = project.id;
    closeModals();
    await loadProjects();
    toast('Projeto criado');
  } catch (e) { toast(e.message, 'err'); }
});

// ================= GANTT =================
function renderGantt() {
  const wrap = $('#gantt-wrap');
  if (!wrap) return;
  if (!state.tasks.length) { wrap.innerHTML = '<div class="empty">Sem tarefas ainda.</div>'; return; }
  // Determine date range from project.start_date or earliest task; event_date or latest
  const dated = state.tasks.filter(t => t.start_date || t.end_date);
  let minD = state.project.start_date ? new Date(state.project.start_date) : null;
  let maxD = state.project.event_date ? new Date(state.project.event_date) : null;
  for (const t of dated) {
    if (t.start_date) { const d = new Date(t.start_date); if (!minD || d < minD) minD = d; }
    if (t.end_date) { const d = new Date(t.end_date); if (!maxD || d > maxD) maxD = d; }
  }
  if (!minD) minD = new Date();
  if (!maxD) { maxD = new Date(minD); maxD.setDate(maxD.getDate() + 84); }
  // Snap start to Monday
  const dow = (minD.getDay() + 6) % 7; minD.setDate(minD.getDate() - dow); minD.setHours(0,0,0,0);
  // Snap end to Sunday
  const dow2 = (7 - maxD.getDay()) % 7; maxD.setDate(maxD.getDate() + dow2); maxD.setHours(0,0,0,0);
  const totalDays = Math.max(7, Math.round((maxD - minD) / 86400000) + 1);
  const weeks = Math.ceil(totalDays / 7);

  const headerWeeks = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(minD); d.setDate(d.getDate() + w * 7);
    headerWeeks.push(`<div class="gantt-week">${d.toLocaleDateString('pt-AO', { day: '2-digit', month: 'short' })}</div>`);
  }

  const rows = state.tasks.map(t => {
    const s = t.start_date ? new Date(t.start_date) : null;
    const e = t.end_date ? new Date(t.end_date) : (s ? new Date(s) : null);
    let bar = '';
    if (s && e) {
      const off = Math.max(0, Math.round((s - minD) / 86400000));
      const dur = Math.max(1, Math.round((e - s) / 86400000) + 1);
      const leftPct = (off / totalDays) * 100;
      const widthPct = (dur / totalDays) * 100;
      const cls = t.phase === 'PRÉ' ? 'pre' : t.phase === 'PRODUÇÃO' ? 'prod' : t.phase === 'PÓS' ? 'pos' : '';
      bar = `<div class="gantt-bar ${cls} ${t.done ? 'done' : ''}" style="left:${leftPct}%; width:${widthPct}%" title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</div>`;
    }
    return `
      <div class="gantt-row">
        <div class="gantt-label">${escapeHTML(t.title)}<small>${escapeHTML(t.phase)} · ${escapeHTML(t.category || '')}</small></div>
        <div class="gantt-track" style="grid-template-columns: repeat(${weeks}, 1fr)">
          ${Array.from({ length: weeks }, () => '<div class="gantt-cell"></div>').join('')}
          ${bar}
        </div>
      </div>`;
  }).join('');

  const today = new Date(); today.setHours(0,0,0,0);
  let todayLine = '';
  if (today >= minD && today <= maxD) {
    const off = (today - minD) / 86400000;
    const leftPct = (off / totalDays) * 100;
    todayLine = `<div class="gantt-today" style="left:calc(280px + ${leftPct}% * (100% - 280px) / 100%)"></div>`;
  }

  wrap.innerHTML = `
    <div class="gantt-table">
      <div class="gantt-header">
        <div class="gantt-title-col">Tarefa</div>
        <div class="gantt-weeks" style="grid-template-columns: repeat(${weeks}, 1fr)">${headerWeeks.join('')}</div>
      </div>
      ${rows}
    </div>
  `;
}

// ================= ALERTS =================
function getAlerts() {
  const today = todayISO();
  const late = [], soon = [], nodate = [], noowner = [];
  for (const t of state.tasks) {
    if (t.done) continue;
    if (t.end_date && t.end_date < today) late.push(t);
    else if (t.end_date && daysBetween(today, t.end_date) <= 7) soon.push(t);
    if (!t.end_date && !t.start_date) nodate.push(t);
    if (!t.responsible) noowner.push(t);
  }
  late.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
  soon.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
  return { late, soon, nodate, noowner };
}

function alertItemHTML(t) {
  const today = todayISO();
  let cls = 'info', meta = '';
  if (t.end_date && t.end_date < today) { cls = 'late'; meta = 'Atrasada há ' + Math.abs(daysBetween(today, t.end_date)) + ' dias'; }
  else if (t.end_date) { cls = 'soon'; meta = 'Vence em ' + daysBetween(today, t.end_date) + ' dias (' + fmtDate(iso(t.end_date)) + ')'; }
  else if (!t.responsible) { meta = 'Sem responsável'; }
  else { meta = 'Sem data definida'; }
  return `<div class="alert-item ${cls}">
    <div class="alert-dot"></div>
    <div class="alert-title">${escapeHTML(t.title)}<small>${escapeHTML(t.phase)} · ${escapeHTML(t.category || '')}${t.responsible ? ' · ' + escapeHTML(t.responsible) : ''}</small></div>
    <div class="alert-meta">${meta}</div>
  </div>`;
}

function renderAlerts() {
  if (!$('#alerts-late')) return;
  const a = getAlerts();
  const render = (arr, elId, empty) => {
    const el = $(elId); if (!el) return;
    el.innerHTML = arr.length ? arr.map(alertItemHTML).join('') : `<div class="empty">${empty}</div>`;
  };
  render(a.late, '#alerts-late', 'Nenhuma tarefa atrasada 🎉');
  render(a.soon, '#alerts-soon', 'Nenhuma tarefa nos próximos 7 dias');
  render(a.nodate, '#alerts-nodate', 'Todas as tarefas têm data');
  render(a.noowner, '#alerts-noowner', 'Todas as tarefas têm responsável');
}

function renderAlertBadge() {
  const el = $('#alerts-badge');
  if (!el) return;
  const a = getAlerts();
  const count = a.late.length + a.soon.length;
  el.textContent = count || '';
  el.classList.toggle('show', count > 0);
}

// ================= UTILS =================
function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// ================= BUDGET =================
function budgetTotals() {
  let planned = 0, actual = 0;
  const byCat = {};
  for (const it of state.budget) {
    const p = Number(it.planned) || 0;
    const a = Number(it.actual) || 0;
    planned += p; actual += a;
    if (!byCat[it.category]) byCat[it.category] = { planned: 0, actual: 0 };
    byCat[it.category].planned += p;
    byCat[it.category].actual += a;
  }
  return { planned, actual, byCat };
}

function renderBudget() {
  const tbody = document.querySelector('#budget-table tbody');
  if (!tbody) return;
  const t = budgetTotals();
  document.getElementById('bkpi-planned').textContent = money(t.planned);
  document.getElementById('bkpi-actual').textContent = money(t.actual);
  const diff = t.actual - t.planned;
  const el = document.getElementById('bkpi-diff');
  el.textContent = (diff >= 0 ? '+ ' : '- ') + money(Math.abs(diff));
  el.style.color = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : '';
  const ratio = t.planned > 0 ? Math.round((t.actual / t.planned) * 100) : 0;
  document.getElementById('bkpi-ratio').textContent = ratio + '%';
  document.getElementById('bkpi-ratio-bar').style.width = Math.min(100, ratio) + '%';

  // Break-even
  const revenue = Number(state.project?.expected_revenue) || 0;
  const ticket = Number(state.project?.ticket_price) || 0;
  document.getElementById('be-revenue').textContent = money(revenue);
  document.getElementById('be-planned').textContent = money(t.planned);
  document.getElementById('be-profit').textContent = money(revenue - t.planned);
  document.getElementById('be-people').textContent = ticket > 0 ? Math.ceil(t.planned / ticket).toLocaleString('pt-AO') : '—';

  // Chart
  const cats = Object.entries(t.byCat);
  const ctx = document.getElementById('budget-chart').getContext('2d');
  if (state.charts.budget) state.charts.budget.destroy();
  state.charts.budget = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: cats.map(c => c[0]),
      datasets: [
        { label: 'Previsto', data: cats.map(c => c[1].planned), backgroundColor: 'rgba(108,140,255,0.7)' },
        { label: 'Real', data: cats.map(c => c[1].actual), backgroundColor: 'rgba(239,68,68,0.7)' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#99a2c9' }, grid: { display: false } },
        y: { ticks: { color: '#99a2c9', callback: v => 'Kz ' + Number(v).toLocaleString('pt-AO') }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
      plugins: { legend: { labels: { color: '#99a2c9' } } },
    }
  });

  // Table
  if (!state.budget.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty" style="padding:22px;text-align:center;color:var(--muted)">Nenhum item de orçamento ainda. Clique em "+ Novo item".</td></tr>'; return; }
  tbody.innerHTML = state.budget.map(it => {
    const p = Number(it.planned) || 0, a = Number(it.actual) || 0;
    const d = a - p;
    const dCls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'eq';
    const sup = state.suppliers.find(s => s.id === it.supplier_id);
    return `
      <tr data-id="${it.id}">
        <td>${escapeHTML(it.category)}</td>
        <td>${escapeHTML(it.description)}</td>
        <td>${sup ? escapeHTML(sup.name) : '<span style="color:var(--muted)">—</span>'}</td>
        <td class="num">${money(it.unit_price)}</td>
        <td class="num">${Number(it.quantity).toLocaleString('pt-AO')}</td>
        <td class="num">${money(p)}</td>
        <td class="num"><input type="number" step="0.01" min="0" value="${a}" data-actual="${it.id}" style="width:100px" /></td>
        <td class="num delta ${dCls}">${d >= 0 ? '+' : '-'} ${money(Math.abs(d))}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit-b="${it.id}" title="Editar">✏️</button>
          <button class="icon-btn" data-del-b="${it.id}" title="Excluir">🗑️</button>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('input[data-actual]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const id = Number(inp.getAttribute('data-actual'));
      try { await api('/api/budget/' + id, { method: 'PUT', body: JSON.stringify({ actual: Number(inp.value) || 0 }) });
        const it = state.budget.find(x => x.id === id); if (it) it.actual = Number(inp.value) || 0;
        renderBudget();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
  tbody.querySelectorAll('[data-edit-b]').forEach(b => b.addEventListener('click', () => openBudgetModal(Number(b.getAttribute('data-edit-b')))));
  tbody.querySelectorAll('[data-del-b]').forEach(b => b.addEventListener('click', () => deleteBudget(Number(b.getAttribute('data-del-b')))));
}

async function deleteBudget(id) {
  if (!confirm('Excluir este item?')) return;
  try {
    await api('/api/budget/' + id, { method: 'DELETE' });
    state.budget = state.budget.filter(x => x.id !== id);
    renderBudget();
    toast('Item excluído');
  } catch (e) { toast(e.message, 'err'); }
}

function openBudgetModal(id) {
  const modal = document.getElementById('budget-modal');
  const form = document.getElementById('budget-form');
  form.reset();
  form.dataset.editing = id || '';
  document.getElementById('budget-modal-title').textContent = id ? 'Editar item' : 'Novo item de orçamento';
  const supSel = form.supplier_id;
  supSel.innerHTML = '<option value="">—</option>' + state.suppliers.map(s => `<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
  if (id) {
    const it = state.budget.find(x => x.id === id);
    if (it) {
      form.category.value = it.category || 'Outros';
      form.description.value = it.description || '';
      form.unit_price.value = it.unit_price || 0;
      form.quantity.value = it.quantity || 1;
      form.planned.value = it.planned || '';
      form.actual.value = it.actual || 0;
      if (it.supplier_id) form.supplier_id.value = it.supplier_id;
    }
  }
  modal.style.display = 'flex';
}
document.getElementById('add-budget-btn')?.addEventListener('click', () => openBudgetModal(null));
document.getElementById('budget-modal')?.addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) e.currentTarget.style.display = 'none'; });
document.getElementById('budget-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  const editing = e.target.dataset.editing;
  try {
    if (editing) {
      await api('/api/budget/' + editing, { method: 'PUT', body: JSON.stringify(body) });
      toast('Item atualizado');
    } else {
      await api('/api/projects/' + state.currentProjectId + '/budget', { method: 'POST', body: JSON.stringify(body) });
      toast('Item adicionado');
    }
    document.getElementById('budget-modal').style.display = 'none';
    const { items } = await api('/api/projects/' + state.currentProjectId + '/budget');
    state.budget = items; renderBudget();
  } catch (err) { toast(err.message, 'err'); }
});

// ================= SUPPLIERS =================
function renderSuppliers() {
  const tbody = document.querySelector('#sup-table tbody');
  if (!tbody) return;
  const q = state.supFilters.q.toLowerCase();
  const st = state.supFilters.status;
  const filtered = state.suppliers.filter(s => {
    if (st && s.status !== st) return false;
    if (q) {
      const hay = (s.name + ' ' + (s.category || '') + ' ' + (s.contact_name || '') + ' ' + (s.city || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="8" style="padding:22px;text-align:center;color:var(--muted)">Nenhum fornecedor. Clique em "+ Novo fornecedor".</td></tr>'; return; }
  tbody.innerHTML = filtered.map(s => `
    <tr data-id="${s.id}">
      <td><strong>${escapeHTML(s.name)}</strong></td>
      <td>${escapeHTML(s.category || '—')}</td>
      <td>${escapeHTML(s.contact_name || '—')}</td>
      <td>${s.email ? escapeHTML(s.email) : ''}${s.email && s.phone ? '<br>' : ''}${s.phone ? escapeHTML(s.phone) : ''}${!s.email && !s.phone ? '—' : ''}</td>
      <td>${escapeHTML(s.city || '—')}</td>
      <td>${s.rating != null ? '★'.repeat(s.rating) + '☆'.repeat(5 - s.rating) : '—'}</td>
      <td><span class="pill ${s.status}">${escapeHTML(s.status || 'novo')}</span></td>
      <td class="row-actions">
        <button class="icon-btn" data-edit-s="${s.id}" title="Editar">✏️</button>
        <button class="icon-btn" data-del-s="${s.id}" title="Excluir">🗑️</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-edit-s]').forEach(b => b.addEventListener('click', () => openSupModal(Number(b.getAttribute('data-edit-s')))));
  tbody.querySelectorAll('[data-del-s]').forEach(b => b.addEventListener('click', () => deleteSupplier(Number(b.getAttribute('data-del-s')))));
}

async function deleteSupplier(id) {
  if (!confirm('Excluir este fornecedor?')) return;
  try {
    await api('/api/suppliers/' + id, { method: 'DELETE' });
    state.suppliers = state.suppliers.filter(x => x.id !== id);
    renderSuppliers(); renderBudget();
    toast('Fornecedor excluído');
  } catch (e) { toast(e.message, 'err'); }
}

function openSupModal(id) {
  const form = document.getElementById('sup-form');
  form.reset();
  form.dataset.editing = id || '';
  document.getElementById('sup-modal-title').textContent = id ? 'Editar fornecedor' : 'Novo fornecedor';
  form.project_id.innerHTML = '<option value="">Todos os projetos</option>' + state.projects.map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
  if (id) {
    const s = state.suppliers.find(x => x.id === id);
    if (s) {
      form.name.value = s.name || '';
      form.category.value = s.category || '';
      form.status.value = s.status || 'novo';
      form.contact_name.value = s.contact_name || '';
      form.city.value = s.city || '';
      form.email.value = s.email || '';
      form.phone.value = s.phone || '';
      form.rating.value = s.rating != null ? s.rating : '';
      form.project_id.value = s.project_id || '';
      form.notes.value = s.notes || '';
    }
  } else {
    form.project_id.value = state.currentProjectId || '';
  }
  document.getElementById('sup-modal').style.display = 'flex';
}
document.getElementById('add-sup-btn')?.addEventListener('click', () => openSupModal(null));
document.getElementById('sup-modal')?.addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) e.currentTarget.style.display = 'none'; });
document.getElementById('sup-search')?.addEventListener('input', e => { state.supFilters.q = e.target.value; renderSuppliers(); });
document.getElementById('sup-filter-status')?.addEventListener('change', e => { state.supFilters.status = e.target.value; renderSuppliers(); });
document.getElementById('sup-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  const editing = e.target.dataset.editing;
  try {
    if (editing) { await api('/api/suppliers/' + editing, { method: 'PUT', body: JSON.stringify(body) }); toast('Fornecedor atualizado'); }
    else { await api('/api/suppliers', { method: 'POST', body: JSON.stringify(body) }); toast('Fornecedor criado'); }
    document.getElementById('sup-modal').style.display = 'none';
    const r = await api('/api/suppliers?project_id=' + state.currentProjectId);
    state.suppliers = r.suppliers; renderSuppliers(); renderBudget();
  } catch (err) { toast(err.message, 'err'); }
});

// ================= GUESTS =================
function renderGuests() {
  const tbody = document.querySelector('#guests-table tbody');
  if (!tbody) return;
  const total = state.guests.length;
  const conf = state.guests.filter(g => g.rsvp_status === 'confirmado').reduce((n, g) => n + 1 + (g.companions || 0), 0);
  const pend = state.guests.filter(g => g.rsvp_status === 'pendente').length;
  const rec = state.guests.filter(g => g.rsvp_status === 'recusado').length;
  document.getElementById('gkpi-total').textContent = total;
  document.getElementById('gkpi-conf').textContent = conf;
  document.getElementById('gkpi-pend').textContent = pend;
  document.getElementById('gkpi-rec').textContent = rec;
  const q = state.guestFilters.q.toLowerCase();
  const st = state.guestFilters.status;
  const filtered = state.guests.filter(g => {
    if (st && g.rsvp_status !== st) return false;
    if (q) {
      const hay = (g.name + ' ' + (g.email || '') + ' ' + (g.category || '') + ' ' + (g.table_no || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7" style="padding:22px;text-align:center;color:var(--muted)">Nenhum convidado ainda.</td></tr>'; return; }
  tbody.innerHTML = filtered.map(g => `
    <tr data-id="${g.id}">
      <td><strong>${escapeHTML(g.name)}</strong></td>
      <td>${escapeHTML(g.category || '—')}</td>
      <td>${g.email ? escapeHTML(g.email) : ''}${g.email && g.phone ? '<br>' : ''}${g.phone ? escapeHTML(g.phone) : ''}${!g.email && !g.phone ? '—' : ''}</td>
      <td>${escapeHTML(g.table_no || '—')}</td>
      <td class="num">${g.companions || 0}</td>
      <td>
        <select data-rsvp="${g.id}">
          <option value="pendente" ${g.rsvp_status === 'pendente' ? 'selected' : ''}>Pendente</option>
          <option value="confirmado" ${g.rsvp_status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
          <option value="recusado" ${g.rsvp_status === 'recusado' ? 'selected' : ''}>Recusado</option>
        </select>
      </td>
      <td class="row-actions">
        <button class="icon-btn" data-edit-g="${g.id}" title="Editar">✏️</button>
        <button class="icon-btn" data-del-g="${g.id}" title="Excluir">🗑️</button>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('select[data-rsvp]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = Number(sel.getAttribute('data-rsvp'));
      try { await api('/api/guests/' + id, { method: 'PUT', body: JSON.stringify({ rsvp_status: sel.value }) });
        const g = state.guests.find(x => x.id === id); if (g) g.rsvp_status = sel.value;
        renderGuests();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
  tbody.querySelectorAll('[data-edit-g]').forEach(b => b.addEventListener('click', () => openGuestModal(Number(b.getAttribute('data-edit-g')))));
  tbody.querySelectorAll('[data-del-g]').forEach(b => b.addEventListener('click', () => deleteGuest(Number(b.getAttribute('data-del-g')))));
}

async function deleteGuest(id) {
  if (!confirm('Remover este convidado?')) return;
  try {
    await api('/api/guests/' + id, { method: 'DELETE' });
    state.guests = state.guests.filter(x => x.id !== id);
    renderGuests();
    toast('Convidado removido');
  } catch (e) { toast(e.message, 'err'); }
}

function openGuestModal(id) {
  const form = document.getElementById('guest-form');
  form.reset();
  form.dataset.editing = id || '';
  document.getElementById('guest-modal-title').textContent = id ? 'Editar convidado' : 'Novo convidado';
  if (id) {
    const g = state.guests.find(x => x.id === id);
    if (g) {
      form.name.value = g.name || '';
      form.email.value = g.email || '';
      form.phone.value = g.phone || '';
      form.category.value = g.category || '';
      form.table_no.value = g.table_no || '';
      form.companions.value = g.companions || 0;
      form.rsvp_status.value = g.rsvp_status || 'pendente';
      form.notes.value = g.notes || '';
    }
  }
  document.getElementById('guest-modal').style.display = 'flex';
}
document.getElementById('add-guest-btn')?.addEventListener('click', () => openGuestModal(null));
document.getElementById('guest-modal')?.addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) e.currentTarget.style.display = 'none'; });
document.getElementById('guest-search')?.addEventListener('input', e => { state.guestFilters.q = e.target.value; renderGuests(); });
document.getElementById('guest-filter-status')?.addEventListener('change', e => { state.guestFilters.status = e.target.value; renderGuests(); });
document.getElementById('guest-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd);
  const editing = e.target.dataset.editing;
  try {
    if (editing) { await api('/api/guests/' + editing, { method: 'PUT', body: JSON.stringify(body) }); toast('Convidado atualizado'); }
    else { await api('/api/projects/' + state.currentProjectId + '/guests', { method: 'POST', body: JSON.stringify(body) }); toast('Convidado adicionado'); }
    document.getElementById('guest-modal').style.display = 'none';
    const r = await api('/api/projects/' + state.currentProjectId + '/guests');
    state.guests = r.guests; renderGuests();
  } catch (err) { toast(err.message, 'err'); }
});

// RSVP public link
document.getElementById('rsvp-link-btn')?.addEventListener('click', async () => {
  try {
    const r = await api('/api/projects/' + state.currentProjectId + '/rsvp-link');
    document.getElementById('rsvp-link-input').value = r.url;
    document.getElementById('rsvp-link-modal').style.display = 'flex';
  } catch (e) { toast(e.message, 'err'); }
});
document.getElementById('rsvp-link-modal')?.addEventListener('click', (e) => { if (e.target.classList.contains('modal') || e.target.classList.contains('modal-close')) e.currentTarget.style.display = 'none'; });
document.getElementById('rsvp-copy-btn')?.addEventListener('click', () => {
  const inp = document.getElementById('rsvp-link-input');
  inp.select(); document.execCommand('copy');
  toast('Link copiado');
});

// ================= REPORTS =================
function renderReports() {
  const f = document.getElementById('brand-form');
  if (!f) return;
  f.company_name.value = state.brand.company_name || (state.user?.name || '');
  f.company_email.value = state.brand.company_email || (state.user?.email || '');
  f.company_phone.value = state.brand.company_phone || '';
  f.brand_color.value = state.brand.brand_color || '#6c8cff';
}
document.getElementById('brand-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/brand', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fd)) });
    const r = await api('/api/brand'); state.brand = r.brand;
    toast('Identidade salva');
  } catch (err) { toast(err.message, 'err'); }
});

document.querySelectorAll('[data-report]').forEach(btn => {
  btn.addEventListener('click', () => {
    const kind = btn.getAttribute('data-report');
    if (kind === 'client') generatePDF('client');
    else if (kind === 'manager') generatePDF('manager');
    else if (kind === 'preview-client') previewReport('client');
    else if (kind === 'preview-manager') previewReport('manager');
  });
});
document.getElementById('close-preview')?.addEventListener('click', () => {
  document.getElementById('report-preview').style.display = 'none';
});

function reportStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const phases = { 'PRÉ': { total: 0, done: 0 }, 'PRODUÇÃO': { total: 0, done: 0 }, 'PÓS': { total: 0, done: 0 } };
  for (const t of state.tasks) {
    if (!phases[t.phase]) phases[t.phase] = { total: 0, done: 0 };
    phases[t.phase].total++; if (t.done) phases[t.phase].done++;
  }
  const b = budgetTotals();
  const guests = {
    total: state.guests.length,
    conf: state.guests.filter(g => g.rsvp_status === 'confirmado').reduce((n, g) => n + 1 + (g.companions || 0), 0),
    pend: state.guests.filter(g => g.rsvp_status === 'pendente').length,
    rec: state.guests.filter(g => g.rsvp_status === 'recusado').length,
  };
  return { total, done, pct, phases, budget: b, guests };
}

function previewReport(kind) {
  const el = document.getElementById('report-preview');
  const body = document.getElementById('report-preview-body');
  const s = reportStats();
  const p = state.project;
  const br = state.brand || {};
  const color = br.brand_color || '#6c8cff';
  const brandName = br.company_name || state.user?.name || 'Sua Empresa';
  const initials = brandName.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const kindLabel = kind === 'client' ? 'Relatório Executivo (Cliente)' : 'Backup Completo (Gestor)';
  let html = `<div class="report-preview" style="--rp-color:${color}">
    <div class="brand-bar">
      <div class="brand-mark" style="background:${color}">${escapeHTML(initials)}</div>
      <div><div class="brand-name">${escapeHTML(brandName)}</div>
      <div class="brand-sub">${escapeHTML(br.company_email || '')} ${br.company_phone ? '· ' + escapeHTML(br.company_phone) : ''}</div></div>
    </div>
    <h1 style="color:${color}">${escapeHTML(p.name)}</h1>
    <p><strong>${kindLabel}</strong> · Emitido a ${new Date().toLocaleDateString('pt-AO')}</p>
    <table>
      <tr><th>Data do evento</th><td>${p.event_date ? fmtDate(iso(p.event_date)) : '—'}</td>
      <th>Local</th><td>${escapeHTML(p.location || '—')}</td></tr>
      <tr><th>Público estimado</th><td>${p.audience || 0}</td>
      <th>Ticket médio</th><td>${money(p.ticket_price)}</td></tr>
      <tr><th>Receita esperada</th><td>${money(p.expected_revenue)}</td>
      <th>Progresso</th><td>${s.pct}% (${s.done}/${s.total} tarefas)</td></tr>
    </table>

    <h2>Progresso por fase</h2>
    <table>
      <tr><th>Fase</th><th>Concluídas</th><th>Total</th><th>%</th></tr>
      ${Object.entries(s.phases).map(([k, v]) => `<tr><td>${k}</td><td>${v.done}</td><td>${v.total}</td><td>${v.total ? Math.round(v.done / v.total * 100) : 0}%</td></tr>`).join('')}
    </table>

    <h2>Orçamento previsto vs real</h2>
    <table>
      <tr><th>Total previsto</th><td>${money(s.budget.planned)}</td>
      <th>Total realizado</th><td>${money(s.budget.actual)}</td>
      <th>Diferença</th><td>${money(s.budget.actual - s.budget.planned)}</td></tr>
    </table>
    <table>
      <tr><th>Categoria</th><th>Previsto</th><th>Real</th><th>Δ</th></tr>
      ${Object.entries(s.budget.byCat).map(([k, v]) => `<tr><td>${escapeHTML(k)}</td><td>${money(v.planned)}</td><td>${money(v.actual)}</td><td>${money(v.actual - v.planned)}</td></tr>`).join('') || '<tr><td colspan="4">Sem itens de orçamento.</td></tr>'}
    </table>

    <h2>Convidados</h2>
    <table>
      <tr><th>Total</th><td>${s.guests.total}</td>
      <th>Confirmados (c/ acompanhantes)</th><td>${s.guests.conf}</td>
      <th>Pendentes</th><td>${s.guests.pend}</td>
      <th>Recusados</th><td>${s.guests.rec}</td></tr>
    </table>`;

  if (kind === 'manager') {
    html += `<h2>Detalhe de itens de orçamento</h2>
      <table><tr><th>Categoria</th><th>Descrição</th><th>Un.</th><th>Qt.</th><th>Previsto</th><th>Real</th></tr>
      ${state.budget.map(it => `<tr><td>${escapeHTML(it.category)}</td><td>${escapeHTML(it.description)}</td><td>${money(it.unit_price)}</td><td>${Number(it.quantity)}</td><td>${money(it.planned)}</td><td>${money(it.actual)}</td></tr>`).join('') || '<tr><td colspan="6">—</td></tr>'}
      </table>
      <h2>Lista completa de convidados</h2>
      <table><tr><th>Nome</th><th>Categoria</th><th>Contacto</th><th>Mesa</th><th>+</th><th>Estado</th></tr>
      ${state.guests.map(g => `<tr><td>${escapeHTML(g.name)}</td><td>${escapeHTML(g.category || '')}</td><td>${escapeHTML(g.email || g.phone || '')}</td><td>${escapeHTML(g.table_no || '')}</td><td>${g.companions || 0}</td><td>${escapeHTML(g.rsvp_status)}</td></tr>`).join('') || '<tr><td colspan="6">—</td></tr>'}
      </table>
      <h2>Fornecedores</h2>
      <table><tr><th>Nome</th><th>Categoria</th><th>Contacto</th><th>Estado</th></tr>
      ${state.suppliers.map(sp => `<tr><td>${escapeHTML(sp.name)}</td><td>${escapeHTML(sp.category || '')}</td><td>${escapeHTML(sp.contact_name || '')} ${sp.phone ? '· ' + escapeHTML(sp.phone) : ''}</td><td>${escapeHTML(sp.status)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>'}
      </table>
      <h2>Tarefas</h2>
      <table><tr><th>Fase</th><th>Categoria</th><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Estado</th></tr>
      ${state.tasks.map(t => `<tr><td>${escapeHTML(t.phase)}</td><td>${escapeHTML(t.category || '')}</td><td>${escapeHTML(t.title)}</td><td>${escapeHTML(t.responsible || '')}</td><td>${t.end_date ? fmtDate(iso(t.end_date)) : ''}</td><td>${t.done ? 'Concluída' : 'Pendente'}</td></tr>`).join('')}
      </table>`;
  }

  html += `<p style="margin-top:20px;color:#777;font-size:11px">Documento gerado por ${escapeHTML(brandName)} · Planejamento Estratégico de Eventos</p></div>`;
  body.innerHTML = html;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth' });
}

function generatePDF(kind) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const s = reportStats();
  const p = state.project;
  const br = state.brand || {};
  const color = br.brand_color || '#6c8cff';
  const [r, g, bl] = hexToRgb(color);
  const brandName = br.company_name || state.user?.name || 'Sua Empresa';
  const kindLabel = kind === 'client' ? 'Relatório Executivo' : 'Backup Completo (Gestor)';

  // Header
  doc.setFillColor(r, g, bl);
  doc.rect(0, 0, 210, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text(brandName, 14, 14);
  doc.setFontSize(10); doc.setFont(undefined, 'normal');
  doc.text([br.company_email || '', br.company_phone || ''].filter(Boolean).join(' · '), 14, 19);

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(18); doc.setFont(undefined, 'bold');
  doc.text(p.name, 14, 34);
  doc.setFontSize(11); doc.setFont(undefined, 'normal');
  doc.setTextColor(90, 90, 90);
  doc.text(kindLabel + ' · Emitido em ' + new Date().toLocaleDateString('pt-AO'), 14, 40);

  doc.autoTable({
    startY: 46,
    theme: 'grid',
    headStyles: { fillColor: [245, 245, 247], textColor: 40 },
    styles: { fontSize: 9 },
    body: [
      ['Data do evento', p.event_date ? fmtDate(iso(p.event_date)) : '—', 'Local', p.location || '—'],
      ['Público estimado', String(p.audience || 0), 'Ticket médio', money(p.ticket_price)],
      ['Receita esperada', money(p.expected_revenue), 'Progresso', `${s.pct}% (${s.done}/${s.total})`],
    ],
  });

  doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.setTextColor(30, 30, 30);
  doc.text('Progresso por fase', 14, doc.lastAutoTable.finalY + 8);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 11,
    head: [['Fase', 'Concluídas', 'Total', '%']],
    body: Object.entries(s.phases).map(([k, v]) => [k, v.done, v.total, v.total ? Math.round(v.done / v.total * 100) + '%' : '0%']),
    headStyles: { fillColor: [r, g, bl] },
    styles: { fontSize: 9 },
  });

  doc.setFont(undefined, 'bold'); doc.setFontSize(12);
  doc.text('Orçamento previsto vs real', 14, doc.lastAutoTable.finalY + 8);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 11,
    head: [['Categoria', 'Previsto', 'Real', 'Diferença']],
    body: Object.entries(s.budget.byCat).map(([k, v]) => [k, money(v.planned), money(v.actual), money(v.actual - v.planned)]).concat([
      [{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, { content: money(s.budget.planned), styles: { fontStyle: 'bold' } }, { content: money(s.budget.actual), styles: { fontStyle: 'bold' } }, { content: money(s.budget.actual - s.budget.planned), styles: { fontStyle: 'bold' } }],
    ]),
    headStyles: { fillColor: [r, g, bl] },
    styles: { fontSize: 9 },
  });

  doc.setFont(undefined, 'bold'); doc.setFontSize(12);
  doc.text('Convidados', 14, doc.lastAutoTable.finalY + 8);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 11,
    head: [['Total', 'Confirmados (c/ acomp.)', 'Pendentes', 'Recusados']],
    body: [[s.guests.total, s.guests.conf, s.guests.pend, s.guests.rec]],
    headStyles: { fillColor: [r, g, bl] },
    styles: { fontSize: 9 },
  });

  if (kind === 'manager') {
    doc.addPage();
    doc.setFont(undefined, 'bold'); doc.setFontSize(14); doc.setTextColor(30, 30, 30);
    doc.text('Detalhe do orçamento', 14, 20);
    doc.autoTable({
      startY: 24,
      head: [['Categoria', 'Descrição', 'Un.', 'Qt.', 'Previsto', 'Real']],
      body: state.budget.map(it => [it.category, it.description, money(it.unit_price), Number(it.quantity), money(it.planned), money(it.actual)]),
      headStyles: { fillColor: [r, g, bl] }, styles: { fontSize: 8 },
    });
    doc.setFont(undefined, 'bold'); doc.setFontSize(14);
    doc.text('Lista de convidados', 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      head: [['Nome', 'Categoria', 'Contacto', 'Mesa', '+', 'Estado']],
      body: state.guests.map(gu => [gu.name, gu.category || '', gu.email || gu.phone || '', gu.table_no || '', gu.companions || 0, gu.rsvp_status]),
      headStyles: { fillColor: [r, g, bl] }, styles: { fontSize: 8 },
    });
    doc.setFont(undefined, 'bold'); doc.setFontSize(14);
    doc.text('Fornecedores', 14, doc.lastAutoTable.finalY + 10);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14,
      head: [['Nome', 'Categoria', 'Contacto', 'Telefone', 'Estado']],
      body: state.suppliers.map(sp => [sp.name, sp.category || '', sp.contact_name || '', sp.phone || '', sp.status]),
      headStyles: { fillColor: [r, g, bl] }, styles: { fontSize: 8 },
    });
    doc.addPage();
    doc.setFont(undefined, 'bold'); doc.setFontSize(14);
    doc.text('Tarefas', 14, 20);
    doc.autoTable({
      startY: 24,
      head: [['Fase', 'Categoria', 'Tarefa', 'Responsável', 'Prazo', 'Estado']],
      body: state.tasks.map(t => [t.phase, t.category || '', t.title, t.responsible || '', t.end_date ? fmtDate(iso(t.end_date)) : '', t.done ? 'Concluída' : 'Pendente']),
      headStyles: { fillColor: [r, g, bl] }, styles: { fontSize: 8 },
    });
  }

  // Footer on all pages
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150, 150, 150);
    doc.text(`${brandName} · Página ${i}/${pages}`, 14, 290);
  }

  const fname = `${(kind === 'client' ? 'relatorio-cliente' : 'backup-gestor')}-${(p.name || 'evento').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  doc.save(fname);
  toast('PDF gerado');
}

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ================= INIT =================
tryAutoLogin();
