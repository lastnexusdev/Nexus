const state = { session: null, portalCode: '' };
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

function setError(msg = '') { $('error').textContent = msg; }

function render() {
  if (!state.session) {
    $('sessionPane').style.display = 'none';
    return;
  }

  $('sessionPane').style.display = 'block';
  $('welcome').textContent = `Welcome, ${state.session.name}`;
  $('status').innerHTML = `Status: <b>${esc(state.session.status)}</b>`;
  $('years').textContent = `Tax Years: ${state.session.taxYears.join(', ')}`;

  $('requests').innerHTML = (state.session.requests || []).map((r) => `<div class="file"><div>${esc(r.text)}</div><div>${esc(r.priority)}</div></div>`).join('') || '<div class="small">No requests right now.</div>';
  $('files').innerHTML = (state.session.files || []).map((f) => `<div class="file"><div><b>${esc(f.originalName)}</b><div class="small">${esc(f.category)} v${esc(f.version)}</div></div><div>${esc(f.source)}</div></div>`).join('') || '<div class="small">No files yet.</div>';
  $('checklist').innerHTML = (state.session.checklist || []).map((c) => `<div class="file"><div>${esc(c.doc)}</div><div>${c.found ? 'Received' : 'Needed'}</div></div>`).join('');
}

async function signIn() {
  try {
    setError('');
    state.portalCode = $('portalCode').value.trim();
    if (!state.portalCode) return setError('Enter a portal code.');
    state.session = await jfetch(`/api/client/session?portalCode=${encodeURIComponent(state.portalCode)}`);
    render();
  } catch (e) {
    setError(e.message);
    state.session = null;
    render();
  }
}

async function upload(file, source = 'client-upload') {
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
        category: $('clientFolder').value,
        source
      })
    });
    await signIn();
  } catch (e) {
    setError(e.message);
  }
}

$('signIn').onclick = signIn;
$('clientFile').onchange = async (e) => {
  await upload(e.target.files[0], 'client-upload');
  e.target.value = '';
};

const params = new URLSearchParams(window.location.search);
const qpCode = params.get('code');
if (params.get('from') === 'admin') $('adminJump').style.display = 'block';
if (qpCode) {
  $('portalCode').value = qpCode;
  signIn();
}
