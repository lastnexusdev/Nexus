const $ = (id) => document.getElementById(id);

function setError(msg) {
  const el = $('error');
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = msg;
}

$('loginBtn').onclick = async () => {
  setError('');
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return setError('Email and password are required.');

  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Signing in...';
  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Login failed');

    localStorage.setItem('nexus.token', data.token);
    localStorage.setItem('nexus.user', JSON.stringify(data.user));

    if (data.user.role === 'SuperAdmin') {
      window.location.href = '/master';
    } else if (data.orgSlug) {
      window.location.href = `/org/${data.orgSlug}/admin`;
    } else {
      setError('No organization assigned.');
    }
  } catch (e) {
    setError(e.message);
  } finally {
    $('loginBtn').disabled = false;
    $('loginBtn').textContent = 'Sign In';
  }
};

$('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('loginBtn').click();
});
$('email').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('password').focus();
});

// If already logged in, redirect
const token = localStorage.getItem('nexus.token');
if (token) {
  fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
    .then((r) => r.json())
    .then((data) => {
      if (data.user) {
        if (data.user.role === 'SuperAdmin') window.location.href = '/master';
        else if (data.orgSlug) window.location.href = `/org/${data.orgSlug}/admin`;
      }
    })
    .catch(() => {});
}
