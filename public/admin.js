const HEADERS = { 'Content-Type': 'application/json', 'x-user': 'Admin User', 'x-role': 'Admin' };
const state = { meta: null, dash: null, clients: [], selected: null, selectedId: null };

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
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = msg;
}

function render() {
  if (state.dash) {
    $('kpis').innerHTML = [
      ['Active', state.dash.active], ['Total', state.dash.total], ['Filed', state.dash.filed], ['Extensions', state.dash.extensions]
    ].map(([k, v]) => `<div class="card"><div class="small">${esc(k)}</div><h2>${esc(v)}</h2></div>`).join('');

    $('missingQueue').innerHTML = (state.dash.missing || []).slice(0, 10).map((m) => `<div class="warn"><b>${esc(m.name)}</b><div class="small">${esc(m.missing.join(', '))}</div></div>`).join('') || '<div class="small">No missing docs.</div>';
    $('audit').innerHTML = (state.dash.audit || []).map((a) => `<div class="small">${esc(a.at)} • ${esc(a.action)} • ${esc(a.actor)}</div>`).join('');
  }

  $('clientList').innerHTML = (state.clients || []).map((c) => `
    <div class="item ${state.selectedId === c.id ? 'active' : ''}" data-id="${esc(c.id)}" data-code="${esc(c.portalCode)}">
      <div class="row"><b>${esc(c.name)}</b><span class="pill">${esc(c.status)}</span></div>
      <div class="small">Portal code: ${esc(c.portalCode)}</div>
      <div class="row" style="margin-top:6px;">
        <button class="manageBtn" data-id="${esc(c.id)}" style="width:auto; padding:6px 10px;">Manage</button>
        <button class="portalBtn" data-code="${esc(c.portalCode)}" style="width:auto; padding:6px 10px;">Portal</button>
      </div>
    </div>
  `).join('') || '<div class="small">No clients yet.</div>';

  document.querySelectorAll('.manageBtn').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      state.selectedId = el.getAttribute('data-id');
      await loadSelected();
      render();
    };
  });

  document.querySelectorAll('.portalBtn').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const code = el.getAttribute('data-code');
      window.location.href = `/portal?code=${encodeURIComponent(code)}&from=admin`;
    };
  });

  if (!state.selected) {
    $('selectedPane').style.display = 'none';
    return;
  }

  $('selectedPane').style.display = 'grid';
  $('selTitle').textContent = state.selected.name;
  $('selInternal').textContent = `Internal ID: ${state.selected.clientInternalId}`;

  $('statusSelect').innerHTML = state.meta.statuses.map((s) => `<option ${s === state.selected.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
  $('folderSelect').innerHTML = state.meta.folders.map((f) => `<option>${esc(f)}</option>`).join('');

  $('checklist').innerHTML = (state.selected.checklist || []).map((i) => `<div class="row"><span>${esc(i.doc)}</span><b>${i.found ? '✓' : 'Missing'}</b></div>`).join('');
  $('files').innerHTML = (state.selected.files || []).filter((f) => !f.internalOnly).map((f) => `<div class="item"><b>${esc(f.originalName)}</b><div class="small">${esc(f.category)} v${esc(f.version)} • ${esc(f.source)}</div></div>`).join('') || '<div class="small">No files yet.</div>';
}

async function refresh() {
  try {
    setError();
    const q = encodeURIComponent(($('search').value || '').trim());
    const [meta, dash, clients] = await Promise.all([
      jfetch('/api/meta'),
      jfetch('/api/admin/dashboard'),
      jfetch(`/api/admin/clients?q=${q}`)
    ]);
    state.meta = meta;
    state.dash = dash;
    state.clients = clients;
    if (!state.selectedId && clients[0]) state.selectedId = clients[0].id;
    if (state.selectedId) await loadSelected();
    render();
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
    method: 'POST', headers: HEADERS,
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

$('search').addEventListener('input', () => refresh());
$('createClient').onclick = async () => {
  try {
    await jfetch('/api/admin/clients', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        name: $('newName').value.trim(),
        entityType: $('newEntity').value,
        taxYears: $('newYears').value.split(',').map((s) => s.trim()).filter(Boolean),
        assignedStaff: $('newStaff').value.trim()
      })
    });
    $('newName').value = '';
    await refresh();
  } catch (e) { setError(e.message); }
};

$('statusSelect').onchange = async () => {
  try {
    await jfetch(`/api/admin/clients/${state.selectedId}/status`, { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ status: $('statusSelect').value }) });
    await refresh();
  } catch (e) { setError(e.message); }
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
    await jfetch(`/api/admin/clients/${state.selectedId}/requests`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: $('reqText').value, priority: 'high' }) });
    await refresh();
  } catch (e) { setError(e.message); }
};

$('saveNote').onclick = async () => {
  try {
    await jfetch(`/api/admin/clients/${state.selectedId}/notes`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ text: $('noteText').value }) });
    $('noteText').value = '';
    await refresh();
  } catch (e) { setError(e.message); }
};

refresh();
