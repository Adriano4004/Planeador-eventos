// ================= STATE =================
const state = {
  user: null,
  projects: [],
  currentProjectId: null,
  project: null,
  tasks: [],
  filters: { q: '', phase: '', status: '' },
  charts: {},
};

// ================= UTILITIES =================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const money = (v) => {
  if (v == null || v === '') return 'Kz 0';
  return 'Kz ' + Number(v).toLocaleString('pt-AO', { maximumFractionDigits: 0 });
};
const fmtDate = (d) => { if (!d) return '—'; const dt = new Date(d + 'T00:00:00'); return dt.toLocaleDateString('pt-BR'); };
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

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'erro');
  return data;
}

// ================= AUTH =================
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  const which = t.dataset.tab;
  $('#login-form').style.display = which === 'login' ? 'flex' : 'none';
  $('#register-form').style.display = which === 'register' ? 'flex' : 'none';
}));

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = $('#login-err'); err.textContent = '';
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.user = user;
    await bootApp();
  } catch (e) { err.textContent = e.message; }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const err = $('#register-err'); err.textContent = '';
  try {
    const { user } = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd)) });
    state.user = user;
    await bootApp();
  } catch (e) { err.textContent = e.message; }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.reload();
});

// ================= NAV =================
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
function setView(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'gantt') renderGantt();
  if (view === 'dashboard') renderDashboard();
  if (view === 'alerts') renderAlerts();
}

// ================= BOOT =================
async function bootApp() {
  $('#auth-screen').style.display = 'none';
  $('#app-shell').style.display = 'grid';
  $('#user-name').textContent = state.user.name;
  await loadProjects();
}

async function tryAutoLogin() {
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
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
  const data = await api('/api/projects/' + state.currentProjectId);
  state.project = data.project;
  state.tasks = data.tasks;
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
  $('#fin-audience').textContent = (state.project.audience || 0).toLocaleString('pt-BR');
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
    headerWeeks.push(`<div class="gantt-week">${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</div>`);
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
  const a = getAlerts();
  const render = (arr, elId, empty) => {
    $(elId).innerHTML = arr.length ? arr.map(alertItemHTML).join('') : `<div class="empty">${empty}</div>`;
  };
  render(a.late, '#alerts-late', 'Nenhuma tarefa atrasada 🎉');
  render(a.soon, '#alerts-soon', 'Nenhuma tarefa nos próximos 7 dias');
  render(a.nodate, '#alerts-nodate', 'Todas as tarefas têm data');
  render(a.noowner, '#alerts-noowner', 'Todas as tarefas têm responsável');
}

function renderAlertBadge() {
  const a = getAlerts();
  const count = a.late.length + a.soon.length;
  const el = $('#alerts-badge');
  el.textContent = count || '';
  el.classList.toggle('show', count > 0);
}

// ================= UTILS =================
function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

// ================= INIT =================
tryAutoLogin();
