const HEADERS = { 'Content-Type': 'application/json', 'x-user': 'Admin User', 'x-role': 'Admin' };
const state = {
  meta: null,
  dash: null,
  clients: [],
  selected: null,
  selectedId: null,
  view: 'dashboard',
  pickerQuery: ''
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function jfetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function setError(msg = '') {
  const el = $('error');
  if (!msg) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = msg;
}

function setView(view) {
  state.view = view;
  $('viewDashboard').style.display = view === 'dashboard' ? 'block' : 'none';
  $('viewClients').style.display = view === 'clients' ? 'block' : 'none';
  $('viewNotices').style.display = view === 'notices' ? 'block' : 'none';
  ['navDashboard', 'navClients', 'navNotices'].forEach((id) => $(id).classList.remove('active'));
  if (view === 'dashboard') $('navDashboard').classList.add('active');
  if (view === 'clients') $('navClients').classList.add('active');
  if (view === 'notices') $('navNotices').classList.add('active');
  $('topTitle').textContent = view === 'dashboard' ? 'Dashboard' : view === 'clients' ? 'Clients' : 'Notices';
}

function tickClock() {
  const now = new Date();
  $('localTime').textContent = now.toLocaleTimeString();
  $('utcTime').textContent = now.toUTCString().split(' ')[4] || '--:--:--';
}

function riskLevel(clientMissingCount, status) {
  if (clientMissingCount >= 4 || ['Missing Docs', 'Data Entry'].includes(status)) return 'red';
  if (clientMissingCount >= 2 || ['Review', 'Extended'].includes(status)) return 'yellow';
  return 'green';
}

function buildNotices() {
  const missingMap = new Map((state.dash?.missing || []).map((m) => [m.id, m.missing.length]));
  return state.clients
    .map((c) => {
      const miss = missingMap.get(c.id) || 0;
      const level = riskLevel(miss, c.status);
      let message = 'On track.';
      if (level === 'red') message = 'High risk of delay. Immediate follow-up needed.';
      if (level === 'yellow') message = 'Needs attention soon.';
      return { ...c, missingCount: miss, level, message };
    })
    .sort((a, b) => b.missingCount - a.missingCount);
}

function renderDashboard() {
  if (!state.dash) return;
  $('kpis').innerHTML = [
    ['Active Clients', state.dash.active],
    ['Total Clients', state.dash.total],
    ['Filed', state.dash.filed],
    ['Extensions', state.dash.extensions]
  ]
    .map(
      ([l, v]) =>
        `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`
    )
    .join('');

  const statusEntries = Object.entries(state.dash.returnsByStatus || {});
  const max = Math.max(1, ...statusEntries.map(([, v]) => Number(v || 0)));
  $('statusGraph').innerHTML = statusEntries
    .map(([k, v]) => {
      const pct = Math.round((Number(v || 0) / max) * 100);
      return `<div class="graph-row"><div class="small muted">${esc(k)}</div><div class="bar"><div class="fill" style="width:${pct}%"></div></div><div class="small muted">${esc(v)}</div></div>`;
    })
    .join('');

  const notices = buildNotices();
  $('riskNotices').innerHTML =
    notices
      .slice(0, 8)
      .map(
        (n) =>
          `<div class="item notice-${n.level}"><div class="row"><b>${esc(n.name)}</b><span class="pill">${esc(n.status)}</span></div><div class="small muted">Missing docs: ${n.missingCount}</div><div class="small">${esc(n.message)}</div></div>`
      )
      .join('') || '<div class="small muted">No notices.</div>';

  $('missingQueue').innerHTML =
    (state.dash.missing || [])
      .slice(0, 12)
      .map(
        (m) =>
          `<div class="warn"><b>${esc(m.name)}</b><div class="small muted">${esc(m.missing.join(', '))}</div></div>`
      )
      .join('') || '<div class="small muted">No missing docs.</div>';

  $('audit').innerHTML =
    (state.dash.audit || [])
      .map(
        (a) =>
          `<div class="item"><div class="small muted">${esc(a.at)}</div><div>${esc(a.action)} · ${esc(a.actor)}</div></div>`
      )
      .join('') || '<div class="small muted">No audit entries.</div>';
}

function renderNoticesPage() {
  const notices = buildNotices();
  $('noticeBoard').innerHTML =
    notices
      .map(
        (n) =>
          `<div class="item notice-${n.level}"><div class="row"><b>${esc(n.name)}</b><span class="pill">${esc(n.status)}</span></div><div class="small muted">Missing docs: ${n.missingCount}</div><div>${esc(n.message)}</div></div>`
      )
      .join('') || '<div class="small muted">No notices.</div>';
}

function filteredClients() {
  const q = state.pickerQuery.trim().toLowerCase();
  if (!q) return [];
  return state.clients.filter((c) =>
    [c.name, c.status, c.entityType, c.assignedStaff, ...(c.identifiers || [])]
      .join(' ')
      .toLowerCase()
      .includes(q)
  );
}

function renderPicker() {
  const rows = filteredClients();
  $('pickerResults').innerHTML =
    rows
      .slice(0, 25)
      .map(
        (c) =>
          `<div class="item"><div class="row"><b>${esc(c.name)}</b><span class="pill">${esc(c.status)}</span></div><div class="small muted">${esc(c.entityType)} · ${esc(c.assignedStaff || 'Unassigned')}</div><div class="row" style="margin-top:6px;"><button class="selectClientBtn" data-id="${esc(c.id)}" style="width:auto;">Select Client</button></div></div>`
      )
      .join('');

  if (!rows.length && state.pickerQuery.trim()) {
    $('pickerResults').innerHTML = '<div class="small muted">No client matches that search.</div>';
  }

  document.querySelectorAll('.selectClientBtn').forEach((el) => {
    el.onclick = async () => {
      state.selectedId = el.getAttribute('data-id');
      await loadSelected();
      state.pickerQuery = '';
      $('search').value = '';
      renderClientsPage();
    };
  });
}

function renderClientsPage() {
  renderPicker();

  if (!state.selected) {
    $('selectedPane').style.display = 'none';
    return;
  }

  $('selectedPane').style.display = 'grid';
  $('selTitle').textContent = state.selected.name;
  $('selInternal').textContent = `Internal ID: ${state.selected.clientInternalId}`;
  $('statusSelect').innerHTML = state.meta.statuses
    .map((s) => `<option ${s === state.selected.status ? 'selected' : ''}>${esc(s)}</option>`)
    .join('');
  $('folderSelect').innerHTML = state.meta.folders.map((f) => `<option>${esc(f)}</option>`).join('');
  $('checklist').innerHTML = (state.selected.checklist || [])
    .map((i) => `<div class="row"><span>${esc(i.doc)}</span><b>${i.found ? '✓' : 'Missing'}</b></div>`)
    .join('');
  $('files').innerHTML =
    (state.selected.files || [])
      .filter((f) => !f.internalOnly)
      .map(
        (f) =>
          `<div class="item"><b>${esc(f.originalName)}</b><div class="small muted">${esc(f.category)} v${esc(f.version)} • ${esc(f.source)}</div></div>`
      )
      .join('') || '<div class="small muted">No files yet.</div>';
}

function renderAll() {
  renderDashboard();
  renderClientsPage();
  renderNoticesPage();
}

async function refresh() {
  try {
    setError();
    const [meta, dash, clients] = await Promise.all([
      jfetch('/api/meta'),
      jfetch('/api/admin/dashboard'),
      jfetch('/api/admin/clients?q=')
    ]);
    state.meta = meta;
    state.dash = dash;
    state.clients = clients;

    if (state.selectedId) {
      await loadSelected();
    }
    renderAll();
  } catch (e) {
    setError(e.message);
  }
}

async function loadSelected() {
  if (!state.selectedId) return;
  state.selected = await jfetch(`/api/admin/clients/${state.selectedId}`);
}

async function uploadFile(file, source = 'upload') {
  if (!file || !state.selectedId) return;
  const base64 = await toBase64(file);
  await jfetch(`/api/admin/clients/${state.selectedId}/upload`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      base64,
      originalName: file.name,
      category: $('folderSelect').value,
      internalOnly: $('internalOnly').checked,
      source
    })
  });
  await refresh();
}

$('navDashboard').onclick = () => setView('dashboard');
$('navClients').onclick = () => setView('clients');
$('navNotices').onclick = () => setView('notices');

$('search').addEventListener('input', (e) => {
  state.pickerQuery = e.target.value;
  renderPicker();
});

$('createClient').onclick = async () => {
  try {
    await jfetch('/api/admin/clients', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        name: $('newName').value.trim(),
        entityType: $('newEntity').value,
        taxYears: $('newYears').value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        assignedStaff: $('newStaff').value.trim()
      })
    });
    $('newName').value = '';
    setView('clients');
    await refresh();
  } catch (e) {
    setError(e.message);
  }
};

$('statusSelect').onchange = async () => {
  try {
    await jfetch(`/api/admin/clients/${state.selectedId}/status`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ status: $('statusSelect').value })
    });
    await refresh();
  } catch (e) {
    setError(e.message);
  }
};

$('fileInput').onchange = async (e) => {
  try {
    await uploadFile(e.target.files[0], 'upload');
    e.target.value = '';
  } catch (err) {
    setError(err.message);
  }
};

$('sendReq').onclick = async () => {
  try {
    await jfetch(`/api/admin/clients/${state.selectedId}/requests`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: $('reqText').value, priority: 'high' })
    });
    await refresh();
  } catch (e) {
    setError(e.message);
  }
};

$('saveNote').onclick = async () => {
  try {
    await jfetch(`/api/admin/clients/${state.selectedId}/notes`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text: $('noteText').value })
    });
    $('noteText').value = '';
    await refresh();
  } catch (e) {
    setError(e.message);
  }
};

$('openPortal').onclick = () => {
  if (!state.selected) return;
  window.location.href = `/portal?code=${encodeURIComponent(state.selected.portalCode)}&from=admin`;
};

setView('dashboard');
setInterval(tickClock, 1000);
tickClock();
refresh();
