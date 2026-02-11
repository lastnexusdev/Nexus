const HEADERS = { 'Content-Type': 'application/json', 'x-user': 'Admin User', 'x-role': 'Admin' };
const state = {
  meta: null,
  dash: null,
  clients: [],
  selected: null,
  selectedId: null,
  view: 'dashboard',
  pickerQuery: '',
  fileManagerYear: null,
  fileManagerFolder: null,
  notifPanelOpen: false,
  notifSeenIds: new Set(),
  settings: null
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

function setReqFeedback(msg = '', ok = true) {
  const el = $('reqFeedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? '#2f7d32' : '#a12e2e';
}

function setTaxYearFeedback(msg = '', ok = true) {
  const el = $('taxYearFeedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? '#2f7d32' : '#a12e2e';
}
function setSettingsFeedback(msg = '', ok = true) {
  const el = $('settingsFeedback');
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? '#2f7d32' : '#a12e2e';
}


function getClientUploadNotifications() {
  const map = new Map((state.clients || []).map((c) => [c.id, c.name]));
  return (state.dash?.audit || [])
    .filter((a) => a.action === 'CLIENT_UPLOAD')
    .map((a) => ({ ...a, clientName: map.get(a.clientId) || a.clientId || 'Unknown client' }));
}

function renderNotifications() {
  const panel = $('notifPanel');
  const countEl = $('notifCount');
  if (!panel || !countEl) return;
  const items = getClientUploadNotifications();
  const unread = items.filter((n) => !state.notifSeenIds.has(n.id));
  countEl.textContent = String(unread.length);
  panel.innerHTML = items.length
    ? items.slice(0, 20).map((n) => `<div class="notif-item"><b>${esc(n.clientName)}</b><div class="small muted">${esc(n.at)}</div><div class="small">Client submitted files.</div><button class="notif-open-btn" data-client-id="${esc(n.clientId || '')}">Open Client</button></div>`).join('')
    : '<div class="small muted">No new client submissions.</div>';

  panel.querySelectorAll('.notif-open-btn').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      const clientId = btn.getAttribute('data-client-id');
      if (!clientId) return;
      state.selectedId = clientId;
      await loadSelected();
      setView('clients');
      state.notifPanelOpen = false;
      state.notifSeenIds.add(items.find((i) => i.clientId === clientId)?.id);
      renderAll();
    };
  });

  panel.style.display = state.notifPanelOpen ? 'block' : 'none';
}

function setView(view) {
  state.view = view;
  $('viewDashboard').style.display = view === 'dashboard' ? 'block' : 'none';
  $('viewClients').style.display = view === 'clients' ? 'block' : 'none';
  $('viewNotices').style.display = view === 'notices' ? 'block' : 'none';
  $('viewSettings').style.display = view === 'settings' ? 'block' : 'none';
  ['navDashboard', 'navClients', 'navNotices', 'navSettings'].forEach((id) => $(id).classList.remove('active'));
  if (view === 'dashboard') $('navDashboard').classList.add('active');
  if (view === 'clients') $('navClients').classList.add('active');
  if (view === 'notices') $('navNotices').classList.add('active');
  if (view === 'settings') $('navSettings').classList.add('active');
  $('topTitle').textContent = view === 'dashboard' ? 'Dashboard' : view === 'clients' ? 'Clients' : view === 'notices' ? 'Notices' : 'Settings';
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
    .map(([l, v]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`)
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
      .map((n) => `<div class="item notice-${n.level}"><div class="row"><b>${esc(n.name)}</b><span class="pill">${esc(n.status)}</span></div><div class="small muted">Missing docs: ${n.missingCount}</div><div class="small">${esc(n.message)}</div></div>`)
      .join('') || '<div class="small muted">No notices.</div>';

  $('missingQueue').innerHTML =
    (state.dash.missing || [])
      .slice(0, 12)
      .map((m) => `<div class="warn"><b>${esc(m.name)}</b><div class="small muted">${esc(m.missing.join(', '))}</div></div>`)
      .join('') || '<div class="small muted">No missing docs.</div>';

  $('audit').innerHTML =
    (state.dash.audit || [])
      .map((a) => `<div class="item"><div class="small muted">${esc(a.at)}</div><div>${esc(a.action)} · ${esc(a.actor)}</div></div>`)
      .join('') || '<div class="small muted">No audit entries.</div>';
}

function renderNoticesPage() {
  const notices = buildNotices();
  $('noticeBoard').innerHTML =
    notices
      .map((n) => `<div class="item notice-${n.level}"><div class="row"><b>${esc(n.name)}</b><span class="pill">${esc(n.status)}</span></div><div class="small muted">Missing docs: ${n.missingCount}</div><div>${esc(n.message)}</div></div>`)
      .join('') || '<div class="small muted">No notices.</div>';
}

function renderSettingsPage() {
  const d = state.settings?.deadlines || {};
  if ($('taxSeasonStart')) $('taxSeasonStart').value = d.taxSeasonStart || '';
  if ($('taxSeasonEnd')) $('taxSeasonEnd').value = d.taxSeasonEnd || '';
}

function filteredClients() {
  const q = state.pickerQuery.trim().toLowerCase();
  if (!q) return [];
  return state.clients.filter((c) =>
    [c.name, c.status, c.entityType, c.assignedStaff, ...(c.identifiers || [])].join(' ').toLowerCase().includes(q)
  );
}

function renderPicker() {
  const rows = filteredClients();
  $('pickerResults').innerHTML =
    rows
      .slice(0, 30)
      .map((c) => `<div class="item"><div class="row"><b>${esc(c.name)}</b><span class="pill">${esc(c.status)}</span></div><div class="small muted">${esc(c.entityType)} · ${esc(c.assignedStaff || 'Unassigned')}</div><div class="row" style="margin-top:6px;"><button class="selectClientBtn" data-id="${esc(c.id)}" style="width:auto;">Select Client</button></div></div>`)
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
      state.fileManagerYear = null;
      state.fileManagerFolder = null;
      renderClientsPage();
    };
  });
}

function filesByYearAndFolder(client) {
  const byYear = new Map();
  for (const f of client.files || []) {
    if (f.internalOnly) continue;
    const year = String(f.taxYear || new Date().getFullYear());
    if (!byYear.has(year)) byYear.set(year, new Map());
    const folders = byYear.get(year);
    if (!folders.has(f.category)) folders.set(f.category, []);
    folders.get(f.category).push(f);
  }
  return byYear;
}

function normalizeFolderName(name) {
  const n = String(name || 'Misc');
  if (/w-?2/i.test(n)) return 'Intake/W2';
  if (/1099/i.test(n)) return 'Intake/1099';
  if (/k-?1/i.test(n)) return 'Intake/K1';
  if (/workpaper/i.test(n)) return 'Workpapers';
  if (/filed/i.test(n)) return 'Filed Returns';
  return n;
}

function renderClientFilesPage() {
  if (!state.selected) return;
  const byYear = filesByYearAndFolder(state.selected);
  const templateYears = (state.selected.taxYears || []).map(String);
  const currentYear = new Date().getFullYear();
  const lastTen = Array.from({ length: 11 }, (_, i) => String(currentYear - i));
  const yearSet = new Set([...templateYears, ...lastTen, ...Array.from(byYear.keys())]);
  const years = Array.from(yearSet).sort((a, b) => Number(b) - Number(a));

  const crumb = state.fileManagerYear
    ? (state.fileManagerFolder ? `Client Files / TaxYear${state.fileManagerYear} / ${state.fileManagerFolder}` : `Client Files / TaxYear${state.fileManagerYear}`)
    : 'Client Files / Tax year roots';
  $('fileManagerBreadcrumb').textContent = crumb;

  if (!state.fileManagerYear) {
    $('fileManagerFolders').style.display = 'block';
    $('fileManagerFiles').style.display = 'none';
    $('fileManagerFolders').innerHTML = years
      .map((y) => `<button class="folder-btn year-btn" data-year="${esc(y)}">📁 TaxYear${esc(y)}</button>`)
      .join('') || '<div class="small muted">No tax year roots yet.</div>';

    document.querySelectorAll('.year-btn').forEach((el) => {
      el.onclick = () => {
        state.fileManagerYear = el.getAttribute('data-year');
        state.fileManagerFolder = null;
        renderClientFilesPage();
      };
    });
    return;
  }

  const yearFoldersRaw = byYear.get(state.fileManagerYear) || new Map();
  const rolled = new Map();
  for (const [folder, files] of yearFoldersRaw.entries()) {
    const key = normalizeFolderName(folder);
    if (!rolled.has(key)) rolled.set(key, []);
    rolled.get(key).push(...files);
  }
  const defaultFolders = ['Intake/W2', 'Intake/1099', 'Intake/K1', 'Workpapers', 'Filed Returns', 'Misc'];
  for (const f of defaultFolders) if (!rolled.has(f)) rolled.set(f, []);
  const folderNames = Array.from(rolled.keys()).sort();

  if (!state.fileManagerFolder) {
    $('fileManagerFolders').style.display = 'block';
    $('fileManagerFiles').style.display = 'none';
    $('fileManagerFolders').innerHTML = `
      <button id="backToYearRootsBtn" style="width:auto;margin-bottom:8px;">← Back to tax year roots</button>
      ${folderNames.map((folder) => `<button class="folder-btn" data-folder="${esc(folder)}">📁 ${esc(folder)} (${rolled.get(folder).length})</button>`).join('')}
    `;

    $('backToYearRootsBtn').onclick = () => {
      state.fileManagerYear = null;
      renderClientFilesPage();
    };

    document.querySelectorAll('.folder-btn[data-folder]').forEach((el) => {
      el.onclick = () => {
        state.fileManagerFolder = el.getAttribute('data-folder');
        renderClientFilesPage();
      };
    });
    return;
  }

  const files = rolled.get(state.fileManagerFolder) || [];
  $('fileManagerFolders').style.display = 'none';
  $('fileManagerFiles').style.display = 'block';
  $('fileManagerFiles').innerHTML = `
    <button id="backToYearFoldersBtn" style="width:auto;margin-bottom:8px;">← Back to folders</button>
    ${files.length ? files.map((f) => `<div class="file-row"><div><b>${esc(f.originalName)}</b><div class="small muted">TaxYear${esc(f.taxYear || state.fileManagerYear)} • v${esc(f.version)} • ${esc(f.source)} • ${esc(f.uploadedAt || '')}</div></div><button class="viewFileBtn" data-id="${esc(f.id)}" style="width:auto;">View</button></div>`).join('') : '<div class="small muted">No files in this folder yet.</div>'}
  `;

  $('backToYearFoldersBtn').onclick = () => {
    state.fileManagerFolder = null;
    renderClientFilesPage();
  };

  document.querySelectorAll('.viewFileBtn').forEach((el) => {
    el.onclick = async () => {
      try {
        const id = el.getAttribute('data-id');
        const resp = await fetch(`/api/files/${encodeURIComponent(state.selected.id)}/${encodeURIComponent(id)}`, {
          headers: { 'x-user': 'Admin User', 'x-role': 'Admin' }
        });
        if (!resp.ok) throw new Error('Unable to load file');
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      } catch (e) {
        setError(e.message);
      }
    };
  });
}

function renderClientsPage() {
  renderPicker();

  const hasSelected = Boolean(state.selected);
  $('clientsSelectMode').style.display = hasSelected ? 'none' : 'grid';
  $('clientSelectedHeader').style.display = hasSelected ? 'block' : 'none';
  $('selectedPane').style.display = hasSelected ? 'grid' : 'none';

  if (!hasSelected) {
    $('clientFilesPage').style.display = 'none';
    return;
  }

  $('selectedClientName').textContent = state.selected.name;
  $('selectedClientMeta').textContent = `${state.selected.entityType} · ${state.selected.status} · ${state.selected.assignedStaff || 'Unassigned'}`;
  $('selTitle').textContent = state.selected.name;
  $('selInternal').textContent = `Internal ID: ${state.selected.clientInternalId}`;
  $('statusSelect').innerHTML = state.meta.statuses.map((s) => `<option ${s === state.selected.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
  $('folderSelect').innerHTML = state.meta.folders.map((f) => `<option>${esc(f)}</option>`).join('');
  const currentYear = new Date().getFullYear();
  const tenYears = Array.from({ length: 11 }, (_, i) => String(currentYear - i));
  const existingYears = (state.selected.taxYears || []).map(String);
  const yset = new Set([...existingYears, ...tenYears]);
  const sortedYears = Array.from(yset).sort((a,b)=>Number(b)-Number(a));
  $('uploadTaxYear').innerHTML = sortedYears.map((y) => `<option>${esc(y)}</option>`).join('');
  $('addTaxYearSelect').innerHTML = '<option value="">Select year to add</option>' + sortedYears
    .filter((y) => !existingYears.includes(String(y)))
    .map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
  $('reqYear').innerHTML = sortedYears.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
  $('checklist').innerHTML = (state.selected.checklist || []).map((i) => `<div class="row"><span>${esc(i.doc)}</span><b>${i.found ? '✓' : 'Missing'}</b></div>`).join('');
  setReqFeedback('');
  setTaxYearFeedback('');

  if ($('clientFilesPage').style.display === 'block') {
    renderClientFilesPage();
  }
}

function renderAll() {
  renderDashboard();
  renderClientsPage();
  renderNoticesPage();
  renderSettingsPage();
  renderNotifications();
}

async function refresh() {
  try {
    setError();
    const [meta, dash, clients, settings] = await Promise.all([
      jfetch('/api/meta'),
      jfetch('/api/admin/dashboard'),
      jfetch('/api/admin/clients?q='),
      jfetch('/api/admin/settings', { headers: HEADERS })
    ]);
    state.meta = meta;
    state.dash = dash;
    state.clients = clients;
    state.settings = settings;

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
      taxYear: $('uploadTaxYear').value,
      internalOnly: $('internalOnly').checked,
      source
    })
  });
  await refresh();
}

$('navDashboard').onclick = () => setView('dashboard');
$('navClients').onclick = () => setView('clients');
$('navNotices').onclick = () => setView('notices');
$('navSettings').onclick = () => setView('settings');

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

$('saveSettings').onclick = async () => {
  try {
    await jfetch('/api/admin/settings', {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        deadlines: {
          taxSeasonStart: $('taxSeasonStart').value,
          taxSeasonEnd: $('taxSeasonEnd').value
        }
      })
    });
    setSettingsFeedback('Settings saved.');
    await refresh();
  } catch (e) {
    setSettingsFeedback(e.message, false);
  }
};

$('addTaxYearBtn').onclick = async () => {
  try {
    const year = $('addTaxYearSelect').value;
    if (!year) return setTaxYearFeedback('Select a year to add.', false);
    await jfetch(`/api/admin/clients/${state.selectedId}/tax-years`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({ year })
    });
    setTaxYearFeedback(`TaxYear${year} added.`);
    await refresh();
  } catch (e) {
    setTaxYearFeedback(e.message, false);
  }
};

$('notifBell').onclick = () => {
  state.notifPanelOpen = !state.notifPanelOpen;
  if (state.notifPanelOpen) {
    for (const n of getClientUploadNotifications()) state.notifSeenIds.add(n.id);
  }
  renderNotifications();
};

$('sendReq').onclick = async () => {
  try {
    const year = $('reqYear').value;
    const docType = $('reqDocType').value;
    if (!year || !docType) return setReqFeedback('Select year and document type.', false);
    const text = `Please upload ${docType} for TaxYear ${year}.`;
    $('sendReq').disabled = true;
    await jfetch(`/api/admin/clients/${state.selectedId}/requests`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ text, priority: 'high', taxYear: year, docType })
    });
    setReqFeedback(`Request sent: ${docType} for TaxYear ${year}.`);
    await refresh();
  } catch (e) {
    setReqFeedback(e.message, false);
  } finally {
    $('sendReq').disabled = false;
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

$('returnToListBtn').onclick = () => {
  state.selected = null;
  state.selectedId = null;
  state.fileManagerYear = null;
  state.fileManagerFolder = null;
  $('clientFilesPage').style.display = 'none';
  renderClientsPage();
};

$('openClientFilesBtn').onclick = () => {
  if (!state.selected) return;
  state.fileManagerYear = null;
  state.fileManagerFolder = null;
  $('clientFilesPage').style.display = 'block';
  renderClientFilesPage();
};

$('closeClientFilesBtn').onclick = () => {
  $('clientFilesPage').style.display = 'none';
};

setView('dashboard');
document.addEventListener('click', (e) => {
  const panel = $('notifPanel');
  const bell = $('notifBell');
  if (!panel || !bell) return;
  if (state.notifPanelOpen && !panel.contains(e.target) && !bell.contains(e.target)) {
    state.notifPanelOpen = false;
    renderNotifications();
  }
});

setInterval(tickClock, 1000);
tickClock();
refresh();
