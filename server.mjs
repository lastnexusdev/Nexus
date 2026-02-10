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

const STATUS = ['Intake Received', 'Missing Docs', 'Data Entry', 'Review', 'Ready to File', 'Filed', 'Extended', 'Archived'];
const DEFAULT_FOLDERS = ['Intake', 'Prior Year/2025', 'Prior Year/2024', 'Current Year/W2s', 'Current Year/1099s', 'Current Year/K-1s', 'Workpapers', 'Filed Returns', 'Misc'];
const REQUIRED = {
  '1040': ['Questionnaire', 'ID', 'W-2', '1099'],
  '1120': ['Questionnaire', 'ID', 'Trial Balance'],
  '1120S': ['Questionnaire', 'ID', 'K-1', 'Trial Balance'],
  '1065': ['Questionnaire', 'ID', 'K-1', 'Balance Sheet'],
  default: ['Questionnaire', 'ID']
};

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify({
      clients: [],
      audit: [],
      users: [
        { id: 'u-admin', name: 'Admin User', role: 'Admin', token: 'admin-demo' },
        { id: 'u-prep', name: 'Preparer User', role: 'Preparer', token: 'prep-demo' }
      ]
    }, null, 2));
  }
}

function loadDb() { ensureDb(); return JSON.parse(fs.readFileSync(dbPath, 'utf8')); }
function saveDb(db) { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2)); }
function send(res, status, data, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 30_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function actor(req) {
  return {
    user: req.headers['x-user'] || 'system',
    role: req.headers['x-role'] || 'Read-only'
  };
}

function addAudit(db, evt) { db.audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...evt }); }
function sanitize(name) { return String(name || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_'); }

function writeBase64File(clientId, folder, fileName, base64) {
  const dir = path.join(storageDir, clientId, folder);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, fileName);
  const normalized = path.normalize(full);
  if (!normalized.startsWith(path.normalize(path.join(storageDir, clientId)))) throw new Error('Invalid path');
  const clean = (base64 || '').replace(/^data:.*;base64,/, '');
  fs.writeFileSync(full, Buffer.from(clean, 'base64'));
}

function computeChecklist(client) {
  const docs = REQUIRED[client.entityType] || REQUIRED.default;
  return docs.map((d) => ({ doc: d, found: client.files.some((f) => f.originalName.toLowerCase().includes(d.toLowerCase().replace(/[^a-z0-9]/gi, ''))) }));
}

function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = loadDb();
  const a = actor(req);

  if (url.pathname === '/api/meta' && req.method === 'GET') {
    return send(res, 200, { statuses: STATUS, folders: DEFAULT_FOLDERS, entities: Object.keys(REQUIRED).filter((k) => k !== 'default') });
  }

  if (url.pathname === '/api/admin/dashboard' && req.method === 'GET') {
    const returnsByStatus = Object.fromEntries(STATUS.map((s) => [s, db.clients.filter((c) => c.status === s).length]));
    const missing = db.clients.map((c) => ({ id: c.id, name: c.name, missing: computeChecklist(c).filter((x) => !x.found).map((x) => x.doc) })).filter((m) => m.missing.length);
    return send(res, 200, {
      total: db.clients.length,
      active: db.clients.filter((c) => c.status !== 'Archived').length,
      filed: db.clients.filter((c) => c.status === 'Filed').length,
      extensions: db.clients.filter((c) => c.status === 'Extended').length,
      returnsByStatus,
      missing,
      audit: db.audit.slice(0, 25)
    });
  }

  if (url.pathname === '/api/admin/clients' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return send(res, 200, db.clients.filter((c) => !q || [c.name, c.entityType, c.status, c.assignedStaff, ...(c.identifiers || [])].join(' ').toLowerCase().includes(q)));
  }

  if (url.pathname === '/api/admin/clients' && req.method === 'POST') {
    if (!['Admin', 'Preparer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const id = `client-${Date.now()}`;
      const client = {
        id,
        portalCode: `portal-${Math.random().toString(36).slice(2, 8)}`,
        clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
        name: p.name || '',
        businessName: p.businessName || '',
        entityType: p.entityType || '1040',
        taxYears: p.taxYears || [String(new Date().getFullYear())],
        status: p.status || 'Intake Received',
        assignedStaff: p.assignedStaff || '',
        identifiers: p.identifiers || [],
        files: [],
        notes: [],
        docRequests: [],
        events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), message: 'Client created', by: a.user }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      fs.mkdirSync(path.join(storageDir, id), { recursive: true });
      DEFAULT_FOLDERS.forEach((f) => fs.mkdirSync(path.join(storageDir, id, f), { recursive: true }));
      db.clients.unshift(client);
      addAudit(db, { actor: a.user, role: a.role, action: 'CREATE_CLIENT', clientId: id });
      saveDb(db);
      send(res, 201, client);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  const adminClientGet = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)$/);
  if (adminClientGet && req.method === 'GET') {
    const client = db.clients.find((c) => c.id === adminClientGet[1]);
    if (!client) return send(res, 404, { error: 'Client not found' });
    return send(res, 200, { ...client, checklist: computeChecklist(client) });
  }

  const adminUpload = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)\/upload$/);
  if (adminUpload && req.method === 'POST') {
    if (!['Admin', 'Preparer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === adminUpload[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      if (['Filed', 'Archived'].includes(client.status)) return send(res, 400, { error: 'Uploads locked in this status' });

      const originalName = sanitize(p.originalName || 'upload.bin');
      const folder = p.category || 'Misc';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const existing = client.files.filter((f) => f.category === folder && f.originalName === originalName).length;
      const version = existing + 1;
      const storedName = `${stamp}__${originalName}`;
      writeBase64File(client.id, folder, storedName, p.base64);

      const file = {
        id: crypto.randomUUID(),
        originalName,
        storedName,
        category: folder,
        version,
        uploadedAt: new Date().toISOString(),
        uploadedBy: a.user,
        source: p.source || 'upload',
        internalOnly: !!p.internalOnly,
        taxYear: p.taxYear || String(new Date().getFullYear())
      };
      client.files.unshift(file);
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `${file.source} ${originalName} -> ${folder} v${version}`, by: a.user });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: a.user, role: a.role, action: 'UPLOAD_FILE', clientId: client.id, detail: `${folder}/${storedName}` });
      saveDb(db);
      send(res, 201, file);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  const adminStatus = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)\/status$/);
  if (adminStatus && req.method === 'PATCH') {
    if (!['Admin', 'Reviewer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === adminStatus[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      if (!STATUS.includes(p.status)) return send(res, 400, { error: 'Invalid status' });
      client.status = p.status;
      client.updatedAt = new Date().toISOString();
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Status -> ${p.status}`, by: a.user });
      addAudit(db, { actor: a.user, role: a.role, action: 'CHANGE_STATUS', clientId: client.id, detail: p.status });
      saveDb(db);
      send(res, 200, client);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  const adminNotes = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)\/notes$/);
  if (adminNotes && req.method === 'POST') {
    if (!['Admin', 'Preparer', 'Reviewer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === adminNotes[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      const note = { id: crypto.randomUUID(), text: p.text || '', at: new Date().toISOString(), by: a.user, internalOnly: true };
      client.notes.unshift(note);
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: a.user, role: a.role, action: 'ADD_NOTE', clientId: client.id });
      saveDb(db);
      send(res, 201, note);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  const adminReq = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)\/requests$/);
  if (adminReq && req.method === 'POST') {
    if (!['Admin', 'Preparer', 'Reviewer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === adminReq[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      const reqItem = { id: crypto.randomUUID(), text: p.text || '', priority: p.priority || 'medium', completed: false, createdAt: new Date().toISOString() };
      client.docRequests.unshift(reqItem);
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: a.user, role: a.role, action: 'REQUEST_DOCS', clientId: client.id });
      saveDb(db);
      send(res, 201, reqItem);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  if (url.pathname === '/api/client/session' && req.method === 'GET') {
    const code = url.searchParams.get('portalCode');
    const client = db.clients.find((c) => c.portalCode === code);
    if (!client) return send(res, 404, { error: 'Invalid portal code' });
    return send(res, 200, {
      id: client.id,
      name: client.name,
      status: client.status,
      taxYears: client.taxYears,
      checklist: computeChecklist(client),
      requests: client.docRequests,
      files: client.files.filter((f) => !f.internalOnly)
    });
  }

  const clientUpload = url.pathname.match(/^\/api\/client\/([^/]+)\/upload$/);
  if (clientUpload && req.method === 'POST') {
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === clientUpload[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      if (p.portalCode !== client.portalCode) return send(res, 403, { error: 'Bad portal code' });
      const originalName = sanitize(p.originalName || 'client-upload.bin');
      const folder = p.category || 'Current Year/1099s';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const version = client.files.filter((f) => f.category === folder && f.originalName === originalName).length + 1;
      const storedName = `${stamp}__${originalName}`;
      writeBase64File(client.id, folder, storedName, p.base64);
      const file = { id: crypto.randomUUID(), originalName, storedName, category: folder, version, uploadedAt: new Date().toISOString(), uploadedBy: 'Client', source: p.source || 'client-upload', internalOnly: false };
      client.files.unshift(file);
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Client uploaded ${originalName}`, by: 'Client' });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: 'Client', role: 'Client', action: 'CLIENT_UPLOAD', clientId: client.id, detail: storedName });
      saveDb(db);
      send(res, 201, file);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  return false;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let reqPath = url.pathname;
  if (reqPath === '/') reqPath = '/admin.html';
  if (reqPath === '/admin') reqPath = '/admin.html';
  if (reqPath === '/portal') reqPath = '/client.html';
  const filePath = path.join(publicDir, reqPath);

  if (!filePath.startsWith(publicDir)) return send(res, 403, 'Forbidden', 'text/plain');

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
