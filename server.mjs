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
      ],
      settings: {
        deadlines: {
          taxSeasonStart: `${new Date().getFullYear()}-01-15`,
          taxSeasonEnd: `${new Date().getFullYear()}-04-15`,
          q1EstimateDue: `${new Date().getFullYear()}-04-15`,
          q2EstimateDue: `${new Date().getFullYear()}-06-15`,
          q3EstimateDue: `${new Date().getFullYear()}-09-15`,
          q4EstimateDue: `${new Date().getFullYear() + 1}-01-15`
        }
      }
    }, null, 2));
  }
}

function normalizeDbShape(db) {
  if (!db || typeof db !== 'object') db = {};
  if (!Array.isArray(db.clients)) db.clients = [];
  // Backward compatibility: older builds used `auditLog` instead of `audit`.
  if (!Array.isArray(db.audit)) db.audit = Array.isArray(db.auditLog) ? db.auditLog : [];
  if (!Array.isArray(db.users)) db.users = [
    { id: 'u-admin', name: 'Admin User', role: 'Admin', token: 'admin-demo' },
    { id: 'u-prep', name: 'Preparer User', role: 'Preparer', token: 'prep-demo' }
  ];

  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.settings.deadlines || typeof db.settings.deadlines !== 'object') db.settings.deadlines = {};
  const y = new Date().getFullYear();
  if (!db.settings.deadlines.taxSeasonStart) db.settings.deadlines.taxSeasonStart = `${y}-01-15`;
  if (!db.settings.deadlines.taxSeasonEnd) db.settings.deadlines.taxSeasonEnd = `${y}-04-15`;
  if (!db.settings.deadlines.q1EstimateDue) db.settings.deadlines.q1EstimateDue = `${y}-04-15`;
  if (!db.settings.deadlines.q2EstimateDue) db.settings.deadlines.q2EstimateDue = `${y}-06-15`;
  if (!db.settings.deadlines.q3EstimateDue) db.settings.deadlines.q3EstimateDue = `${y}-09-15`;
  if (!db.settings.deadlines.q4EstimateDue) db.settings.deadlines.q4EstimateDue = `${y + 1}-01-15`;

  for (const client of db.clients) {
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

  return db;
}

function loadDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const normalized = normalizeDbShape(db);
  // Persist auto-migrations so subsequent reads are safe in all runtimes.
  fs.writeFileSync(dbPath, JSON.stringify(normalized, null, 2));
  return normalized;
}

function saveDb(db) { fs.writeFileSync(dbPath, JSON.stringify(normalizeDbShape(db), null, 2)); }
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


function mimeFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.csv') return 'text/csv; charset=utf-8';
  if (ext === '.json') return 'application/json';
  return 'application/octet-stream';
}

function safeClientFilePath(clientId, category, storedName) {
  const target = path.normalize(path.join(storageDir, clientId, category, storedName));
  const root = path.normalize(path.join(storageDir, clientId));
  if (!target.startsWith(root)) throw new Error('Invalid file path');
  return target;
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
    return send(res, 200, { statuses: STATUS, folders: DEFAULT_FOLDERS, entities: Object.keys(REQUIRED).filter((k) => k !== 'default'), deadlines: db.settings.deadlines });
  }

  if (url.pathname === '/api/admin/dashboard' && req.method === 'GET') {
    const returnsByStatus = Object.fromEntries(STATUS.map((s) => [s, db.clients.filter((c) => c.status === s).length]));
    const missing = db.clients.map((c) => ({ id: c.id, name: displayName(c), missing: computeChecklist(c).filter((x) => !x.found).map((x) => x.doc) })).filter((m) => m.missing.length);
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

  if (url.pathname === '/api/admin/settings' && req.method === 'GET') {
    if (!['Admin', 'Preparer', 'Reviewer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return send(res, 200, db.settings);
  }

  if (url.pathname === '/api/admin/settings' && req.method === 'PATCH') {
    if (!['Admin'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const ds = String(p?.deadlines?.taxSeasonStart || '').trim();
      const de = String(p?.deadlines?.taxSeasonEnd || '').trim();
      const q1 = String(p?.deadlines?.q1EstimateDue || '').trim();
      const q2 = String(p?.deadlines?.q2EstimateDue || '').trim();
      const q3 = String(p?.deadlines?.q3EstimateDue || '').trim();
      const q4 = String(p?.deadlines?.q4EstimateDue || '').trim();
      const all = [ds, de, q1, q2, q3, q4];
      if (all.some((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v))) return send(res, 400, { error: 'Dates must be YYYY-MM-DD' });
      db.settings.deadlines.taxSeasonStart = ds;
      db.settings.deadlines.taxSeasonEnd = de;
      db.settings.deadlines.q1EstimateDue = q1;
      db.settings.deadlines.q2EstimateDue = q2;
      db.settings.deadlines.q3EstimateDue = q3;
      db.settings.deadlines.q4EstimateDue = q4;
      addAudit(db, { actor: a.user, role: a.role, action: 'UPDATE_SETTINGS', detail: `${ds}..${de} | ${q1},${q2},${q3},${q4}` });
      saveDb(db);
      return send(res, 200, db.settings);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  if (url.pathname === '/api/admin/clients' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    return send(res, 200, db.clients.filter((c) => !q || [displayName(c), c.firstName, c.lastName, c.name, c.entityType, c.status, c.assignedStaff, c.email, ...(c.identifiers || [])].join(' ').toLowerCase().includes(q)));
  }

  if (url.pathname === '/api/admin/clients' && req.method === 'POST') {
    if (!['Admin', 'Preparer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const id = `client-${Date.now()}`;
      const client = {
        id,
        portalCode: `portal-${Math.random().toString(36).slice(2, 8)}`,
        clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
        firstName: String(p.firstName || '').trim(),
        lastName: String(p.lastName || '').trim(),
        businessName: p.businessName || '',
        name: '',
        entityType: p.entityType || '1040',
        taxYears: Array.isArray(p.taxYears) ? p.taxYears.map(String) : [],
        status: p.status || 'In Progress',
        email: String(p.email || '').trim(),
        assignedStaff: p.assignedStaff || '',
        identifiers: p.identifiers || [],
        files: [],
        notes: [],
        docRequests: [],
        events: [{ id: crypto.randomUUID(), at: new Date().toISOString(), message: 'Client created', by: a.user }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      client.name = displayName(client);
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
      if (!client.taxYears.includes(String(file.taxYear))) client.taxYears.push(String(file.taxYear));
      client.files.unshift(file);
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `${file.source} ${originalName} -> ${folder} v${version}`, by: a.user });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: a.user, role: a.role, action: 'UPLOAD_FILE', clientId: client.id, detail: `${folder}/${storedName}` });
      saveDb(db);
      send(res, 201, file);
    }).catch((e) => send(res, 400, { error: e.message }));
  }

  const adminTaxYears = url.pathname.match(/^\/api\/admin\/clients\/([^/]+)\/tax-years$/);
  if (adminTaxYears && req.method === 'PATCH') {
    if (!['Admin', 'Preparer'].includes(a.role)) return send(res, 403, { error: 'Forbidden' });
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === adminTaxYears[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      const year = String(p.year || '').trim();
      if (!/^\d{4}$/.test(year)) return send(res, 400, { error: 'Invalid year' });
      const now = new Date().getFullYear();
      if (Number(year) > now + 1 || Number(year) < now - 25) return send(res, 400, { error: 'Year out of range' });
      if (!client.taxYears.includes(year)) client.taxYears.push(year);
      client.taxYears = Array.from(new Set(client.taxYears.map(String))).sort((a,b)=>Number(b)-Number(a));
      client.updatedAt = new Date().toISOString();
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `TaxYear${year} root added`, by: a.user });
      addAudit(db, { actor: a.user, role: a.role, action: 'ADD_TAX_YEAR', clientId: client.id, detail: year });
      saveDb(db);
      send(res, 200, { taxYears: client.taxYears });
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
      const reqItem = { id: crypto.randomUUID(), text: p.text || '', priority: p.priority || 'medium', taxYear: p.taxYear ? String(p.taxYear) : '', docType: p.docType || '', completed: false, createdAt: new Date().toISOString() };
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

  const clientReqPatch = url.pathname.match(/^\/api\/client\/([^/]+)\/requests\/([^/]+)$/);
  if (clientReqPatch && req.method === 'PATCH') {
    return parseBody(req).then((p) => {
      const client = db.clients.find((c) => c.id === clientReqPatch[1]);
      if (!client) return send(res, 404, { error: 'Client not found' });
      if (p.portalCode !== client.portalCode) return send(res, 403, { error: 'Bad portal code' });
      const reqItem = (client.docRequests || []).find((r) => r.id === clientReqPatch[2]);
      if (!reqItem) return send(res, 404, { error: 'Request not found' });
      if (typeof p.completed === 'boolean') reqItem.completed = p.completed;
      reqItem.updatedAt = new Date().toISOString();
      client.updatedAt = new Date().toISOString();
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Client request status updated: ${reqItem.text}`, by: 'Client' });
      addAudit(db, { actor: 'Client', role: 'Client', action: 'CLIENT_REQUEST_UPDATE', clientId: client.id, detail: `${reqItem.id}:${reqItem.completed}` });
      saveDb(db);
      send(res, 200, reqItem);
    }).catch((e) => send(res, 400, { error: e.message }));
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
      const file = { id: crypto.randomUUID(), originalName, storedName, category: folder, version, uploadedAt: new Date().toISOString(), uploadedBy: 'Client', source: p.source || 'client-upload', internalOnly: false, taxYear: p.taxYear || String(new Date().getFullYear()) };
      if (!client.taxYears.includes(String(file.taxYear))) client.taxYears.push(String(file.taxYear));
      client.files.unshift(file);
      client.events.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), message: `Client uploaded ${originalName}`, by: 'Client' });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor: 'Client', role: 'Client', action: 'CLIENT_UPLOAD', clientId: client.id, detail: storedName });
      saveDb(db);
      send(res, 201, file);
    }).catch((e) => send(res, 400, { error: e.message }));
  }


  const fileView = url.pathname.match(/^\/api\/files\/([^/]+)\/([^/]+)$/);
  if (fileView && req.method === 'GET') {
    const [_, clientId, fileId] = fileView;
    const client = db.clients.find((c) => c.id === clientId);
    if (!client) return send(res, 404, { error: 'Client not found' });

    const file = client.files.find((f) => f.id === fileId);
    if (!file) return send(res, 404, { error: 'File not found' });

    const portalCode = url.searchParams.get('portalCode');
    const isClientAuthorized = portalCode && portalCode === client.portalCode;
    const isAdminAuthorized = ['Admin', 'Preparer', 'Reviewer', 'Read-only'].includes(a.role);

    if (!isClientAuthorized && !isAdminAuthorized) return send(res, 403, { error: 'Forbidden' });
    if (isClientAuthorized && file.internalOnly) return send(res, 403, { error: 'Forbidden' });

    try {
      const fullPath = safeClientFilePath(client.id, file.category, file.storedName);
      if (!fs.existsSync(fullPath)) return send(res, 404, { error: 'File missing on disk' });

      res.writeHead(200, {
        'Content-Type': mimeFromName(file.originalName || file.storedName),
        'Content-Disposition': `inline; filename="${sanitize(file.originalName || 'document.bin')}"`
      });
      fs.createReadStream(fullPath).pipe(res);
      return true;
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
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
