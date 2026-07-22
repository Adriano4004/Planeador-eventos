// Eveni frontend
(() => {
'use strict';

// ---------- state ----------
const state = {
  user: null,
  plan: null,
  projects: [],
  currentProjectId: null,
  currentProject: null,
  tasks: [],
  vendors: [],
  guests: [],
  page: 'dashboard',
};

// ---------- helpers ----------
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const fmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDate = (d) => (d ? fmt.format(new Date(String(d).slice(0,10) + 'T12:00:00Z')) : '—');
const fmtMoney = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €');
const todayISO = () => new Date().toISOString().slice(0,10);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || data || `HTTP ${r.status}`);
  return data;
}

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 3000);
}

function openModal(title, bodyHTML, opts = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card">
      <h3>${esc(title)}</h3>
      <div class="modal-body">${bodyHTML}</div>
      <div class="modal-actions">
        <button class="btn" data-action="cancel">${esc(opts.cancelLabel || 'Cancelar')}</button>
        <button class="btn btn-primary" data-action="confirm">${esc(opts.confirmLabel || 'Guardar')}</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  return new Promise((resolve) => {
    const close = (v) => { backdrop.remove(); resolve(v); };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    $('[data-action=cancel]', backdrop).addEventListener('click', () => close(null));
    $('[data-action=confirm]', backdrop).addEventListener('click', () => close(backdrop));
  });
}

// ---------- auth ----------
function initAuth() {
  const loginForm = $('#form-login');
  const registerForm = $('#form-register');
  $$('.auth-tabs .tab').forEach(t => t.addEventListener('click', () => {
    $$('.auth-tabs .tab').forEach(x => x.classList.toggle('active', x === t));
    if (t.dataset.tab === 'login') { loginForm.classList.remove('hidden'); registerForm.classList.add('hidden'); }
    else { registerForm.classList.remove('hidden'); loginForm.classList.add('hidden'); }
  }));

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const fd = new FormData(loginForm);
    try {
      await api('POST', '/api/auth/login', { email: fd.get('email'), password: fd.get('password') });
      await boot();
    } catch (err) { $('#login-error').textContent = err.message; }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#register-error').textContent = '';
    const fd = new FormData(registerForm);
    try {
      await api('POST', '/api/auth/register', {
        name: fd.get('name'), email: fd.get('email'),
        password: fd.get('password'), plan_code: fd.get('plan_code'),
      });
      await boot();
    } catch (err) { $('#register-error').textContent = err.message; }
  });
}

async function logout() {
  try { await api('POST', '/api/auth/logout'); } catch {}
  location.reload();
}

// ---------- boot ----------
async function boot() {
  try {
    const me = await api('GET', '/api/auth/me');
    state.user = me.user;
    state.plan = me.plan;
    $('#view-auth').classList.add('hidden');
    $('#view-app').classList.remove('hidden');
    $('#user-name').textContent = me.user.name;
    $('#settings-user-name').textContent = me.user.name;
    $('#settings-user-email').textContent = me.user.email;
    updatePlanBadge();
    initApp();
    await loadProjects();
    if (state.projects.length === 0) {
      await newProjectFlow(true);
    }
  } catch {
    $('#view-auth').classList.remove('hidden');
    $('#view-app').classList.add('hidden');
  }
}

function updatePlanBadge() {
  if (!state.plan) {
    $('#plan-name').textContent = 'Sem plano';
    $('#plan-usage').textContent = '—';
    return;
  }
  $('#plan-name').textContent = state.plan.name;
  const max = state.plan.max_projects >= 999999 ? '∞' : state.plan.max_projects;
  $('#plan-usage').textContent = `${state.projects.length} / ${max} projectos`;
}

// ---------- navigation ----------
function initApp() {
  $$('.nav-item').forEach(item => item.addEventListener('click', () => setPage(item.dataset.page)));
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-logout-2').addEventListener('click', logout);
  $('#project-select').addEventListener('change', (e) => selectProject(Number(e.target.value)));
  $('#btn-new-project').addEventListener('click', () => newProjectFlow(false));

  // tasks page
  $('#btn-new-task').addEventListener('click', newTaskFlow);
  $('#task-search').addEventListener('input', renderTasks);
  $('#task-phase-filter').addEventListener('change', renderTasks);
  $('#task-hide-done').addEventListener('change', renderTasks);

  // vendors
  $('#btn-new-vendor').addEventListener('click', () => vendorFlow(null));
  $('#vendor-search').addEventListener('input', renderVendors);

  // guests
  $('#btn-new-guest').addEventListener('click', () => guestFlow(null));
  $('#guest-search').addEventListener('input', renderGuests);

  // settings form
  $('#form-project-settings').addEventListener('submit', saveProjectSettings);
  $('#btn-delete-project').addEventListener('click', deleteProject);

  // pdf
  $('#btn-export-pdf').addEventListener('click', () => {
    if (!state.currentProjectId) return;
    window.location.href = `/api/projects/${state.currentProjectId}/pdf`;
  });
}

function setPage(p) {
  state.page = p;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === p));
  $$('.page').forEach(pg => pg.classList.toggle('active', pg.dataset.page === p));
  if (p === 'settings') fillSettingsForm();
  if (p === 'tasks') renderTasks();
  if (p === 'vendors') { loadVendors(); }
  if (p === 'guests') { loadGuests(); }
  if (p === 'dashboard') renderDashboard();
}

// ---------- projects ----------
async function loadProjects() {
  const { projects } = await api('GET', '/api/projects');
  state.projects = projects;
  const sel = $('#project-select');
  sel.innerHTML = projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  updatePlanBadge();
  if (projects.length) {
    const id = state.currentProjectId && projects.find(p => p.id === state.currentProjectId) ? state.currentProjectId : projects[0].id;
    sel.value = id;
    await selectProject(id);
  } else {
    state.currentProjectId = null;
    state.currentProject = null;
  }
}

async function selectProject(id) {
  state.currentProjectId = id;
  const { project, tasks } = await api('GET', `/api/projects/${id}`);
  state.currentProject = project;
  state.tasks = tasks;
  fillPhaseFilter();
  renderDashboard();
  if (state.page === 'tasks') renderTasks();
  if (state.page === 'settings') fillSettingsForm();
  if (state.page === 'vendors') loadVendors();
  if (state.page === 'guests') loadGuests();
}

async function newProjectFlow(isFirst) {
  if (!state.plan) {
    toast('Escolha um plano primeiro.', 'error');
    return;
  }
  if (state.projects.length >= state.plan.max_projects) {
    toast(`Limite do plano ${state.plan.name} atingido.`, 'error');
    return;
  }
  const { templates } = await api('GET', '/api/templates');
  const allowedTpl = templates.filter(t => t.allowed);
  if (!allowedTpl.length) {
    toast('O seu plano não tem templates disponíveis.', 'error');
    return;
  }
  const body = `
    <form id="new-project-form" class="form-grid">
      <label class="col-2">Nome do projecto<input type="text" name="name" required autofocus></label>
      <label class="col-2">Template
        <select name="template_code" required>
          <option value="">— Escolher template —</option>
          ${allowedTpl.map(t => `<option value="${t.code}">${esc(t.name)} · ${t.task_count} tarefas</option>`).join('')}
          ${templates.filter(t => !t.allowed).map(t => `<option value="${t.code}" disabled>${esc(t.name)} (plano superior)</option>`).join('')}
        </select>
      </label>
      <p class="muted small col-2" id="tpl-summary"></p>
      <label>Data do evento<input type="date" name="event_date"></label>
      <label>Local<input type="text" name="location"></label>
      <label>Público (nº)<input type="number" name="audience" min="0"></label>
      <label>Orçamento (€)<input type="number" name="budget" min="0" step="0.01"></label>
      <p class="form-error col-2" id="new-project-error"></p>
    </form>`;
  const modal = await openModalRaw(isFirst ? 'Bem-vindo — crie o seu primeiro projecto' : 'Novo projecto', body, { confirmLabel: 'Criar projecto', dismissable: !isFirst });
  if (!modal) return;
  const form = $('#new-project-form', modal);
  const tplSel = form.querySelector('[name=template_code]');
  const summary = $('#tpl-summary', modal);
  tplSel.addEventListener('change', () => {
    const t = allowedTpl.find(x => x.code === tplSel.value);
    summary.textContent = t ? `${t.description} · ${t.task_count} tarefas · recomendado ${t.days_recommended} dias` : '';
  });
  return new Promise((resolve) => {
    $('[data-action=confirm]', modal).onclick = async () => {
      $('#new-project-error').textContent = '';
      const fd = new FormData(form);
      const payload = {
        name: fd.get('name'),
        template_code: fd.get('template_code'),
        event_date: fd.get('event_date') || null,
        location: fd.get('location') || null,
        audience: fd.get('audience') || null,
        budget: fd.get('budget') || null,
      };
      if (!payload.name || !payload.template_code) {
        $('#new-project-error').textContent = 'Nome e template são obrigatórios.';
        return;
      }
      try {
        const res = await api('POST', '/api/projects', payload);
        modal.remove();
        toast('Projecto criado.', 'success');
        state.currentProjectId = res.project.id;
        await loadProjects();
        if (res.warnings && res.warnings.length) {
          setTimeout(() => {
            toast(`${res.warnings.length} tarefas críticas ficam antes de hoje. Reveja o cronograma.`, 'error');
          }, 400);
        }
        resolve(res);
      } catch (err) {
        $('#new-project-error').textContent = err.message;
      }
    };
    if (!isFirst) {
      $('[data-action=cancel]', modal).onclick = () => { modal.remove(); resolve(null); };
    } else {
      $('[data-action=cancel]', modal).style.display = 'none';
    }
  });
}

function openModalRaw(title, bodyHTML, opts = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-actions">
          <button class="btn" data-action="cancel">${esc(opts.cancelLabel || 'Cancelar')}</button>
          <button class="btn btn-primary" data-action="confirm">${esc(opts.confirmLabel || 'Guardar')}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (opts.dismissable !== false) {
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
    }
    resolve(backdrop);
  });
}

async function saveProjectSettings(e) {
  e.preventDefault();
  $('#project-error').textContent = '';
  const fd = new FormData(e.target);
  const resetDates = $('#reset-dates').checked;
  try {
    await api('PUT', `/api/projects/${state.currentProjectId}?reset_dates=${resetDates ? 1 : 0}`, {
      name: fd.get('name'),
      event_date: fd.get('event_date') || null,
      location: fd.get('location') || null,
      audience: fd.get('audience') || null,
      budget: fd.get('budget') || null,
      brand_color: fd.get('brand_color') || null,
      notes: fd.get('notes') || null,
    });
    toast('Projecto guardado.', 'success');
    await loadProjects();
    fillSettingsForm();
  } catch (err) {
    $('#project-error').textContent = err.message;
  }
}

async function deleteProject() {
  if (!confirm(`Eliminar o projecto "${state.currentProject.name}"? Esta acção é irreversível.`)) return;
  try {
    await api('DELETE', `/api/projects/${state.currentProjectId}`);
    toast('Projecto eliminado.', 'success');
    state.currentProjectId = null;
    await loadProjects();
    if (!state.projects.length) newProjectFlow(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function fillSettingsForm() {
  const p = state.currentProject;
  if (!p) return;
  const f = $('#form-project-settings');
  f.name.value = p.name || '';
  f.event_date.value = p.event_date || '';
  f.location.value = p.location || '';
  f.audience.value = p.audience || '';
  f.budget.value = p.budget || '';
  f.brand_color.value = p.brand_color || '#4f46e5';
  f.notes.value = p.notes || '';
  // plan info
  const planBox = $('#settings-plan');
  if (state.plan) {
    planBox.innerHTML = `
      <p><strong>${esc(state.plan.name)}</strong></p>
      <p class="muted small">Templates: ${state.plan.allowed_templates.join(', ')} · Projectos: ${state.plan.max_projects >= 999999 ? 'ilimitado' : state.plan.max_projects}</p>
      <ul>${state.plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    `;
  }
}

// ---------- dashboard ----------
function renderDashboard() {
  const p = state.currentProject;
  if (!p) {
    $('#dash-project-name').textContent = 'Nenhum projecto';
    $('#dash-project-meta').textContent = 'Crie o seu primeiro projecto.';
    return;
  }
  $('#dash-project-name').textContent = p.name;
  const bits = [];
  if (p.event_date) bits.push(fmtDate(p.event_date));
  if (p.location) bits.push(p.location);
  if (p.audience) bits.push(`${p.audience} pessoas`);
  $('#dash-project-meta').textContent = bits.join(' · ') || 'Sem detalhes';

  const total = state.tasks.length;
  const done = state.tasks.filter(t => t.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  $('#kpi-tasks').textContent = total;
  $('#kpi-tasks-hint').textContent = `${done} concluídas`;
  $('#kpi-progress').textContent = pct + '%';
  $('#kpi-bar').style.width = pct + '%';

  // upcoming: 5 tarefas com start_date >= hoje, não feitas
  const today = todayISO();
  const upcoming = state.tasks
    .filter(t => !t.done && t.start_date && t.start_date >= today)
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
    .slice(0, 6);
  const upEl = $('#dash-upcoming');
  upEl.innerHTML = upcoming.length ? upcoming.map(t => `
    <div class="task-item">
      <span class="task-item-title">${esc(t.title)}${t.critical ? ' <span class="task-critical" title="Crítica">▲</span>' : ''}</span>
      <span class="task-item-date">${fmtDate(t.start_date)}</span>
    </div>`).join('') : '<p class="muted small">Sem tarefas agendadas.</p>';

  // alerts
  const overdue = state.tasks.filter(t => !t.done && t.start_date && t.start_date < today);
  const noDate = state.tasks.filter(t => !t.done && !t.start_date);
  const critical = state.tasks.filter(t => !t.done && t.critical);
  const alerts = [];
  if (overdue.length) alerts.push({ kind: 'overdue', text: `${overdue.length} tarefas em atraso` });
  if (critical.length) alerts.push({ kind: 'upcoming', text: `${critical.length} tarefas críticas por concluir` });
  if (noDate.length) alerts.push({ kind: 'info', text: `${noDate.length} tarefas sem data` });
  $('#dash-alerts').innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert ${a.kind}">${esc(a.text)}</div>`).join('')
    : '<div class="alert-empty">Sem alertas.</div>';
}

// ---------- tasks ----------
function fillPhaseFilter() {
  const sel = $('#task-phase-filter');
  const phases = [...new Set(state.tasks.map(t => t.phase).filter(Boolean))];
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todas as fases</option>' + phases.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  if (phases.includes(cur)) sel.value = cur;
}

function renderTasks() {
  const container = $('#tasks-container');
  const q = ($('#task-search').value || '').toLowerCase();
  const phase = $('#task-phase-filter').value;
  const hideDone = $('#task-hide-done').checked;
  const today = todayISO();
  const list = state.tasks.filter(t => {
    if (phase && t.phase !== phase) return false;
    if (hideDone && t.done) return false;
    if (q && !(t.title.toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const groups = {};
  for (const t of list) (groups[t.phase] = groups[t.phase] || []).push(t);
  if (!Object.keys(groups).length) {
    container.innerHTML = '<p class="muted">Nenhuma tarefa corresponde ao filtro.</p>';
    return;
  }
  container.innerHTML = Object.entries(groups).map(([phase, items]) => `
    <div class="task-group">
      <div class="task-group-header">${esc(phase)}<span>${items.length}</span></div>
      <div class="task-group-body">
        ${items.map(t => taskRowHTML(t, today)).join('')}
      </div>
    </div>`).join('');
  // wire events
  container.querySelectorAll('.task-row').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('input[type=checkbox]').addEventListener('change', (e) => toggleTaskDone(id, e.target.checked));
    row.querySelector('[data-act=edit]').addEventListener('click', () => editTask(id));
    row.querySelector('[data-act=del]').addEventListener('click', () => deleteTask(id));
  });
}

function taskRowHTML(t, today) {
  const overdue = !t.done && t.start_date && t.start_date < today;
  return `
    <div class="task-row ${t.done ? 'done' : ''}" data-id="${t.id}">
      <input type="checkbox" ${t.done ? 'checked' : ''}>
      <div class="task-title">
        ${esc(t.title)} ${t.critical ? '<span class="task-critical" title="Crítica">▲</span>' : ''}
        <small>${esc(t.category || '')} ${t.role ? '· ' + esc(t.role) : ''}</small>
      </div>
      <div class="task-date ${overdue ? 'overdue' : ''}">${t.start_date ? fmtDate(t.start_date) : '—'}</div>
      <div class="task-date">${t.end_date ? fmtDate(t.end_date) : '—'}</div>
      <div class="task-date">${esc(t.responsible || '')}</div>
      <div class="task-actions">
        <button data-act="edit" title="Editar">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button data-act="del" title="Eliminar">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div>
    </div>`;
}

async function toggleTaskDone(id, done) {
  try {
    await api('PUT', `/api/tasks/${id}`, { done });
    const t = state.tasks.find(x => x.id === id);
    if (t) t.done = done ? 1 : 0;
    renderDashboard();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTask(id) {
  if (!confirm('Eliminar esta tarefa?')) return;
  try {
    await api('DELETE', `/api/tasks/${id}`);
    state.tasks = state.tasks.filter(t => t.id !== id);
    renderTasks();
    renderDashboard();
    toast('Tarefa eliminada.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function editTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const body = `
    <form id="task-form" class="form-grid">
      <label class="col-2">Título<input type="text" name="title" value="${esc(t.title)}" required></label>
      <label>Fase<input type="text" name="phase" value="${esc(t.phase || '')}"></label>
      <label>Categoria<input type="text" name="category" value="${esc(t.category || '')}"></label>
      <label>Início<input type="date" name="start_date" value="${t.start_date || ''}"></label>
      <label>Fim<input type="date" name="end_date" value="${t.end_date || ''}"></label>
      <label class="col-2">Responsável<input type="text" name="responsible" value="${esc(t.responsible || '')}"></label>
      <label class="col-2">Nota<textarea name="note" rows="3">${esc(t.note || '')}</textarea></label>
    </form>`;
  const modal = await openModalRaw('Editar tarefa', body, { confirmLabel: 'Guardar' });
  $('[data-action=confirm]', modal).onclick = async () => {
    const fd = new FormData($('#task-form', modal));
    try {
      await api('PUT', `/api/tasks/${id}`, Object.fromEntries(fd));
      Object.assign(t, Object.fromEntries(fd));
      modal.remove();
      renderTasks();
      toast('Tarefa actualizada.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('[data-action=cancel]', modal).onclick = () => modal.remove();
}

async function newTaskFlow() {
  const body = `
    <form id="task-form" class="form-grid">
      <label class="col-2">Título<input type="text" name="title" required></label>
      <label>Fase<input type="text" name="phase" value="Pré Produção"></label>
      <label>Categoria<input type="text" name="category" value="Geral"></label>
      <label>Início<input type="date" name="start_date"></label>
      <label>Fim<input type="date" name="end_date"></label>
      <label class="col-2">Responsável<input type="text" name="responsible"></label>
    </form>`;
  const modal = await openModalRaw('Nova tarefa', body, { confirmLabel: 'Criar' });
  $('[data-action=confirm]', modal).onclick = async () => {
    const fd = new FormData($('#task-form', modal));
    try {
      const { task } = await api('POST', `/api/projects/${state.currentProjectId}/tasks`, Object.fromEntries(fd));
      state.tasks.push(task);
      modal.remove();
      renderTasks();
      renderDashboard();
      fillPhaseFilter();
      toast('Tarefa criada.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('[data-action=cancel]', modal).onclick = () => modal.remove();
}

// ---------- vendors ----------
async function loadVendors() {
  if (!state.currentProjectId) return;
  const { vendors } = await api('GET', `/api/projects/${state.currentProjectId}/vendors`);
  state.vendors = vendors;
  renderVendors();
}

function renderVendors() {
  const container = $('#vendors-container');
  const q = ($('#vendor-search').value || '').toLowerCase();
  const list = state.vendors.filter(v => !q || v.name.toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q));
  const totalContracted = state.vendors.reduce((s, v) => s + Number(v.contracted || 0), 0);
  const totalPaid = state.vendors.reduce((s, v) => s + Number(v.paid || 0), 0);
  $('#vendor-summary').innerHTML = `
    <div class="summary-chip">Fornecedores<strong>${state.vendors.length}</strong></div>
    <div class="summary-chip">Contratado<strong>${fmtMoney(totalContracted)}</strong></div>
    <div class="summary-chip">Pago<strong>${fmtMoney(totalPaid)}</strong></div>
    <div class="summary-chip">Em falta<strong>${fmtMoney(totalContracted - totalPaid)}</strong></div>
  `;
  // KPI
  $('#kpi-vendors').textContent = state.vendors.length;
  $('#kpi-vendors-hint').textContent = `${fmtMoney(totalContracted)} contratados`;

  if (!list.length) {
    container.innerHTML = '<p class="muted">Sem fornecedores.</p>';
    return;
  }
  container.innerHTML = `
    <div class="vendor-row vendor-header">
      <span>Nome</span><span>Categoria</span><span>Contacto</span><span>Contratado</span><span>Pago</span><span></span>
    </div>
    ${list.map(v => `
      <div class="vendor-row" data-id="${v.id}">
        <span><strong>${esc(v.name)}</strong><br><span class="status-pill status-${esc(v.status || 'em_negociacao')}">${esc(v.status || '—').replace('_',' ')}</span></span>
        <span>${esc(v.category || '—')}</span>
        <span class="muted small">${esc([v.contact, v.phone, v.email].filter(Boolean).join(' · ') || '—')}</span>
        <span>${fmtMoney(v.contracted)}</span>
        <span>${fmtMoney(v.paid)}</span>
        <span class="task-actions">
          <button data-act="edit"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button data-act="del"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </span>
      </div>`).join('')}
  `;
  container.querySelectorAll('.vendor-row[data-id]').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-act=edit]').addEventListener('click', () => vendorFlow(id));
    row.querySelector('[data-act=del]').addEventListener('click', () => deleteVendor(id));
  });
}

async function vendorFlow(id) {
  const v = id ? state.vendors.find(x => x.id === id) : {};
  const body = `
    <form id="vendor-form" class="form-grid">
      <label class="col-2">Nome<input type="text" name="name" value="${esc(v.name || '')}" required></label>
      <label>Categoria<input type="text" name="category" value="${esc(v.category || '')}"></label>
      <label>Estado
        <select name="status">
          <option value="em_negociacao" ${v.status === 'em_negociacao' ? 'selected' : ''}>Em negociação</option>
          <option value="contratado" ${v.status === 'contratado' ? 'selected' : ''}>Contratado</option>
          <option value="pago" ${v.status === 'pago' ? 'selected' : ''}>Pago</option>
          <option value="cancelado" ${v.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
        </select>
      </label>
      <label>Contacto<input type="text" name="contact" value="${esc(v.contact || '')}"></label>
      <label>Telefone<input type="text" name="phone" value="${esc(v.phone || '')}"></label>
      <label class="col-2">E-mail<input type="email" name="email" value="${esc(v.email || '')}"></label>
      <label>Orçamentado (€)<input type="number" name="quoted" min="0" step="0.01" value="${v.quoted || ''}"></label>
      <label>Contratado (€)<input type="number" name="contracted" min="0" step="0.01" value="${v.contracted || ''}"></label>
      <label>Pago (€)<input type="number" name="paid" min="0" step="0.01" value="${v.paid || ''}"></label>
      <label class="col-2">Notas<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea></label>
    </form>`;
  const modal = await openModalRaw(id ? 'Editar fornecedor' : 'Novo fornecedor', body, { confirmLabel: id ? 'Guardar' : 'Criar' });
  $('[data-action=confirm]', modal).onclick = async () => {
    const fd = new FormData($('#vendor-form', modal));
    try {
      if (id) await api('PUT', `/api/vendors/${id}`, Object.fromEntries(fd));
      else await api('POST', `/api/projects/${state.currentProjectId}/vendors`, Object.fromEntries(fd));
      modal.remove();
      await loadVendors();
      toast(id ? 'Fornecedor actualizado.' : 'Fornecedor criado.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('[data-action=cancel]', modal).onclick = () => modal.remove();
}

async function deleteVendor(id) {
  if (!confirm('Eliminar este fornecedor?')) return;
  try {
    await api('DELETE', `/api/vendors/${id}`);
    await loadVendors();
    toast('Fornecedor eliminado.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- guests ----------
async function loadGuests() {
  if (!state.currentProjectId) return;
  const { guests } = await api('GET', `/api/projects/${state.currentProjectId}/guests`);
  state.guests = guests;
  renderGuests();
}

function renderGuests() {
  const container = $('#guests-container');
  const q = ($('#guest-search').value || '').toLowerCase();
  const list = state.guests.filter(g => !q || g.name.toLowerCase().includes(q) || (g.email || '').toLowerCase().includes(q));
  const yes = state.guests.filter(g => g.rsvp_status === 'sim').length;
  const no = state.guests.filter(g => g.rsvp_status === 'nao').length;
  const maybe = state.guests.filter(g => g.rsvp_status === 'talvez').length;
  const pending = state.guests.filter(g => g.rsvp_status === 'pendente').length;
  const totalPax = state.guests.filter(g => g.rsvp_status === 'sim').reduce((s, g) => s + (g.party_size || 1), 0);
  $('#guest-summary').innerHTML = `
    <div class="summary-chip">Total<strong>${state.guests.length}</strong></div>
    <div class="summary-chip">Confirmados<strong>${yes}</strong></div>
    <div class="summary-chip">Recusados<strong>${no}</strong></div>
    <div class="summary-chip">Talvez / Pendentes<strong>${maybe + pending}</strong></div>
    <div class="summary-chip">Pax confirmados<strong>${totalPax}</strong></div>
  `;
  $('#kpi-guests').textContent = state.guests.length;
  $('#kpi-guests-hint').textContent = `${yes} confirmados · ${totalPax} pax`;

  if (!list.length) {
    container.innerHTML = '<p class="muted">Sem convidados. Adicione o primeiro para gerar link de RSVP.</p>';
    return;
  }
  container.innerHTML = `
    <div class="guest-row guest-header">
      <span>Nome</span><span>Contacto</span><span>Estado RSVP</span><span>Pax</span><span>Link</span><span></span>
    </div>
    ${list.map(g => `
      <div class="guest-row" data-id="${g.id}">
        <span><strong>${esc(g.name)}</strong></span>
        <span class="muted small">${esc([g.email, g.phone].filter(Boolean).join(' · ') || '—')}</span>
        <span><span class="status-pill status-${esc(g.rsvp_status)}">${esc(g.rsvp_status)}</span></span>
        <span>${g.party_size || 1}</span>
        <span><button class="btn btn-sm" data-act="copy" title="Copiar link RSVP">Copiar link</button></span>
        <span class="task-actions">
          <button data-act="edit"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button data-act="del"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
        </span>
      </div>`).join('')}
  `;
  container.querySelectorAll('.guest-row[data-id]').forEach(row => {
    const id = Number(row.dataset.id);
    const g = state.guests.find(x => x.id === id);
    row.querySelector('[data-act=copy]').addEventListener('click', () => {
      const url = `${location.origin}/rsvp/${g.rsvp_token}`;
      navigator.clipboard.writeText(url).then(() => toast('Link RSVP copiado.', 'success'));
    });
    row.querySelector('[data-act=edit]').addEventListener('click', () => guestFlow(id));
    row.querySelector('[data-act=del]').addEventListener('click', () => deleteGuest(id));
  });
}

async function guestFlow(id) {
  const g = id ? state.guests.find(x => x.id === id) : {};
  const body = `
    <form id="guest-form" class="form-grid">
      <label class="col-2">Nome<input type="text" name="name" value="${esc(g.name || '')}" required></label>
      <label>E-mail<input type="email" name="email" value="${esc(g.email || '')}"></label>
      <label>Telefone<input type="text" name="phone" value="${esc(g.phone || '')}"></label>
      <label>Pax<input type="number" name="party_size" min="1" value="${g.party_size || 1}"></label>
      ${id ? `<label>Estado
        <select name="rsvp_status">
          <option value="pendente" ${g.rsvp_status === 'pendente' ? 'selected' : ''}>Pendente</option>
          <option value="sim" ${g.rsvp_status === 'sim' ? 'selected' : ''}>Confirma</option>
          <option value="nao" ${g.rsvp_status === 'nao' ? 'selected' : ''}>Não vai</option>
          <option value="talvez" ${g.rsvp_status === 'talvez' ? 'selected' : ''}>Talvez</option>
        </select></label>` : ''}
      <label class="col-2">Nota<textarea name="note" rows="2">${esc(g.note || '')}</textarea></label>
    </form>`;
  const modal = await openModalRaw(id ? 'Editar convidado' : 'Novo convidado', body, { confirmLabel: id ? 'Guardar' : 'Criar' });
  $('[data-action=confirm]', modal).onclick = async () => {
    const fd = new FormData($('#guest-form', modal));
    try {
      if (id) await api('PUT', `/api/guests/${id}`, Object.fromEntries(fd));
      else await api('POST', `/api/projects/${state.currentProjectId}/guests`, Object.fromEntries(fd));
      modal.remove();
      await loadGuests();
      toast(id ? 'Convidado actualizado.' : 'Convidado adicionado.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('[data-action=cancel]', modal).onclick = () => modal.remove();
}

async function deleteGuest(id) {
  if (!confirm('Remover este convidado?')) return;
  try {
    await api('DELETE', `/api/guests/${id}`);
    await loadGuests();
    toast('Convidado removido.', 'success');
  } catch (err) { toast(err.message, 'error'); }
}

// ---------- init ----------
initAuth();
boot();

})();
