(() => {
'use strict';
const token = location.pathname.split('/').pop();
const $ = (s) => document.querySelector(s);
const fmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
const fmtDate = (d) => (d ? fmt.format(new Date(String(d).slice(0,10) + 'T12:00:00Z')) : '');

let selectedStatus = null;

async function load() {
  try {
    const res = await fetch('/api/rsvp/' + encodeURIComponent(token));
    if (!res.ok) throw new Error((await res.json()).error || 'Convite inválido');
    const { guest } = await res.json();
    $('#rsvp-subtitle').textContent = '';
    $('#rsvp-content').classList.remove('hidden');
    $('#rsvp-name').textContent = guest.name;
    $('#rsvp-project').textContent = guest.project_name;
    const bits = [];
    if (guest.event_date) bits.push(fmtDate(guest.event_date));
    if (guest.location) bits.push(guest.location);
    $('#rsvp-details').textContent = bits.join(' · ');
    $('#rsvp-party').value = guest.party_size || 1;
    if (guest.rsvp_status && guest.rsvp_status !== 'pendente') {
      selectedStatus = guest.rsvp_status;
      markSelected();
    }
  } catch (e) {
    $('#rsvp-subtitle').textContent = e.message;
  }
}

function markSelected() {
  document.querySelectorAll('[data-status]').forEach(b => {
    b.classList.toggle('rsvp-option-active', b.dataset.status === selectedStatus);
  });
}

document.querySelectorAll('[data-status]').forEach(b => {
  b.addEventListener('click', () => { selectedStatus = b.dataset.status; markSelected(); });
});

$('#rsvp-submit').addEventListener('click', async () => {
  $('#rsvp-error').textContent = '';
  if (!selectedStatus) { $('#rsvp-error').textContent = 'Escolha uma opção.'; return; }
  const party = parseInt($('#rsvp-party').value, 10) || 1;
  try {
    const res = await fetch('/api/rsvp/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: selectedStatus, party_size: party }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Erro');
    $('#rsvp-content').classList.add('hidden');
    $('#rsvp-done').classList.remove('hidden');
    $('#rsvp-title').textContent = 'Resposta registada';
  } catch (e) {
    $('#rsvp-error').textContent = e.message;
  }
});

load();
})();
