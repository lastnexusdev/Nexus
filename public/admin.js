const HEADERS = { 'Content-Type': 'application/json', 'x-user': 'Admin User', 'x-role': 'Admin' };
const state = {
  meta: null,
  dash: null,
  clients: [],
  selected: null,
  selectedId: null,
  view: 'dashboard',
  pickerQuery: '',
  filters: { status: 'In Progress', entity: '', staff: '' },
  sortBy: 'status',
  sortDir: 'asc',
  page: 1,
  pageSize: 50,
  fileManagerYear: null,
  fileManagerFolder: null,
  notifPanelOpen: false,
  notifSeenIds: new Set(),
  settings: null
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function splitNameParts(raw = '') {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function clientNameParts(client = {}) {
  const fallback = splitNameParts(client.name || '');
  return {
    firstName: String(client.firstName || fallback.firstName || '').trim(),
    lastName: String(client.lastName || fallback.lastName || '').trim()
  };
}

function clientDisplayName(client = {}) {
  const { firstName, lastName } = clientNameParts(client);
  const full = `${firstName} ${lastName}`.trim();
  return full || String(client.businessName || client.name || 'Unnamed Client');
}

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
  const map = new Map((state.clients || []).map((c) => [c.id, clientDisplayName(c)]));
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
  if ($('q1EstimateDue')) $('q1EstimateDue').value = d.q1EstimateDue || '';
  if ($('q2EstimateDue')) $('q2EstimateDue').value = d.q2EstimateDue || '';
  if ($('q3EstimateDue')) $('q3EstimateDue').value = d.q3EstimateDue || '';
  if ($('q4EstimateDue')) $('q4EstimateDue').value = d.q4EstimateDue || '';
}

function filteredClients() {
  const q = state.pickerQuery.trim().toLowerCase();
  return state.clients.filter((c) => {
    const name = clientDisplayName(c);
    const haystack = [name, c.firstName, c.lastName, c.businessName, c.status, c.entityType, c.assignedStaff, ...(c.identifiers || [])]
      .join(' ')
      .toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (state.filters.status && c.status !== state.filters.status) return false;
    if (state.filters.entity && c.entityType !== state.filters.entity) return false;
    if (state.filters.staff && (c.assignedStaff || '') !== state.filters.staff) return false;
    return true;
  });
}

function populateClientFilters() {
  const statusEl = $('filterStatus');
  const entityEl = $('filterEntity');
  const staffEl = $('filterStaff');
  if (!statusEl || !entityEl || !staffEl) return;

  const statuses = Array.from(new Set((state.clients || []).map((c) => c.status).filter(Boolean))).sort();
  const entities = Array.from(new Set((state.clients || []).map((c) => c.entityType).filter(Boolean))).sort();
  const staff = Array.from(new Set((state.clients || []).map((c) => c.assignedStaff).filter(Boolean))).sort();

  statusEl.innerHTML = '<option value="">All Statuses</option>' + statuses.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  entityEl.innerHTML = '<option value="">All Entities</option>' + entities.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  staffEl.innerHTML = '<option value="">All Tax Pros</option>' + staff.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');

  statusEl.value = state.filters.status;
  entityEl.value = state.filters.entity;
  staffEl.value = state.filters.staff;
}

function clientRowTone(client) {
  const uploads = (state.dash?.audit || []).filter((a) => a.action === 'CLIENT_UPLOAD' && a.clientId === client.id);
  const hasUnseenUpload = uploads.some((a) => !state.notifSeenIds.has(a.id));
  if (hasUnseenUpload) return 'row-new-upload';
  if (['Filed', 'Archived'].includes(client.status)) return 'row-complete';
  if (client.status === 'In Progress') return 'row-in-progress';
  const missingMap = new Map((state.dash?.missing || []).map((m) => [m.id, m.missing.length]));
  const missingCount = missingMap.get(client.id) || 0;
  if (riskLevel(missingCount, client.status) === 'red') return 'row-at-risk';
  return '';
}

function statusChipClass(status) {
  const map = {
    'In Progress': 'status-chip--in-progress',
    'Missing Docs': 'status-chip--missing-docs',
    'Data Entry': 'status-chip--data-entry',
    'Review': 'status-chip--review',
    'Ready to File': 'status-chip--ready-to-file',
    'Filed': 'status-chip--filed',
    'Extended': 'status-chip--extended',
    'Archived': 'status-chip--archived'
  };
  return map[status] || 'status-chip--in-progress';
}

function sortClients(list) {
  const col = state.sortBy;
  const dir = state.sortDir === 'desc' ? -1 : 1;
  return list.slice().sort((a, b) => {
    let av, bv;
    if (col === 'firstName' || col === 'lastName') {
      av = clientNameParts(a)[col] || '';
      bv = clientNameParts(b)[col] || '';
    } else if (col === 'updatedAt') {
      av = a.updatedAt || a.createdAt || '';
      bv = b.updatedAt || b.createdAt || '';
      return dir * (av < bv ? -1 : av > bv ? 1 : 0);
    } else {
      av = String(a[col] || '');
      bv = String(b[col] || '');
    }
    return dir * String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
  });
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderPagination(totalRows) {
  const el = $('pagination');
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * state.pageSize + 1;
  const end = Math.min(state.page * state.pageSize, totalRows);

  if (totalRows <= state.pageSize) {
    el.innerHTML = `<span class="dt-page-info">Showing ${totalRows} of ${totalRows} clients</span>`;
    return;
  }

  let html = '';
  html += `<button class="dt-page-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>&laquo; Prev</button>`;

  const maxVisible = 7;
  let pages = [];
  if (totalPages <= maxVisible) {
    pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pages.push(1);
    let start = Math.max(2, state.page - 2);
    let end = Math.min(totalPages - 1, state.page + 2);
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
  }

  for (const p of pages) {
    if (p === '...') {
      html += `<span class="dt-page-info">...</span>`;
    } else {
      html += `<button class="dt-page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    }
  }

  html += `<button class="dt-page-btn" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>Next &raquo;</button>`;
  html += `<span class="dt-page-info">${start}-${end} of ${totalRows}</span>`;
  el.innerHTML = html;

  el.querySelectorAll('.dt-page-btn').forEach((btn) => {
    btn.onclick = () => {
      const v = btn.dataset.page;
      if (v === 'prev') state.page = Math.max(1, state.page - 1);
      else if (v === 'next') state.page = Math.min(totalPages, state.page + 1);
      else state.page = Number(v);
      renderFullClientList();
    };
  });
}

function renderStatusTabs() {
  const tabEl = $('statusTabs');
  if (!tabEl) return;
  const allClients = state.clients || [];
  const counts = {};
  for (const c of allClients) {
    counts[c.status] = (counts[c.status] || 0) + 1;
  }
  const statuses = Array.from(new Set(allClients.map((c) => c.status).filter(Boolean))).sort();
  const currentFilter = state.filters.status;

  let html = `<button class="dt-tab ${!currentFilter ? 'active' : ''}" data-status="">All <span class="dt-tab-count">${allClients.length}</span></button>`;
  for (const s of statuses) {
    html += `<button class="dt-tab ${currentFilter === s ? 'active' : ''}" data-status="${esc(s)}">${esc(s)} <span class="dt-tab-count">${counts[s] || 0}</span></button>`;
  }
  tabEl.innerHTML = html;

  tabEl.querySelectorAll('.dt-tab').forEach((btn) => {
    btn.onclick = () => {
      state.filters.status = btn.dataset.status;
      state.page = 1;
      if ($('filterStatus')) $('filterStatus').value = btn.dataset.status;
      renderClientsPage();
    };
  });
}

function renderFullClientList() {
  populateClientFilters();
  renderStatusTabs();
  const sorted = sortClients(filteredClients());
  const totalRows = sorted.length;

  // Paginate
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const pageStart = (state.page - 1) * state.pageSize;
  const rows = sorted.slice(pageStart, pageStart + state.pageSize);

  $('fullClientList').innerHTML = rows.length
    ? rows.map((c) => {
      const parts = clientNameParts(c);
      return `<tr class="${clientRowTone(c)}" data-client-id="${esc(c.id)}" style="cursor:pointer">
        <td><span class="status-chip ${statusChipClass(c.status)}">${esc(c.status)}</span></td>
        <td>${esc(parts.firstName || '-')}</td>
        <td>${esc(parts.lastName || '-')}</td>
        <td>${esc(c.email || '-')}</td>
        <td>${esc(c.assignedStaff || 'Unassigned')}</td>
        <td>${esc(c.entityType)}</td>
        <td class="dt-actions-cell"><div class="dt-actions"><button class="dt-act-btn dt-act-edit selectClientRowBtn" data-id="${esc(c.id)}">Edit</button><button class="dt-act-btn dt-act-del deleteClientBtn" data-id="${esc(c.id)}">Delete</button></div></td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="7" class="small muted" style="text-align:center;padding:28px;">No clients match the current filters.</td></tr>';

  // Update sort header indicators
  document.querySelectorAll('.dt-sortable').forEach((th) => {
    th.dataset.dir = th.dataset.col === state.sortBy ? state.sortDir : '';
  });

  // Pagination
  renderPagination(totalRows);

  // Edit button handlers
  document.querySelectorAll('.selectClientRowBtn').forEach((el) => {
    el.onclick = async () => {
      state.selectedId = el.getAttribute('data-id');
      await loadSelected();
      state.fileManagerYear = null;
      state.fileManagerFolder = null;
      renderClientsPage();
    };
  });

  // Delete button handlers
  document.querySelectorAll('.deleteClientBtn').forEach((el) => {
    el.onclick = async () => {
      const id = el.getAttribute('data-id');
      const client = state.clients.find((c) => c.id === id);
      const name = client ? clientDisplayName(client) : 'this client';
      if (!confirm(`Are you sure you want to delete ${name}?`)) return;
      try {
        await jfetch(`/api/admin/clients/${id}`, { method: 'DELETE', headers: HEADERS });
        if (state.selectedId === id) {
          state.selected = null;
          state.selectedId = null;
        }
        await refresh();
      } catch (e) {
        setError(e.message);
      }
    };
  });

  // Double-click row to open client
  $('fullClientList').querySelectorAll('tr[data-client-id]').forEach((row) => {
    row.ondblclick = async () => {
      state.selectedId = row.dataset.clientId;
      await loadSelected();
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
  const years = Array.from(byYear.keys()).sort((a, b) => Number(b) - Number(a));

  const crumb = state.fileManagerYear
    ? (state.fileManagerFolder ? `Client Files / TaxYear${state.fileManagerYear} / ${state.fileManagerFolder}` : `Client Files / TaxYear${state.fileManagerYear}`)
    : 'Client Files / Tax year roots';
  $('fileManagerBreadcrumb').textContent = crumb;

  if (!state.fileManagerYear) {
    $('fileManagerFolders').style.display = 'block';
    $('fileManagerFiles').style.display = 'none';
    $('fileManagerFolders').innerHTML = years.length
      ? years.map((y) => `<button class="folder-btn year-btn" data-year="${esc(y)}">📁 TaxYear${esc(y)}</button>`).join('')
      : '<div class="small muted">No folders with files yet.</div>'; 

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
  if (!byYear.has(state.fileManagerYear)) {
    state.fileManagerYear = null;
    state.fileManagerFolder = null;
    return renderClientFilesPage();
  }
  const rolled = new Map();
  for (const [folder, files] of yearFoldersRaw.entries()) {
    const key = normalizeFolderName(folder);
    if (!rolled.has(key)) rolled.set(key, []);
    rolled.get(key).push(...files);
  }
  const folderNames = Array.from(rolled.entries())
    .filter(([, files]) => files.length > 0)
    .map(([folder]) => folder)
    .sort();

  if (!state.fileManagerFolder) {
    $('fileManagerFolders').style.display = 'block';
    $('fileManagerFiles').style.display = 'none';
    $('fileManagerFolders').innerHTML = `
      <button id="backToYearRootsBtn" style="width:auto;margin-bottom:8px;">← Back to tax year roots</button>
      ${folderNames.length
        ? folderNames.map((folder) => `<button class="folder-btn" data-folder="${esc(folder)}">📁 ${esc(folder)} (${rolled.get(folder).length})</button>`).join('')
        : '<div class="small muted">No folders with files in this tax year.</div>'}
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

  if (!rolled.has(state.fileManagerFolder)) {
    state.fileManagerFolder = null;
    return renderClientFilesPage();
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
  renderFullClientList();

  const hasSelected = Boolean(state.selected);
  $('clientsSelectMode').style.display = hasSelected ? 'none' : 'block';
  $('clientSelectedHeader').style.display = hasSelected ? 'block' : 'none';
  $('selectedPane').style.display = hasSelected ? 'grid' : 'none';

  if (!hasSelected) {
    $('clientFilesPage').style.display = 'none';
    return;
  }

  $('selectedClientName').textContent = clientDisplayName(state.selected);
  $('selectedClientMeta').textContent = `${state.selected.entityType} · ${state.selected.status} · ${state.selected.assignedStaff || 'Unassigned'}`;
  $('selTitle').textContent = clientDisplayName(state.selected);
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
  state.page = 1;
  renderClientsPage();
});

$('filterEntity').onchange = (e) => {
  state.filters.entity = e.target.value;
  state.page = 1;
  renderClientsPage();
};

$('filterStaff').onchange = (e) => {
  state.filters.staff = e.target.value;
  state.page = 1;
  renderClientsPage();
};

$('clearFilters').onclick = () => {
  state.filters = { status: '', entity: '', staff: '' };
  state.pickerQuery = '';
  state.page = 1;
  $('search').value = '';
  renderClientsPage();
};

function applySort(column) {
  if (state.sortBy === column) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortBy = column;
    state.sortDir = 'asc';
  }
  state.page = 1;
  renderClientsPage();
}

document.querySelectorAll('.dt-sortable').forEach((th) => {
  th.onclick = () => applySort(th.dataset.col);
  th.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      applySort(th.dataset.col);
    }
  };
});

// Add Client modal
$('addClientBtn').onclick = () => {
  $('addClientModal').style.display = 'flex';
};
$('closeAddClient').onclick = () => {
  $('addClientModal').style.display = 'none';
};
$('addClientModal').onclick = (e) => {
  if (e.target === $('addClientModal')) $('addClientModal').style.display = 'none';
};

$('createClient').onclick = async () => {
  try {
    await jfetch('/api/admin/clients', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        firstName: $('newFirstName').value.trim(),
        lastName: $('newLastName').value.trim(),
        entityType: $('newEntity').value,
        email: $('newEmail').value.trim(),
        assignedStaff: $('newStaff').value.trim()
      })
    });
    $('newFirstName').value = '';
    $('newLastName').value = '';
    $('newEmail').value = '';
    $('newStaff').value = '';
    $('addClientModal').style.display = 'none';
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
          taxSeasonEnd: $('taxSeasonEnd').value,
          q1EstimateDue: $('q1EstimateDue').value,
          q2EstimateDue: $('q2EstimateDue').value,
          q3EstimateDue: $('q3EstimateDue').value,
          q4EstimateDue: $('q4EstimateDue').value
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
