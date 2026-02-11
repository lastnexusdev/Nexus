const state = { session: null, portalCode: '', theme: 'light', view: 'overview', fileFolder: null, popupDismissed: false, meta: null };
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

function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.body.setAttribute('data-theme', state.theme);
  $('themeToggle').textContent = state.theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  try { localStorage.setItem('nexus.portal.theme', state.theme); } catch {}
}

function setError(msg = '') { $('error').textContent = msg; }

function setUploadNotice(msg = '') {
  $('clientUploadNotice').textContent = msg;
}

function formatDate(value) {
  if (!value) return '--';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function countdownText(value) {
  if (!value) return '--';
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return '--';
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`;
  if (days === 0) return 'Today';
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
}

function renderDeadlines() {
  const d = state.meta?.deadlines || {};
  $('startDateText').textContent = d.taxSeasonStart ? `Date: ${formatDate(d.taxSeasonStart)}` : 'Date: --';
  $('endDateText').textContent = d.taxSeasonEnd ? `Date: ${formatDate(d.taxSeasonEnd)}` : 'Date: --';
  $('startCountdown').textContent = countdownText(d.taxSeasonStart);
  $('endCountdown').textContent = countdownText(d.taxSeasonEnd);
}

async function loadMeta() {
  try {
    state.meta = await jfetch('/api/meta');
  } catch {
    state.meta = null;
  }
  renderDeadlines();
}

function setView(view) {
  state.view = view;
  $('clientViewDashboard').style.display = view === 'overview' ? 'block' : 'none';
  $('clientViewRequests').style.display = view === 'requests' ? 'block' : 'none';
  $('clientViewFiles').style.display = view === 'files' ? 'block' : 'none';

  ['navClientDashboard', 'navClientRequests', 'navClientFiles'].forEach((id) => $(id).classList.remove('active'));
  if (view === 'overview') $('navClientDashboard').classList.add('active');
  if (view === 'requests') $('navClientRequests').classList.add('active');
  if (view === 'files') $('navClientFiles').classList.add('active');

  if (view === 'files') renderFileManager();
}

function filesByFolder(files = []) {
  const grouped = new Map();
  for (const f of files) {
    if (!grouped.has(f.category)) grouped.set(f.category, []);
    grouped.get(f.category).push(f);
  }
  return grouped;
}

function renderSummary() {
  if (!state.session) {
    $('summary').textContent = 'Sign in to load your dashboard.';
    $('summaryGrid').style.display = 'none';
    return;
  }

  $('summary').textContent = 'Your return visibility at a glance.';
  $('summaryGrid').style.display = 'grid';
  $('statusMetric').textContent = state.session.status;
  $('yearsMetric').textContent = state.session.taxYears.join(', ');
  $('reqMetric').textContent = (state.session.requests || []).filter((r) => !r.completed).length;
  $('fileMetric').textContent = (state.session.files || []).length;
}

function getYearOptions() {
  const y = new Date().getFullYear();
  const base = Array.from({ length: 11 }, (_, i) => String(y - i));
  const fromSession = (state.session?.taxYears || []).map(String);
  return Array.from(new Set([...fromSession, ...base])).sort((a, b) => Number(b) - Number(a));
}

function renderYearSelectors() {
  const options = getYearOptions();
  $('clientTaxYear').innerHTML = options.map((y) => `<option value="${esc(y)}">TaxYear ${esc(y)}</option>`).join('');
}

function uploadInputHtml(request) {
  const reqId = request?.id || '';
  const reqYear = request?.taxYear || '';
  const years = getYearOptions();
  const yearOptions = years.map((y) => `<option value="${esc(y)}" ${String(y) === String(reqYear) ? 'selected' : ''}>TaxYear ${esc(y)}</option>`).join('');
  return `
    <div class="row" style="margin-top:8px; align-items:flex-end;">
      <select class="requestYear" data-request-id="${esc(reqId)}" style="width:auto;min-width:220px;">${yearOptions}</select>
      <input class="requestFile" data-request-id="${esc(reqId)}" type="file" style="width:auto;" />
      <button class="requestUploadBtn primary" data-request-id="${esc(reqId)}" style="width:auto;">Upload</button>
    </div>
    <div class="small muted requestUploadNotice" data-request-id="${esc(reqId)}"></div>
  `;
}

function requestNotice(reqId, text) {
  const el = document.querySelector(`.requestUploadNotice[data-request-id="${CSS.escape(reqId)}"]`);
  if (el) el.textContent = text;
}

function bindRequestUploadInputs() {
  document.querySelectorAll('.requestUploadBtn').forEach((el) => {
    el.onclick = async () => {
      const reqId = el.getAttribute('data-request-id') || '';
      const input = document.querySelector(`.requestFile[data-request-id="${CSS.escape(reqId)}"]`);
      const year = document.querySelector(`.requestYear[data-request-id="${CSS.escape(reqId)}"]`);
      if (!input?.files?.[0]) return requestNotice(reqId, 'Select a file first.');
      requestNotice(reqId, 'Uploading...');
      await upload(input.files[0], 'request-upload', 'Filed Returns', year?.value || '');
      input.value = '';
      if (reqId) {
        const ok = await markRequestComplete(reqId);
        if (!ok) requestNotice(reqId, 'Uploaded, but request still open.');
      }
      await signIn();
    };
  });

}

async function markRequestComplete(id) {
  if (!state.session) return false;
  try {
    const req = (state.session.requests || []).find((r) => r.id === id);
    if (!req) return false;
    await jfetch(`/api/client/${state.session.id}/requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalCode: state.portalCode, completed: true })
    });
    return true;
  } catch {
    return false;
  }
}

function renderFileManager() {
  if (!state.session) return;
  const grouped = filesByFolder(state.session.files || []);
  const folders = Array.from(grouped.keys()).sort();

  $('clientFilesBreadcrumb').textContent = state.fileFolder
    ? `My Files / ${state.fileFolder}`
    : 'My Files / folders';

  if (!state.fileFolder) {
    $('clientFolders').style.display = 'block';
    $('clientFiles').style.display = 'none';
    $('backToClientFolders').style.display = 'none';

    $('clientFolders').innerHTML = folders.length
      ? folders.map((folder) => `<button class="folder-btn" data-folder="${esc(folder)}">📁 ${esc(folder)} (${grouped.get(folder).length})</button>`).join('')
      : '<div class="muted">No files uploaded yet.</div>';

    document.querySelectorAll('.folder-btn').forEach((el) => {
      el.onclick = () => {
        state.fileFolder = el.getAttribute('data-folder');
        renderFileManager();
      };
    });
    return;
  }

  if (!grouped.has(state.fileFolder)) {
    state.fileFolder = null;
    return renderFileManager();
  }

  $('clientFolders').style.display = 'none';
  $('clientFiles').style.display = 'block';
  $('backToClientFolders').style.display = 'inline-block';

  const files = grouped.get(state.fileFolder) || [];
  $('clientFiles').innerHTML = files.length
    ? files.map((f) => `<div class="file"><div><b>${esc(f.originalName)}</b><div class="muted small">v${esc(f.version)} • ${esc(f.uploadedAt || '')}</div></div><button class="viewPortalFileBtn" data-id="${esc(f.id)}" style="width:auto;">View</button></div>`).join('')
    : '<div class="muted">No files in this folder.</div>';

  document.querySelectorAll('.viewPortalFileBtn').forEach((el) => {
    el.onclick = () => {
      const id = el.getAttribute('data-id');
      const u = `/api/files/${encodeURIComponent(state.session.id)}/${encodeURIComponent(id)}?portalCode=${encodeURIComponent(state.portalCode)}`;
      window.open(u, '_blank', 'noopener');
    };
  });
}

function maybeShowRequestPopup() {
  if (!state.session || state.popupDismissed) return;
  const pending = (state.session.requests || []).filter((r) => !r.completed);
  if (!pending.length) {
    $('requestPopup').style.display = 'none';
    return;
  }

  $('popupRequests').innerHTML = pending
    .slice(0, 6)
    .map((r) => `<div class="request-card"><div class="row"><b>${esc(r.text)}</b><span class="pill">${esc(r.priority || 'normal')}</span></div><div class="small muted">${esc(r.docType || 'Document')} · TaxYear ${esc(r.taxYear || '')}</div>${uploadInputHtml(r)}</div>`)
    .join('');

  $('requestPopup').style.display = 'grid';
  bindRequestUploadInputs();
}

function render() {
  renderDeadlines();
  renderSummary();
  if (!state.session) {
    $('sessionPane').style.display = 'none';
    $('requestPopup').style.display = 'none';
    return;
  }

  $('sessionPane').style.display = 'block';
  $('welcome').textContent = `Welcome, ${state.session.name}`;
  $('status').innerHTML = `Status: <b>${esc(state.session.status)}</b>`;
  $('years').textContent = `Tax Years: ${state.session.taxYears.join(', ')}`;
  renderYearSelectors();

  const pendingRequests = (state.session.requests || []).filter((r) => !r.completed);
  $('requestsPreview').innerHTML = pendingRequests.length
    ? pendingRequests.slice(0, 4).map((r) => `<div class="file"><div>${esc(r.text)}</div><span class="pill">${esc(r.priority || 'normal')}</span></div>`).join('')
    : '<div class="muted">No active requests.</div>';

  $('requests').innerHTML = (state.session.requests || []).length
    ? (state.session.requests || []).map((r) => `
      <div class="request-card">
        <div class="row"><b>${esc(r.text)}</b><span class="pill">${esc(r.priority || 'normal')}</span></div>
        <div class="muted small">${r.completed ? 'Completed' : 'Pending upload'}</div>
        ${r.completed ? '' : uploadInputHtml(r)}
      </div>
    `).join('')
    : '<div class="muted">No requests right now.</div>';

  $('recentFiles').innerHTML = (state.session.files || []).slice(0, 8).map((f) => `
    <div class="file">
      <div><b>${esc(f.originalName)}</b><div class="muted small">${esc(f.category)} · v${esc(f.version)}</div></div>
      <button class="viewPortalFileBtn" data-id="${esc(f.id)}" style="width:auto;">View</button>
    </div>
  `).join('') || '<div class="muted">No files yet.</div>';

  document.querySelectorAll('#recentFiles .viewPortalFileBtn').forEach((el) => {
    el.onclick = () => {
      const id = el.getAttribute('data-id');
      const u = `/api/files/${encodeURIComponent(state.session.id)}/${encodeURIComponent(id)}?portalCode=${encodeURIComponent(state.portalCode)}`;
      window.open(u, '_blank', 'noopener');
    };
  });

  bindRequestUploadInputs();

  $('checklist').innerHTML = (state.session.checklist || [])
    .map((c) => `<div class="file"><div>${esc(c.doc)}</div><div>${c.found ? 'Received' : 'Needed'}</div></div>`)
    .join('');

  renderFileManager();
  maybeShowRequestPopup();
}

async function signIn() {
  try {
    setError('');
    state.portalCode = $('portalCode').value.trim();
    if (!state.portalCode) return setError('Enter a portal code.');
    state.session = await jfetch(`/api/client/session?portalCode=${encodeURIComponent(state.portalCode)}`);
    state.popupDismissed = false;
    render();
  } catch (e) {
    setError(e.message);
    state.session = null;
    render();
  }
}

async function upload(file, source = 'client-upload', category = null, taxYear = null) {
  if (!file || !state.session) return;
  try {
    setError('');
    const base64 = await toBase64(file);
    await jfetch(`/api/client/${state.session.id}/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portalCode: state.portalCode,
        base64,
        originalName: file.name,
        category: category || 'Filed Returns',
        taxYear: taxYear || $('clientTaxYear').value,
        source
      })
    });
  } catch (e) {
    setError(e.message);
    throw e;
  }
}

$('themeToggle').onclick = () => applyTheme(state.theme === 'dark' ? 'light' : 'dark');
$('signIn').onclick = signIn;
$('clientUploadBtn').onclick = async () => {
  const file = $('clientFile').files?.[0];
  if (!file) return setUploadNotice('Select a file first.');
  setUploadNotice('Uploading...');
  await upload(file, 'client-upload');
  $('clientFile').value = '';
  setUploadNotice('Upload complete.');
  await signIn();
};
$('clientUploadCancelBtn').onclick = () => {
  $('clientFile').value = '';
  setUploadNotice('Upload canceled.');
};

$('navClientDashboard').onclick = () => setView('overview');
$('navClientRequests').onclick = () => setView('requests');
$('navClientFiles').onclick = () => setView('files');
$('closePopup').onclick = () => {
  state.popupDismissed = true;
  document.querySelectorAll('.requestFile').forEach((el) => { el.value = ''; });
  document.querySelectorAll('.requestUploadNotice').forEach((el) => { el.textContent = ''; });
  $('requestPopup').style.display = 'none';
};
$('backToClientFolders').onclick = () => {
  state.fileFolder = null;
  renderFileManager();
};

const params = new URLSearchParams(window.location.search);
const qpCode = params.get('code');
if (params.get('from') === 'admin') $('adminJump').style.display = 'block';
if (qpCode) {
  $('portalCode').value = qpCode;
}

const savedTheme = (() => { try { return localStorage.getItem('nexus.portal.theme'); } catch { return null; } })();
applyTheme(savedTheme || 'light');
setView('overview');
loadMeta();
setInterval(renderDeadlines, 60_000);
if (qpCode) signIn();
