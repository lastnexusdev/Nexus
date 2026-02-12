import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const storageDir = path.join(__dirname, 'storage');
const dbPath = path.join(dataDir, 'db.json');

const STATUS = ['In Progress', 'Missing Docs', 'Data Entry', 'Review', 'Ready to File', 'Filed', 'Extended', 'Archived'];
const DEFAULT_FOLDERS = ['Intake', 'Prior Year/2025', 'Prior Year/2024', 'Current Year/W2s', 'Current Year/1099s', 'Current Year/K-1s', 'Workpapers', 'Filed Returns', 'Misc'];
const REQUIRED = {
  '1040': ['Questionnaire', 'ID', 'W-2', '1099'],
  '1120': ['Questionnaire', 'ID', 'Trial Balance'],
  '1120S': ['Questionnaire', 'ID', 'K-1', 'Trial Balance'],
  '1065': ['Questionnaire', 'ID', 'K-1', 'Balance Sheet'],
  default: ['Questionnaire', 'ID']
};

/* ============ Helpers ============ */
function hashPw(pw) { return crypto.createHash('sha256').update(String(pw)).digest('hex'); }
function genToken() { return crypto.randomBytes(32).toString('hex'); }
function splitNameParts(raw = '') {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
function displayName(client = {}) {
  const first = String(client.firstName || '').trim();
  const last = String(client.lastName || '').trim();
  const full = `${first} ${last}`.trim();
  return full || String(client.businessName || client.name || '');
}
function addAudit(db, orgId, evt) {
  if (!Array.isArray(db.audit)) db.audit = [];
  db.audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), orgId, ...evt });
}
function sanitize(name) { return String(name || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_'); }
function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  const map = { '.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.txt':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8','.json':'application/json' };
  return map[ext] || 'application/octet-stream';
}
function computeChecklist(client) {
  const docs = REQUIRED[client.entityType] || REQUIRED.default;
  return docs.map((d) => ({ doc: d, found: client.files.some((f) => (f.originalName || '').toLowerCase().includes(d.toLowerCase().replace(/[^a-z0-9]/gi, ''))) }));
}

/* ============ DB ============ */
function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    const masterToken = genToken();
    const demoOrgId = 'org-demo';
    const demoAdminToken = genToken();
    fs.writeFileSync(dbPath, JSON.stringify({
      orgs: [{
        id: demoOrgId, name: 'Demo Tax Firm', slug: 'demo',
        createdAt: new Date().toISOString(),
        settings: { deadlines: defaultDeadlines() }
      }],
      users: [
        { id: 'u-master', orgId: null, name: 'Super Admin', email: 'super@nexus.com', password: hashPw('admin'), role: 'SuperAdmin', token: masterToken },
        { id: 'u-demo-admin', orgId: demoOrgId, name: 'Admin User', email: 'admin@demo.com', password: hashPw('admin'), role: 'OrgAdmin', token: demoAdminToken },
        { id: 'u-demo-staff', orgId: demoOrgId, name: 'Staff User', email: 'staff@demo.com', password: hashPw('staff'), role: 'Staff', token: genToken() }
      ],
      clients: [],
      invites: [],
      audit: []
    }, null, 2));
    console.log(`Default master login: super@nexus.com / admin`);
    console.log(`Default org admin login: admin@demo.com / admin  (org: demo)`);
  }
}

function defaultDeadlines() {
  const y = new Date().getFullYear();
  return { taxSeasonStart:`${y}-01-15`, taxSeasonEnd:`${y}-04-15`, q1EstimateDue:`${y}-04-15`, q2EstimateDue:`${y}-06-15`, q3EstimateDue:`${y}-09-15`, q4EstimateDue:`${y+1}-01-15` };
}

function normalizeDbShape(db) {
  if (!db || typeof db !== 'object') db = {};
  if (!Array.isArray(db.orgs)) db.orgs = [];
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.clients)) db.clients = [];
  if (!Array.isArray(db.invites)) db.invites = [];
  if (!Array.isArray(db.audit)) db.audit = Array.isArray(db.auditLog) ? db.auditLog : [];

  // Migrate legacy clients without orgId - assign to first org
  const firstOrg = db.orgs[0];
  for (const client of db.clients) {
    if (!client.orgId && firstOrg) client.orgId = firstOrg.id;
    if (!Array.isArray(client.files)) client.files = [];
    if (!Array.isArray(client.notes)) client.notes = [];
    if (!Array.isArray(client.docRequests)) client.docRequests = [];
    if (!Array.isArray(client.events)) client.events = [];
    if (!Array.isArray(client.taxYears)) client.taxYears = [];
    const nameParts = splitNameParts(client.name || client.businessName || '');
    if (typeof client.firstName !== 'string') client.firstName = nameParts.firstName;
    if (typeof client.lastName !== 'string') client.lastName = nameParts.lastName;
    client.firstName = String(client.firstName || '').trim();
    client.lastName = String(client.lastName || '').trim();
    client.name = displayName(client);
    if (!client.status) client.status = 'In Progress';
    if (client.status === 'Intake Received') client.status = 'In Progress';
    if (!client.entityType) client.entityType = '1040';
    if (typeof client.email !== 'string') client.email = '';
    client.email = String(client.email || '').trim();
    if (!client.portalCode) client.portalCode = `portal-${Math.random().toString(36).slice(2, 8)}`;
  }
  // Ensure user fields
  for (const user of db.users) {
    if (typeof user.email !== 'string') user.email = '';
    if (typeof user.name !== 'string') user.name = '';
    if (typeof user.role !== 'string') user.role = 'Staff';
  }
  // Ensure org settings
  for (const org of db.orgs) {
    if (!org.settings) org.settings = {};
    if (!org.settings.deadlines) org.settings.deadlines = defaultDeadlines();
  }
  return db;
}

function loadDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const normalized = normalizeDbShape(db);
  fs.writeFileSync(dbPath, JSON.stringify(normalized, null, 2));
  return normalized;
}
function saveDb(db) { fs.writeFileSync(dbPath, JSON.stringify(normalizeDbShape(db), null, 2)); }

/* ============ HTTP helpers ============ */
function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 30_000_000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function parseRawBody(req, maxSize = 100_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > maxSize) { req.destroy(); reject(new Error('Upload too large')); } chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ============ Auth ============ */
function authenticate(req, db) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['x-token'] || '');
  if (!token) return null;
  return db.users.find((u) => u.token === token) || null;
}

/* ============ File Storage ============ */
function writeBase64File(clientId, folder, fileName, base64) {
  const dir = path.join(storageDir, clientId, folder);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, fileName);
  if (!path.normalize(full).startsWith(path.normalize(path.join(storageDir, clientId)))) throw new Error('Invalid path');
  const clean = (base64 || '').replace(/^data:.*;base64,/, '');
  fs.writeFileSync(full, Buffer.from(clean, 'base64'));
}
function safeClientFilePath(clientId, category, storedName) {
  const target = path.normalize(path.join(storageDir, clientId, category, storedName));
  const root = path.normalize(path.join(storageDir, clientId));
  if (!target.startsWith(root)) throw new Error('Invalid file path');
  return target;
}

/* ============ ZIP ============ */
function buildZip(entries) {
  const localHeaders = []; const centralHeaders = []; let offset = 0;
  for (const { name, data } of entries) {
    const nameB = Buffer.from(name, 'utf8'); const crc = crc32(data);
    const lh = Buffer.alloc(30 + nameB.length);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28); nameB.copy(lh, 30);
    localHeaders.push(Buffer.concat([lh, data]));
    const ch = Buffer.alloc(46 + nameB.length);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42); nameB.copy(ch, 46); centralHeaders.push(ch);
    offset += lh.length + data.length;
  }
  const centralBuf = Buffer.concat(centralHeaders);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localHeaders, centralBuf, eocd]);
}
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); } return (c ^ 0xFFFFFFFF) >>> 0; }
function collectClientFiles(clientId) {
  const entries = []; const clientDir = path.join(storageDir, clientId);
  if (!fs.existsSync(clientDir)) return entries;
  (function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else entries.push({ name: `files/${rel}`, data: fs.readFileSync(path.join(dir, entry.name)) });
    }
  })(clientDir, '');
  return entries;
}
function readZip(buf) {
  const entries = []; let eocdOff = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break; } }
  if (eocdOff < 0) throw new Error('Not a valid ZIP file');
  const cdOffset = buf.readUInt32LE(eocdOff + 16); const cdCount = buf.readUInt16LE(eocdOff + 10);
  let pos = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(pos + 28); const extraLen = buf.readUInt16LE(pos + 30); const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42); const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26); const lExtraLen = buf.readUInt16LE(localOff + 28);
    const compSize = buf.readUInt32LE(localOff + 18); const dataStart = localOff + 30 + lNameLen + lExtraLen;
    entries.push({ name, data: buf.slice(dataStart, dataStart + compSize) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ========================================================
   API ROUTING
   ======================================================== */
function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = loadDb();

  // --- CORS preflight ---
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'*','Access-Control-Allow-Headers':'*' }); res.end(); return true; }

  /* ============ AUTH ============ */
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    return parseBody(req).then((p) => {
      const email = String(p.email || '').trim().toLowerCase();
      const pw = hashPw(p.password || '');
      const user = db.users.find((u) => (u.email || '').toLowerCase() === email && u.password === pw);
      if (!user) return send(res, 401, { error: 'Invalid email or password' });
      // generate fresh token
      user.token = genToken();
      saveDb(db);
      const org = user.orgId ? db.orgs.find((o) => o.id === user.orgId) : null;
      return send(res, 200, { token: user.token, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId }, orgSlug: org?.slug || null });
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = authenticate(req, db);
    if (!user) return send(res, 401, { error: 'Not authenticated' });
    const org = user.orgId ? db.orgs.find((o) => o.id === user.orgId) : null;
    return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId }, orgSlug: org?.slug || null });
  }

  /* ============ MASTER (SuperAdmin only) ============ */
  const isMasterRoute = url.pathname.startsWith('/api/master/');
  if (isMasterRoute) {
    const user = authenticate(req, db);
    if (!user || user.role !== 'SuperAdmin') return send(res, 403, { error: 'SuperAdmin access required' });

    if (url.pathname === '/api/master/stats' && req.method === 'GET') {
      return send(res, 200, {
        totalOrgs: db.orgs.length,
        totalUsers: db.users.filter((u) => u.role !== 'SuperAdmin').length,
        totalClients: db.clients.length,
        orgs: db.orgs.map((o) => ({
          ...o,
          userCount: db.users.filter((u) => u.orgId === o.id).length,
          clientCount: db.clients.filter((c) => c.orgId === o.id).length
        }))
      });
    }

    if (url.pathname === '/api/master/orgs' && req.method === 'GET') {
      return send(res, 200, db.orgs.map((o) => ({
        ...o,
        userCount: db.users.filter((u) => u.orgId === o.id).length,
        clientCount: db.clients.filter((c) => c.orgId === o.id).length
      })));
    }

    if (url.pathname === '/api/master/orgs' && req.method === 'POST') {
      return parseBody(req).then((p) => {
        const name = String(p.name || '').trim();
        const slug = String(p.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!name || !slug) return send(res, 400, { error: 'Name and slug are required' });
        if (db.orgs.some((o) => o.slug === slug)) return send(res, 409, { error: 'Slug already in use' });
        const org = { id: `org-${Date.now()}`, name, slug, createdAt: new Date().toISOString(), settings: { deadlines: defaultDeadlines() } };
        // Create default OrgAdmin
        const adminEmail = String(p.adminEmail || '').trim().toLowerCase();
        const adminPw = String(p.adminPassword || 'admin');
        const adminName = String(p.adminName || `${name} Admin`).trim();
        if (!adminEmail) return send(res, 400, { error: 'Admin email is required' });
        if (db.users.some((u) => (u.email || '').toLowerCase() === adminEmail)) return send(res, 409, { error: 'Email already exists' });
        const adminUser = { id: `u-${Date.now()}`, orgId: org.id, name: adminName, email: adminEmail, password: hashPw(adminPw), role: 'OrgAdmin', token: genToken() };
        db.orgs.push(org);
        db.users.push(adminUser);
        addAudit(db, null, { actor: user.name, role: user.role, action: 'CREATE_ORG', detail: `${name} (${slug})` });
        saveDb(db);
        send(res, 201, { org, admin: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role } });
      }).catch((e) => send(res, 400, { error: e.message }));
    }

    const masterOrgMatch = url.pathname.match(/^\/api\/master\/orgs\/([^/]+)$/);
    if (masterOrgMatch && req.method === 'DELETE') {
      const orgId = masterOrgMatch[1];
      const idx = db.orgs.findIndex((o) => o.id === orgId);
      if (idx === -1) return send(res, 404, { error: 'Org not found' });
      db.orgs.splice(idx, 1);
      // Remove all org users and clients
      db.users = db.users.filter((u) => u.orgId !== orgId);
      db.clients = db.clients.filter((c) => c.orgId !== orgId);
      db.invites = (db.invites || []).filter((i) => i.orgId !== orgId);
      addAudit(db, null, { actor: user.name, role: user.role, action: 'DELETE_ORG', detail: orgId });
      saveDb(db);
      return send(res, 200, { ok: true });
    }

    const masterOrgUsers = url.pathname.match(/^\/api\/master\/orgs\/([^/]+)\/users$/);
    if (masterOrgUsers && req.method === 'GET') {
      const orgId = masterOrgUsers[1];
      return send(res, 200, db.users.filter((u) => u.orgId === orgId).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
    }
    if (masterOrgUsers && req.method === 'POST') {
      const orgId = masterOrgUsers[1];
      if (!db.orgs.some((o) => o.id === orgId)) return send(res, 404, { error: 'Org not found' });
      return parseBody(req).then((p) => {
        const email = String(p.email || '').trim().toLowerCase();
        const name = String(p.name || '').trim();
        const role = ['OrgAdmin', 'Staff'].includes(p.role) ? p.role : 'Staff';
        const pw = String(p.password || 'changeme');
        if (!email || !name) return send(res, 400, { error: 'Name and email required' });
        if (db.users.some((u) => (u.email || '').toLowerCase() === email)) return send(res, 409, { error: 'Email already exists' });
        const newUser = { id: `u-${Date.now()}`, orgId, name, email, password: hashPw(pw), role, token: genToken() };
        db.users.push(newUser);
        saveDb(db);
        send(res, 201, { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
      }).catch((e) => send(res, 400, { error: e.message }));
    }

    return send(res, 404, { error: 'Master route not found' });
  }

  /* ============ ORG-SCOPED routes: /api/org/:slug/... ============ */
  const orgRoute = url.pathname.match(/^\/api\/org\/([^/]+)\/(.+)$/);
  if (orgRoute) {
    const [, slug, rest] = orgRoute;
    const org = db.orgs.find((o) => o.slug === slug);
    if (!org) return send(res, 404, { error: 'Organization not found' });
    const orgClients = () => db.clients.filter((c) => c.orgId === org.id);

    /* --- Meta --- */
    if (rest === 'meta' && req.method === 'GET') {
      return send(res, 200, { statuses: STATUS, folders: DEFAULT_FOLDERS, entities: Object.keys(REQUIRED).filter((k) => k !== 'default'), deadlines: org.settings.deadlines, orgName: org.name, orgSlug: org.slug });
    }

    /* --- Client Registration --- */
    if (rest === 'register' && req.method === 'POST') {
      return parseBody(req).then((p) => {
        const inviteToken = String(p.inviteToken || '').trim();
        const invite = (db.invites || []).find((i) => i.token === inviteToken && i.orgId === org.id && !i.used);
        if (!invite) return send(res, 403, { error: 'Invalid or expired invite link' });
        const firstName = String(p.firstName || '').trim();
        const lastName = String(p.lastName || '').trim();
        const email = String(p.email || '').trim();
        if (!firstName || !lastName || !email) return send(res, 400, { error: 'First name, last name, and email are required' });
        const id = `client-${Date.now()}`;
        const client = {
          id, orgId: org.id,
          portalCode: `portal-${Math.random().toString(36).slice(2, 8)}`,
          clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
          firstName, lastName, businessName: '', name: '',
          entityType: p.entityType || '1040',
          taxYears: [], status: 'In Progress',
          email, assignedStaff: invite.assignedStaff || '', identifiers: [],
          files: [], notes: [], docRequests: [],
          events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), message: 'Client registered via invite', by: 'Client' }],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        client.name = displayName(client);
        fs.mkdirSync(path.join(storageDir, id), { recursive: true });
        DEFAULT_FOLDERS.forEach((f) => fs.mkdirSync(path.join(storageDir, id, f), { recursive: true }));
        invite.used = true;
        invite.usedAt = new Date().toISOString();
        invite.clientId = id;
        db.clients.unshift(client);
        addAudit(db, org.id, { actor: 'Client', role: 'Client', action: 'CLIENT_REGISTER', clientId: id });
        saveDb(db);
        send(res, 201, { portalCode: client.portalCode, clientName: client.name });
      }).catch((e) => send(res, 400, { error: e.message }));
    }

    /* --- Invite validation (GET for registration page) --- */
    if (rest === 'invite/validate' && req.method === 'GET') {
      const token = url.searchParams.get('token') || '';
      const invite = (db.invites || []).find((i) => i.token === token && i.orgId === org.id && !i.used);
      if (!invite) return send(res, 404, { error: 'Invalid or expired invite' });
      return send(res, 200, { orgName: org.name, email: invite.email || '' });
    }

    /* --- Admin routes (authenticated) --- */
    if (rest.startsWith('admin/')) {
      const user = authenticate(req, db);
      // Legacy header fallback for existing admin.js
      const legacyRole = req.headers['x-role'];
      const legacyUser = req.headers['x-user'];
      const isLegacy = !user && legacyRole;
      const actor = user ? { name: user.name, role: user.role, id: user.id } : (isLegacy ? { name: legacyUser || 'system', role: legacyRole, id: null } : null);
      if (!actor) return send(res, 401, { error: 'Authentication required' });
      if (user && user.orgId !== org.id) return send(res, 403, { error: 'Not a member of this organization' });

      const adminPath = rest.slice('admin/'.length);

      if (adminPath === 'dashboard' && req.method === 'GET') {
        const clients = orgClients();
        const returnsByStatus = Object.fromEntries(STATUS.map((s) => [s, clients.filter((c) => c.status === s).length]));
        const missing = clients.map((c) => ({ id: c.id, name: displayName(c), missing: computeChecklist(c).filter((x) => !x.found).map((x) => x.doc) })).filter((m) => m.missing.length);
        return send(res, 200, {
          total: clients.length, active: clients.filter((c) => c.status !== 'Archived').length,
          filed: clients.filter((c) => c.status === 'Filed').length, extensions: clients.filter((c) => c.status === 'Extended').length,
          returnsByStatus, missing, audit: db.audit.filter((a) => a.orgId === org.id).slice(0, 25)
        });
      }

      if (adminPath === 'settings' && req.method === 'GET') {
        return send(res, 200, org.settings);
      }
      if (adminPath === 'settings' && req.method === 'PATCH') {
        return parseBody(req).then((p) => {
          const keys = ['taxSeasonStart','taxSeasonEnd','q1EstimateDue','q2EstimateDue','q3EstimateDue','q4EstimateDue'];
          const vals = keys.map((k) => String(p?.deadlines?.[k] || '').trim());
          if (vals.some((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v))) return send(res, 400, { error: 'Dates must be YYYY-MM-DD' });
          keys.forEach((k, i) => { org.settings.deadlines[k] = vals[i]; });
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'UPDATE_SETTINGS' });
          saveDb(db);
          return send(res, 200, org.settings);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      if (adminPath === 'staff' && req.method === 'GET') {
        return send(res, 200, db.users.filter((u) => u.orgId === org.id).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
      }
      if (adminPath === 'staff' && req.method === 'POST') {
        if (!['OrgAdmin'].includes(actor.role) && actor.role !== 'Admin') return send(res, 403, { error: 'Forbidden' });
        return parseBody(req).then((p) => {
          const email = String(p.email || '').trim().toLowerCase();
          const name = String(p.name || '').trim();
          const role = ['OrgAdmin', 'Staff'].includes(p.role) ? p.role : 'Staff';
          const pw = String(p.password || 'changeme');
          if (!email || !name) return send(res, 400, { error: 'Name and email required' });
          if (db.users.some((u) => (u.email || '').toLowerCase() === email)) return send(res, 409, { error: 'Email already exists' });
          const newUser = { id: `u-${Date.now()}`, orgId: org.id, name, email, password: hashPw(pw), role, token: genToken() };
          db.users.push(newUser);
          saveDb(db);
          send(res, 201, { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role });
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      /* --- Invite management --- */
      if (adminPath === 'invites' && req.method === 'GET') {
        return send(res, 200, (db.invites || []).filter((i) => i.orgId === org.id));
      }
      if (adminPath === 'invites' && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const email = String(p.email || '').trim();
          const token = crypto.randomBytes(16).toString('hex');
          const invite = { id: `inv-${Date.now()}`, orgId: org.id, email, token, assignedStaff: p.assignedStaff || '', createdAt: new Date().toISOString(), createdBy: actor.name, used: false };
          if (!Array.isArray(db.invites)) db.invites = [];
          db.invites.push(invite);
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'CREATE_INVITE', detail: email });
          saveDb(db);
          const link = `/org/${org.slug}/register?invite=${token}`;
          send(res, 201, { invite, link });
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      /* --- Clients CRUD (org-scoped) --- */
      if (adminPath === 'clients' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const clients = orgClients().filter((c) => !q || [displayName(c), c.firstName, c.lastName, c.name, c.entityType, c.status, c.assignedStaff, c.email, ...(c.identifiers || [])].join(' ').toLowerCase().includes(q));
        return send(res, 200, clients);
      }

      if (adminPath === 'clients' && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const id = `client-${Date.now()}`;
          const client = {
            id, orgId: org.id,
            portalCode: `portal-${Math.random().toString(36).slice(2, 8)}`,
            clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
            firstName: String(p.firstName || '').trim(), lastName: String(p.lastName || '').trim(),
            businessName: p.businessName || '', name: '', entityType: p.entityType || '1040',
            taxYears: Array.isArray(p.taxYears) ? p.taxYears.map(String) : [],
            status: p.status || 'In Progress', email: String(p.email || '').trim(),
            assignedStaff: p.assignedStaff || '', identifiers: p.identifiers || [],
            files: [], notes: [], docRequests: [],
            events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), message: 'Client created', by: actor.name }],
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
          };
          client.name = displayName(client);
          fs.mkdirSync(path.join(storageDir, id), { recursive: true });
          DEFAULT_FOLDERS.forEach((f) => fs.mkdirSync(path.join(storageDir, id, f), { recursive: true }));
          db.clients.unshift(client);
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'CREATE_CLIENT', clientId: id });
          saveDb(db);
          send(res, 201, client);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      // Restore must come before single client match
      if (adminPath === 'clients/restore' && req.method === 'POST') {
        return parseRawBody(req).then((raw) => {
          const entries = readZip(raw);
          const metaEntry = entries.find((e) => e.name === 'client.json');
          if (!metaEntry) return send(res, 400, { error: 'Invalid archive: missing client.json' });
          const client = JSON.parse(metaEntry.data.toString('utf8'));
          client.orgId = org.id; // Assign to current org
          if (db.clients.some((c) => c.id === client.id)) return send(res, 409, { error: 'Client already exists' });
          for (const entry of entries) {
            if (entry.name === 'client.json' || !entry.name.startsWith('files/')) continue;
            const rel = entry.name.slice('files/'.length);
            const dest = path.join(storageDir, client.id, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, entry.data);
          }
          client.updatedAt = new Date().toISOString();
          client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: 'Restored from archive', by: actor.name });
          db.clients.unshift(client);
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'RESTORE_CLIENT', clientId: client.id });
          saveDb(db);
          send(res, 201, client);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const clientMatch = adminPath.match(/^clients\/([^/]+)$/);
      if (clientMatch && req.method === 'GET') {
        const client = orgClients().find((c) => c.id === clientMatch[1]);
        if (!client) return send(res, 404, { error: 'Client not found' });
        return send(res, 200, { ...client, checklist: computeChecklist(client) });
      }
      if (clientMatch && req.method === 'DELETE') {
        const idx = db.clients.findIndex((c) => c.id === clientMatch[1] && c.orgId === org.id);
        if (idx === -1) return send(res, 404, { error: 'Client not found' });
        db.clients.splice(idx, 1);
        addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'DELETE_CLIENT', clientId: clientMatch[1] });
        saveDb(db);
        return send(res, 200, { ok: true });
      }

      const archiveMatch = adminPath.match(/^clients\/([^/]+)\/archive$/);
      if (archiveMatch && req.method === 'POST') {
        const clientIdx = db.clients.findIndex((c) => c.id === archiveMatch[1] && c.orgId === org.id);
        if (clientIdx === -1) return send(res, 404, { error: 'Client not found' });
        const client = db.clients[clientIdx];
        const zipEntries = [{ name: 'client.json', data: Buffer.from(JSON.stringify(client, null, 2), 'utf8') }, ...collectClientFiles(client.id)];
        const zip = buildZip(zipEntries);
        db.clients.splice(clientIdx, 1);
        addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'ARCHIVE_CLIENT', clientId: client.id });
        saveDb(db);
        const safeName = sanitize(displayName(client) || client.id);
        res.writeHead(200, { 'Content-Type':'application/zip', 'Content-Disposition':`attachment; filename="${safeName}_archive.zip"`, 'Content-Length':zip.length });
        res.end(zip);
        return true;
      }

      const uploadMatch = adminPath.match(/^clients\/([^/]+)\/upload$/);
      if (uploadMatch && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === uploadMatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          if (['Filed', 'Archived'].includes(client.status)) return send(res, 400, { error: 'Uploads locked in this status' });
          const originalName = sanitize(p.originalName || 'upload.bin');
          const folder = p.category || 'Misc';
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const version = client.files.filter((f) => f.category === folder && f.originalName === originalName).length + 1;
          const storedName = `${stamp}__${originalName}`;
          writeBase64File(client.id, folder, storedName, p.base64);
          const file = { id: crypto.randomUUID(), originalName, storedName, category: folder, version, uploadedAt: new Date().toISOString(), uploadedBy: actor.name, source: p.source || 'upload', internalOnly: !!p.internalOnly, taxYear: p.taxYear || String(new Date().getFullYear()) };
          if (!client.taxYears.includes(String(file.taxYear))) client.taxYears.push(String(file.taxYear));
          client.files.unshift(file);
          client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `${file.source} ${originalName} -> ${folder} v${version}`, by: actor.name });
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'UPLOAD_FILE', clientId: client.id, detail: `${folder}/${storedName}` });
          saveDb(db);
          send(res, 201, file);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const taxYearsMatch = adminPath.match(/^clients\/([^/]+)\/tax-years$/);
      if (taxYearsMatch && req.method === 'PATCH') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === taxYearsMatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          const year = String(p.year || '').trim();
          if (!/^\d{4}$/.test(year)) return send(res, 400, { error: 'Invalid year' });
          if (!client.taxYears.includes(year)) client.taxYears.push(year);
          client.taxYears = Array.from(new Set(client.taxYears.map(String))).sort((a,b)=>Number(b)-Number(a));
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'ADD_TAX_YEAR', clientId: client.id, detail: year });
          saveDb(db);
          send(res, 200, { taxYears: client.taxYears });
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const statusMatch = adminPath.match(/^clients\/([^/]+)\/status$/);
      if (statusMatch && req.method === 'PATCH') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === statusMatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          if (!STATUS.includes(p.status)) return send(res, 400, { error: 'Invalid status' });
          client.status = p.status;
          client.updatedAt = new Date().toISOString();
          client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Status -> ${p.status}`, by: actor.name });
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'CHANGE_STATUS', clientId: client.id, detail: p.status });
          saveDb(db);
          send(res, 200, client);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const notesMatch = adminPath.match(/^clients\/([^/]+)\/notes$/);
      if (notesMatch && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === notesMatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          const note = { id: crypto.randomUUID(), text: p.text || '', at: new Date().toISOString(), by: actor.name, internalOnly: true };
          client.notes.unshift(note);
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'ADD_NOTE', clientId: client.id });
          saveDb(db);
          send(res, 201, note);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const reqMatch = adminPath.match(/^clients\/([^/]+)\/requests$/);
      if (reqMatch && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === reqMatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          const reqItem = { id: crypto.randomUUID(), text: p.text || '', priority: p.priority || 'medium', taxYear: p.taxYear ? String(p.taxYear) : '', docType: p.docType || '', completed: false, createdAt: new Date().toISOString() };
          client.docRequests.unshift(reqItem);
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: actor.name, role: actor.role, action: 'REQUEST_DOCS', clientId: client.id });
          saveDb(db);
          send(res, 201, reqItem);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      return send(res, 404, { error: 'Admin route not found' });
    }

    /* --- Client Portal (scoped by org) --- */
    if (rest.startsWith('client/')) {
      const clientPath = rest.slice('client/'.length);

      if (clientPath === 'session' && req.method === 'GET') {
        const code = url.searchParams.get('portalCode');
        const client = orgClients().find((c) => c.portalCode === code);
        if (!client) return send(res, 404, { error: 'Invalid portal code' });
        return send(res, 200, { id: client.id, name: client.name, status: client.status, taxYears: client.taxYears, checklist: computeChecklist(client), requests: client.docRequests, files: client.files.filter((f) => !f.internalOnly) });
      }

      const clientReqPatch = clientPath.match(/^([^/]+)\/requests\/([^/]+)$/);
      if (clientReqPatch && req.method === 'PATCH') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === clientReqPatch[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          if (p.portalCode !== client.portalCode) return send(res, 403, { error: 'Bad portal code' });
          const reqItem = (client.docRequests || []).find((r) => r.id === clientReqPatch[2]);
          if (!reqItem) return send(res, 404, { error: 'Request not found' });
          if (typeof p.completed === 'boolean') reqItem.completed = p.completed;
          reqItem.updatedAt = new Date().toISOString();
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: 'Client', role: 'Client', action: 'CLIENT_REQUEST_UPDATE', clientId: client.id });
          saveDb(db);
          send(res, 200, reqItem);
        }).catch((e) => send(res, 400, { error: e.message }));
      }

      const clientUpload = clientPath.match(/^([^/]+)\/upload$/);
      if (clientUpload && req.method === 'POST') {
        return parseBody(req).then((p) => {
          const client = orgClients().find((c) => c.id === clientUpload[1]);
          if (!client) return send(res, 404, { error: 'Client not found' });
          if (p.portalCode !== client.portalCode) return send(res, 403, { error: 'Bad portal code' });
          const originalName = sanitize(p.originalName || 'client-upload.bin');
          const folder = p.category || 'Current Year/1099s';
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const version = client.files.filter((f) => f.category === folder && f.originalName === originalName).length + 1;
          const storedName = `${stamp}__${originalName}`;
          writeBase64File(client.id, folder, storedName, p.base64);
          const file = { id: crypto.randomUUID(), originalName, storedName, category: folder, version, uploadedAt: new Date().toISOString(), uploadedBy: 'Client', source: p.source || 'client-upload', internalOnly: false, taxYear: p.taxYear || String(new Date().getFullYear()) };
          if (!client.taxYears.includes(String(file.taxYear))) client.taxYears.push(String(file.taxYear));
          client.files.unshift(file);
          client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Client uploaded ${originalName}`, by: 'Client' });
          client.updatedAt = new Date().toISOString();
          addAudit(db, org.id, { actor: 'Client', role: 'Client', action: 'CLIENT_UPLOAD', clientId: client.id, detail: storedName });
          saveDb(db);
          send(res, 201, file);
        }).catch((e) => send(res, 400, { error: e.message }));
      }
    }

    /* --- Files (org-scoped) --- */
    const fileMatch = rest.match(/^files\/([^/]+)\/([^/]+)$/);
    if (fileMatch && req.method === 'GET') {
      const [, clientId, fileId] = fileMatch;
      const client = orgClients().find((c) => c.id === clientId);
      if (!client) return send(res, 404, { error: 'Client not found' });
      const file = client.files.find((f) => f.id === fileId);
      if (!file) return send(res, 404, { error: 'File not found' });
      const portalCode = url.searchParams.get('portalCode');
      const isClientAuth = portalCode && portalCode === client.portalCode;
      const user = authenticate(req, db);
      const isAdminAuth = user && user.orgId === org.id;
      // Also allow legacy header auth
      const legacyRole = req.headers['x-role'];
      const isLegacyAuth = legacyRole && ['Admin', 'Preparer', 'Reviewer', 'Read-only', 'OrgAdmin', 'Staff'].includes(legacyRole);
      if (!isClientAuth && !isAdminAuth && !isLegacyAuth) return send(res, 403, { error: 'Forbidden' });
      if (isClientAuth && file.internalOnly) return send(res, 403, { error: 'Forbidden' });
      try {
        const fullPath = safeClientFilePath(client.id, file.category, file.storedName);
        if (!fs.existsSync(fullPath)) return send(res, 404, { error: 'File missing on disk' });
        res.writeHead(200, { 'Content-Type': mimeFromName(file.originalName || file.storedName), 'Content-Disposition': `inline; filename="${sanitize(file.originalName || 'document.bin')}"` });
        fs.createReadStream(fullPath).pipe(res);
        return true;
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    return send(res, 404, { error: 'Route not found' });
  }

  /* ============ Legacy non-org routes (backward compat) ============ */
  // Redirect legacy /api/meta to first org
  if (url.pathname === '/api/meta' && req.method === 'GET') {
    const firstOrg = db.orgs[0];
    if (!firstOrg) return send(res, 200, { statuses: STATUS, folders: DEFAULT_FOLDERS, entities: Object.keys(REQUIRED).filter((k) => k !== 'default'), deadlines: defaultDeadlines() });
    return send(res, 200, { statuses: STATUS, folders: DEFAULT_FOLDERS, entities: Object.keys(REQUIRED).filter((k) => k !== 'default'), deadlines: firstOrg.settings.deadlines, orgName: firstOrg.name });
  }

  return false;
}

/* ============ Static file serving ============ */
function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let reqPath = url.pathname;

  // Route patterns
  if (reqPath === '/' || reqPath === '/login') reqPath = '/login.html';
  if (reqPath === '/master') reqPath = '/master.html';
  if (/^\/org\/[^/]+\/admin\/?$/.test(reqPath)) reqPath = '/admin.html';
  if (/^\/org\/[^/]+\/portal\/?$/.test(reqPath)) reqPath = '/client.html';
  if (/^\/org\/[^/]+\/register\/?$/.test(reqPath)) reqPath = '/register.html';

  const filePath = path.join(publicDir, reqPath);
  if (!filePath.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
    send(res, 200, data, types[ext] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const handled = routeApi(req, res);
    if (handled !== false) return;
  }
  serveStatic(req, res);
});

ensureDb();
server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Server running on http://0.0.0.0:3000'));
