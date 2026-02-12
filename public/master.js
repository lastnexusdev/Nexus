const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { view: 'overview', stats: null, orgs: [], selectedOrg: null, selectedOrgUsers: [] };

function getToken() { return localStorage.getItem('nexus.token') || ''; }
function authHeaders(extra = {}) {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...extra };
}

async function jfetch(url, options = {}) {
  if (!options.headers) options.headers = authHeaders();
  const res = await fetch(url, options);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('nexus.token');
    localStorage.removeItem('nexus.user');
    window.location.href = '/';
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setError(msg) {
  const el = $('error');
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = msg;
}

function setView(view) {
  state.view = view;
  $('viewOverview').style.display = view === 'overview' ? 'block' : 'none';
  $('viewOrgs').style.display = view === 'orgs' ? 'block' : 'none';
  $('navOverview').classList.toggle('active', view === 'overview');
  $('navOrgs').classList.toggle('active', view === 'orgs');
  $('topTitle').textContent = view === 'overview' ? 'Overview' : 'Organizations';
}

function renderKpis() {
  if (!state.stats) return;
  $('kpis').innerHTML = [
    ['Organizations', state.stats.totalOrgs],
    ['Total Staff', state.stats.totalUsers],
    ['Total Clients', state.stats.totalClients]
  ].map(([l, v]) => `<div class="kpi"><div class="l">${esc(l)}</div><div class="v">${esc(v)}</div></div>`).join('');
}

function renderOrgOverview() {
  if (!state.stats) return;
  const orgs = state.stats.orgs || [];
  $('orgOverviewList').innerHTML = orgs.length
    ? orgs.map((o) => `<div class="org-item" data-id="${esc(o.id)}"><div class="row"><h4>${esc(o.name)}</h4><span class="pill">${esc(o.slug)}</span></div><div class="meta">${o.userCount} staff · ${o.clientCount} clients · Created ${esc(o.createdAt?.slice(0, 10) || '')}</div></div>`).join('')
    : '<div class="small muted">No organizations yet.</div>';
}

function renderOrgList() {
  const orgs = state.orgs || [];
  $('orgList').innerHTML = orgs.length
    ? orgs.map((o) => `<div class="org-item" data-id="${esc(o.id)}"><div class="row"><h4>${esc(o.name)}</h4><span class="pill">${esc(o.slug)}</span></div><div class="meta">${o.userCount} staff · ${o.clientCount} clients · Created ${esc(o.createdAt?.slice(0, 10) || '')}</div></div>`).join('')
    : '<div class="small muted">No organizations yet.</div>';

  document.querySelectorAll('.org-item[data-id]').forEach((el) => {
    el.onclick = () => selectOrg(el.dataset.id);
  });
}

async function selectOrg(id) {
  const org = state.orgs.find((o) => o.id === id);
  if (!org) return;
  state.selectedOrg = org;
  try {
    state.selectedOrgUsers = await jfetch(`/api/master/orgs/${id}/users`);
  } catch { state.selectedOrgUsers = []; }
  renderOrgDetail();
}

function renderOrgDetail() {
  const org = state.selectedOrg;
  if (!org) {
    $('orgDetailPanel').style.display = 'none';
    return;
  }
  $('orgDetailPanel').style.display = 'block';
  $('orgDetailName').textContent = org.name;
  $('orgDetailMeta').textContent = `Slug: ${org.slug} · ID: ${org.id} · Created: ${org.createdAt?.slice(0, 10) || ''}`;

  $('orgUsersList').innerHTML = state.selectedOrgUsers.length
    ? state.selectedOrgUsers.map((u) => `<div class="org-item" style="cursor:default;"><div class="row"><b>${esc(u.name)}</b><span class="pill">${esc(u.role)}</span></div><div class="meta">${esc(u.email)}</div></div>`).join('')
    : '<div class="small muted">No users in this organization.</div>';

  $('openOrgAdmin').onclick = () => {
    window.open(`/org/${org.slug}/admin`, '_blank');
  };
}

async function refresh() {
  try {
    setError('');
    const [stats, orgs] = await Promise.all([
      jfetch('/api/master/stats'),
      jfetch('/api/master/orgs')
    ]);
    state.stats = stats;
    state.orgs = orgs;
    renderKpis();
    renderOrgOverview();
    renderOrgList();
    if (state.selectedOrg) {
      const updated = orgs.find((o) => o.id === state.selectedOrg.id);
      if (updated) { state.selectedOrg = updated; renderOrgDetail(); }
      else { state.selectedOrg = null; $('orgDetailPanel').style.display = 'none'; }
    }
  } catch (e) {
    setError(e.message);
  }
}

$('navOverview').onclick = () => setView('overview');
$('navOrgs').onclick = () => setView('orgs');

$('showCreateOrg').onclick = () => {
  $('createOrgForm').style.display = 'block';
  $('orgName').focus();
};
$('cancelCreateOrg').onclick = () => {
  $('createOrgForm').style.display = 'none';
};

$('createOrgBtn').onclick = async () => {
  const fb = $('createOrgFeedback');
  fb.textContent = '';
  try {
    const data = await jfetch('/api/master/orgs', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: $('orgName').value.trim(),
        slug: $('orgSlug').value.trim(),
        adminName: $('orgAdminName').value.trim(),
        adminEmail: $('orgAdminEmail').value.trim(),
        adminPassword: $('orgAdminPw').value || 'admin'
      })
    });
    fb.style.color = '#2f7d32';
    fb.textContent = `Organization "${data.org.name}" created. Admin: ${data.admin.email}`;
    $('orgName').value = '';
    $('orgSlug').value = '';
    $('orgAdminName').value = '';
    $('orgAdminEmail').value = '';
    $('orgAdminPw').value = 'admin';
    await refresh();
  } catch (e) {
    fb.style.color = '#a12e2e';
    fb.textContent = e.message;
  }
};

$('deleteOrgBtn').onclick = async () => {
  if (!state.selectedOrg) return;
  if (!confirm(`Delete organization "${state.selectedOrg.name}"?\n\nThis will remove ALL users, clients, and data in this organization. This cannot be undone.`)) return;
  try {
    await jfetch(`/api/master/orgs/${state.selectedOrg.id}`, { method: 'DELETE', headers: authHeaders() });
    state.selectedOrg = null;
    $('orgDetailPanel').style.display = 'none';
    await refresh();
  } catch (e) {
    setError(e.message);
  }
};

$('closeOrgDetail').onclick = () => {
  state.selectedOrg = null;
  $('orgDetailPanel').style.display = 'none';
};

$('addUserBtn').onclick = async () => {
  if (!state.selectedOrg) return;
  const fb = $('addUserFeedback');
  fb.textContent = '';
  try {
    await jfetch(`/api/master/orgs/${state.selectedOrg.id}/users`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: $('addUserName').value.trim(),
        email: $('addUserEmail').value.trim(),
        password: $('addUserPw').value || 'changeme',
        role: $('addUserRole').value
      })
    });
    $('addUserName').value = '';
    $('addUserEmail').value = '';
    $('addUserPw').value = 'changeme';
    fb.style.color = '#2f7d32';
    fb.textContent = 'User added.';
    await selectOrg(state.selectedOrg.id);
    await refresh();
  } catch (e) {
    fb.style.color = '#a12e2e';
    fb.textContent = e.message;
  }
};

$('logoutBtn').onclick = () => {
  localStorage.removeItem('nexus.token');
  localStorage.removeItem('nexus.user');
  window.location.href = '/';
};

// Init - check auth
const token = getToken();
if (!token) { window.location.href = '/'; }
else {
  fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
    .then((r) => r.json())
    .then((data) => {
      if (!data.user || data.user.role !== 'SuperAdmin') {
        window.location.href = '/';
        return;
      }
      $('footerName').textContent = data.user.name;
      $('topUser').textContent = data.user.name;
      refresh();
    })
    .catch(() => { window.location.href = '/'; });
}
