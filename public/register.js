const $ = (id) => document.getElementById(id);

// Extract org slug and invite token from URL
// URL format: /org/{slug}/register?invite={token}
const pathParts = window.location.pathname.split('/');
const slugIdx = pathParts.indexOf('org');
const orgSlug = slugIdx >= 0 ? pathParts[slugIdx + 1] : '';
const params = new URLSearchParams(window.location.search);
const inviteToken = params.get('invite') || '';

function setError(msg) {
  const el = $('error');
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = 'block';
  el.textContent = msg;
}

// Validate invite
async function validateInvite() {
  if (!orgSlug || !inviteToken) {
    $('validating').style.display = 'none';
    $('invalidInvite').style.display = 'block';
    return;
  }
  try {
    const resp = await fetch(`/api/org/${orgSlug}/invite/validate?token=${encodeURIComponent(inviteToken)}`);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Invalid invite');

    $('validating').style.display = 'none';
    $('regForm').style.display = 'block';
    $('orgLabel').textContent = `Register with ${data.orgName}`;
    if (data.email) $('email').value = data.email;
  } catch {
    $('validating').style.display = 'none';
    $('invalidInvite').style.display = 'block';
  }
}

$('registerBtn').onclick = async () => {
  setError('');
  const firstName = $('firstName').value.trim();
  const lastName = $('lastName').value.trim();
  const email = $('email').value.trim();
  const entityType = $('entityType').value;

  if (!firstName || !lastName || !email) return setError('All fields are required.');

  $('registerBtn').disabled = true;
  $('registerBtn').textContent = 'Registering...';
  try {
    const resp = await fetch(`/api/org/${orgSlug}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken, firstName, lastName, email, entityType })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Registration failed');

    $('regForm').style.display = 'none';
    $('successPane').style.display = 'block';
    $('successName').textContent = data.clientName;
    $('portalCode').textContent = data.portalCode;

    $('goToPortal').onclick = () => {
      window.location.href = `/org/${orgSlug}/portal?code=${encodeURIComponent(data.portalCode)}`;
    };
  } catch (e) {
    setError(e.message);
  } finally {
    $('registerBtn').disabled = false;
    $('registerBtn').textContent = 'Register';
  }
};

validateInvite();
