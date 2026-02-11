const state = { session: null, portalCode: '', theme: 'light', view: 'overview', fileFolder: null, popupDismissed: false, meta: null, questionnaire: {}, meetingRoom: '' };
const JITSI_BASE = 'https://jitsi.guildspeak.com';
const $ = (id) => document.getElementById(id);
const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
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
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function countdownDays(value) {
  if (!value) return '--';
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return '--';
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return String(Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24))));
}

function renderDeadlines() {
  const d = state.meta?.deadlines || {};
  const mappings = [
    ['seasonStart', d.taxSeasonStart],
    ['seasonEnd', d.taxSeasonEnd],
    ['q1', d.q1EstimateDue],
    ['q2', d.q2EstimateDue],
    ['q3', d.q3EstimateDue],
    ['q4', d.q4EstimateDue]
  ];
  for (const [k, v] of mappings) {
    const daysEl = $(`${k}Days`);
    const dateEl = $(`${k}Date`);
    if (daysEl) daysEl.textContent = countdownDays(v);
    if (dateEl) dateEl.textContent = formatDate(v);
  }
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
  show('clientViewDashboard', view === 'overview');
  show('clientViewRequests', view === 'requests');
  show('clientViewFiles', view === 'files');
  show('clientViewHistory', view === 'history');
  show('clientViewChecklist', view === 'checklist');
  show('clientViewMeeting', view === 'meeting');

  ['navClientDashboard', 'navClientFiles', 'historyBtn', 'meetingBtn'].forEach((id) => $(id)?.classList.remove('active'));
  if (view === 'overview') $('navClientDashboard')?.classList.add('active');
  if (view === 'files') $('navClientFiles')?.classList.add('active');
  if (['history', 'checklist'].includes(view)) $('historyBtn')?.classList.add('active');
  if (view === 'meeting') $('meetingBtn')?.classList.add('active');

  if (view === 'files') renderFileManager();
  if (view === 'meeting') renderMeeting();
}

function filesByFolder(files = []) {
  const grouped = new Map();
  for (const f of files) {
    if (!grouped.has(f.category)) grouped.set(f.category, []);
    grouped.get(f.category).push(f);
  }
  return grouped;
}


function questionnaireKey() {
  if (!state.session?.id) return '';
  return `nexus.portal.questionnaire.${state.session.id}`;
}

function loadQuestionnaireProgress() {
  const key = questionnaireKey();
  if (!key) {
    state.questionnaire = {};
    return;
  }
  try {
    state.questionnaire = JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch {
    state.questionnaire = {};
  }
}

function saveQuestionnaireProgress() {
  const key = questionnaireKey();
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(state.questionnaire)); } catch {}
}

function renderChecklistQuestionnaire() {
  const items = state.session?.checklist || [];
  $('checklist').innerHTML = items.length
    ? items.map((c, i) => {
      const checked = Boolean(state.questionnaire[c.doc]);
      return `<div class="check-item"><label><input class="checkToggle" type="checkbox" data-doc="${esc(c.doc)}" ${checked ? 'checked' : ''} /> ${esc(c.doc)}</label><div class="state">${checked ? 'Completed' : (c.found ? 'Received' : 'Needed')}</div></div>`;
    }).join('')
    : '<div class="muted">No checklist items.</div>';

  document.querySelectorAll('.checkToggle').forEach((el) => {
    el.onchange = () => {
      const doc = el.getAttribute('data-doc') || '';
      state.questionnaire[doc] = el.checked;
      saveQuestionnaireProgress();
      renderChecklistQuestionnaire();
    };
  });
}


function buildMeetingRoom() {
  if (!state.session?.id) return '';
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `nexus-${state.session.id}-${today}`;
}

function buildMeetingUrl() {
  const room = state.meetingRoom || buildMeetingRoom();
  if (!room) return '';
  return `${JITSI_BASE}/${encodeURIComponent(room)}`;
}

function renderMeeting() {
  if (!state.session) return;
  state.meetingRoom = buildMeetingRoom();
  const url = buildMeetingUrl();
  const frame = $('meetingFrame');
  if (frame && frame.src !== url) frame.src = url;
  if ($('meetingRoomLabel')) $('meetingRoomLabel').textContent = `Room: ${state.meetingRoom}`;
}

function renderSummary() {
  if (!state.session) {
    $('summaryGrid').style.display = 'none';
    return;
  }

  $('summaryGrid').style.display = 'grid';
  $('statusMetric').textContent = state.session.status;
  $('yearsMetric').textContent = state.session.taxYears.join(', ') || '-';
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
      await loadSession();
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
  $('clientLabel').textContent = String(state.session.name || 'NEXUS CLIENT').toUpperCase();
  $('homeSubtext').textContent = `${state.session.name} welcome center for document requests, secure file exchange, and status updates.`;
  $('status').innerHTML = `Status: <b>${esc(state.session.status)}</b>`;
  $('years').textContent = `Tax Years: ${state.session.taxYears.join(', ')}`;
  renderYearSelectors();

  const pendingRequests = (state.session.requests || []).filter((r) => !r.completed);
  $('requestsPreview').innerHTML = pendingRequests.length
    ? pendingRequests.slice(0, 4).map((r) => `<div class="file"><div>${esc(r.text)}</div><span class="pill">${esc(r.priority || 'normal')}</span></div>`).join('')
    : '<div class="muted">No active requests.</div>';

  const openRequests = (state.session.requests || []).filter((r) => !r.completed);
  $('requests').innerHTML = openRequests.length
    ? openRequests.map((r) => `
      <div class="request-card">
        <div class="row"><b>${esc(r.text)}</b><span class="pill">${esc(r.priority || 'normal')}</span></div>
        <div class="muted small">Pending upload</div>
        ${uploadInputHtml(r)}
      </div>
    `).join('')
    : '<div class="muted">No open document requests.</div>';

  $('recentFiles').innerHTML = (state.session.files || []).slice(0, 12).map((f) => `
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

  loadQuestionnaireProgress();
  renderChecklistQuestionnaire();
  bindRequestUploadInputs();
  renderFileManager();
  maybeShowRequestPopup();
}

async function loadSession() {
  try {
    setError('');
    if (!state.portalCode) {
      state.session = null;
      setError('No active portal session found. Please use your client login link.');
      render();
      return;
    }
    state.session = await jfetch(`/api/client/session?portalCode=${encodeURIComponent(state.portalCode)}`);
    try { localStorage.setItem('nexus.portal.code', state.portalCode); } catch {}
    state.popupDismissed = false;
    setError('');
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
$('clientUploadBtn').onclick = async () => {
  const file = $('clientFile').files?.[0];
  if (!file) return setUploadNotice('Select a file first.');
  setUploadNotice('Uploading...');
  await upload(file, 'client-upload');
  $('clientFile').value = '';
  setUploadNotice('Upload complete.');
  await loadSession();
};
$('clientUploadCancelBtn').onclick = () => {
  $('clientFile').value = '';
  setUploadNotice('Upload canceled.');
};

$('navClientDashboard').onclick = () => setView('overview');
$('navClientFiles').onclick = () => setView('files');
$('actionOpenRequests').onclick = () => setView('requests');
$('actionOpenFiles').onclick = () => setView('files');
$('actionMeeting').onclick = () => setView('meeting');
$('actionHistory').onclick = () => setView('history');
$('actionChecklist').onclick = () => setView('checklist');
$('meetingBtn').onclick = () => setView('meeting');
$('historyBtn').onclick = () => setView('history');
$('backHomeBtn').onclick = () => setView('overview');
$('submitQuestionnaireBtn').onclick = () => {
  saveQuestionnaireProgress();
  $('questionnaireNotice').textContent = 'Questionnaire progress saved. Your preparer will review your uploaded docs and answers.';
};
$('refreshMeetingBtn').onclick = () => {
  state.meetingRoom = '';
  renderMeeting();
};
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
state.portalCode = qpCode || (() => { try { return localStorage.getItem('nexus.portal.code') || ''; } catch { return ''; } })();
if (state.portalCode) { try { localStorage.setItem('nexus.portal.code', state.portalCode); } catch {} }


const savedTheme = (() => { try { return localStorage.getItem('nexus.portal.theme'); } catch { return null; } })();
applyTheme(savedTheme || 'light');
setView('overview');
loadMeta();
setInterval(renderDeadlines, 60_000);
loadSession();
