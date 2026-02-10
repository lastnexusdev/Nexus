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

const defaultFolders = [
  'Intake',
  'Prior Year/2025',
  'Prior Year/2024',
  'Current Year/W2s',
  'Current Year/1099s',
  'Current Year/K-1s',
  'Workpapers',
  'Filed Returns',
  'Correspondence',
  'Misc'
];

const statuses = ['Intake Received', 'Missing Docs', 'Data Entry', 'Review', 'Ready to File', 'Filed', 'Extended', 'Archived'];
const roles = ['Admin', 'Preparer', 'Reviewer', 'Read-only', 'Client'];

const requiredDocsByEntity = {
  '1040': ['Questionnaire', 'ID', 'W-2', '1099', 'Organizer'],
  '1120': ['Questionnaire', 'ID', 'Trial Balance', 'Prior Return'],
  '1120S': ['Questionnaire', 'ID', 'K-1', 'Trial Balance', 'Prior Return'],
  '1065': ['Questionnaire', 'ID', 'K-1', 'Balance Sheet', 'Prior Return'],
  default: ['Questionnaire', 'ID']
};

function ensureDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });

  if (!fs.existsSync(dbPath)) {
    const seed = {
      clients: [],
      auditLog: [],
      users: [
        { id: 'u-1', name: 'Alex Admin', role: 'Admin' },
        { id: 'u-2', name: 'Parker Preparer', role: 'Preparer' },
        { id: 'u-3', name: 'Riley Reviewer', role: 'Reviewer' },
        { id: 'u-4', name: 'Robin ReadOnly', role: 'Read-only' }
      ]
    };
    fs.writeFileSync(dbPath, JSON.stringify(seed, null, 2));
  }
}

function loadDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function saveDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
  });
}

function sanitizeName(name) {
  return String(name || 'file.dat').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function addAudit(db, event) {
  db.auditLog.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event
  });
}

function computeChecklist(client) {
  const required = requiredDocsByEntity[client.entityType] || requiredDocsByEntity.default;
  return required.map((doc) => {
    const found = client.files.some((f) => f.originalName.toLowerCase().includes(doc.toLowerCase().replace(/[^a-z0-9]/gi, '')));
    return { doc, found };
  });
}

function fileVisibility(role, file) {
  if (role === 'Client' && file.internalOnly) return false;
  return true;
}

function toPortalClient(client) {
  return {
    id: client.id,
    name: client.name,
    businessName: client.businessName,
    entityType: client.entityType,
    taxYears: client.taxYears,
    status: client.status,
    clientInternalId: client.clientInternalId,
    checklist: computeChecklist(client),
    files: client.files.filter((f) => !f.internalOnly).map((f) => ({
      id: f.id,
      category: f.category,
      originalName: f.originalName,
      version: f.version,
      uploadedAt: f.uploadedAt,
      uploadedBy: f.uploadedBy,
      source: f.source
    })),
    requests: client.docRequests || []
  };
}

function writeClientFile({ client, db, payload, actor, role, source = 'upload' }) {
  if (['Filed', 'Archived'].includes(client.status)) {
    throw new Error(`Uploads are locked while status is ${client.status}.`);
  }

  const category = payload.category || 'Misc';
  const originalName = sanitizeName(payload.originalName || (source === 'scan' ? 'scanned-document.pdf' : 'document.dat'));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const existingVersions = client.files.filter((f) => f.category === category && f.originalName === originalName).length;
  const version = existingVersions + 1;
  const storedName = `${timestamp}__${originalName}`;

  const duplicateStored = client.files.find((f) => f.category === category && f.storedName === storedName);
  if (duplicateStored && !payload.allowOverwrite) {
    throw new Error('File exists. Set allowOverwrite=true to overwrite.');
  }

  const filePath = path.join(storageDir, client.id, category);
  fs.mkdirSync(filePath, { recursive: true });
  fs.writeFileSync(path.join(filePath, storedName), payload.content || `binary-placeholder:${originalName}`);

  const fileRecord = {
    id: crypto.randomUUID(),
    category,
    originalName,
    storedName,
    version,
    uploadedBy: actor,
    uploadedAt: new Date().toISOString(),
    taxYear: payload.taxYear || new Date().getFullYear().toString(),
    tags: payload.tags || [],
    source,
    internalOnly: Boolean(payload.internalOnly),
    ocrText: payload.ocrText || ''
  };

  client.files.unshift(fileRecord);
  client.events.unshift({
    id: crypto.randomUUID(),
    type: 'system',
    message: `${source === 'scan' ? 'Document scanned' : 'File uploaded'}: ${originalName} (${category}) v${version}`,
    actor,
    timestamp: new Date().toISOString()
  });
  client.updatedAt = new Date().toISOString();

  addAudit(db, {
    actor,
    role,
    action: source === 'scan' ? 'SCAN_FILE' : 'UPLOAD_FILE',
    clientId: client.id,
    detail: `${category}/${storedName}`
  });

  return fileRecord;
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = loadDb();
  const actor = req.headers['x-user'] || 'system';
  const role = req.headers['x-role'] || 'Admin';

  if (url.pathname === '/api/meta' && req.method === 'GET') {
    return json(res, 200, { roles, statuses, defaultFolders, requiredDocsByEntity, users: db.users });
  }

  if (url.pathname === '/api/clients' && req.method === 'GET') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const status = url.searchParams.get('status');
    const entityType = url.searchParams.get('entityType');
    const assignedStaff = url.searchParams.get('assignedStaff');

    const filtered = db.clients.filter((c) => {
      const haystack = [c.name, c.businessName, c.entityType, c.status, c.assignedStaff, ...(c.taxYears || []), ...(c.identifiers || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (search && !haystack.includes(search)) return false;
      if (status && c.status !== status) return false;
      if (entityType && c.entityType !== entityType) return false;
      if (assignedStaff && c.assignedStaff !== assignedStaff) return false;
      return true;
    });

    return json(res, 200, filtered);
  }

  if (url.pathname === '/api/clients' && req.method === 'POST') {
    if (role === 'Read-only' || role === 'Client') return json(res, 403, { error: 'Not allowed to create clients.' });

    try {
      const payload = await parseBody(req);
      const client = {
        id: `client-${Date.now()}`,
        clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
        name: payload.name || '',
        businessName: payload.businessName || '',
        entityType: payload.entityType || '1040',
        taxYears: payload.taxYears || [String(new Date().getFullYear())],
        status: payload.status || 'Intake Received',
        assignedStaff: payload.assignedStaff || '',
        identifiers: payload.identifiers || [],
        notes: [],
        pinnedWarnings: payload.pinnedWarnings || [],
        files: [],
        events: [{ id: crypto.randomUUID(), type: 'system', message: 'Client created.', actor, timestamp: new Date().toISOString() }],
        docRequests: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      fs.mkdirSync(path.join(storageDir, client.id), { recursive: true });
      for (const folder of defaultFolders) {
        fs.mkdirSync(path.join(storageDir, client.id, folder), { recursive: true });
      }

      db.clients.unshift(client);
      addAudit(db, { actor, role, action: 'CREATE_CLIENT', clientId: client.id, detail: client.name });
      saveDb(db);
      return json(res, 201, client);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const oneClientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (oneClientMatch && req.method === 'GET') {
    const client = db.clients.find((c) => c.id === oneClientMatch[1]);
    if (!client) return json(res, 404, { error: 'Client not found.' });

    const visibleFiles = client.files.filter((f) => fileVisibility(role, f));
    return json(res, 200, {
      ...client,
      files: visibleFiles,
      checklist: computeChecklist(client)
    });
  }

  const fileMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/files$/);
  if (fileMatch && req.method === 'POST') {
    if (role === 'Read-only') return json(res, 403, { error: 'Read-only role cannot upload files.' });

    try {
      const payload = await parseBody(req);
      const client = db.clients.find((c) => c.id === fileMatch[1]);
      if (!client) return json(res, 404, { error: 'Client not found.' });

      const file = writeClientFile({ client, db, payload, actor, role, source: 'upload' });
      saveDb(db);
      return json(res, 201, file);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const scanMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/scan$/);
  if (scanMatch && req.method === 'POST') {
    if (role === 'Read-only') return json(res, 403, { error: 'Read-only role cannot scan files.' });

    try {
      const payload = await parseBody(req);
      const client = db.clients.find((c) => c.id === scanMatch[1]);
      if (!client) return json(res, 404, { error: 'Client not found.' });

      const docType = payload.docType || 'scanned-document';
      const file = writeClientFile({
        client,
        db,
        actor,
        role,
        source: 'scan',
        payload: {
          category: payload.category || 'Intake',
          originalName: `${docType}-${Date.now()}.pdf`,
          taxYear: payload.taxYear,
          tags: [...(payload.tags || []), 'scanned'],
          internalOnly: Boolean(payload.internalOnly),
          ocrText: payload.ocrText || `OCR stub for ${docType}`,
          content: payload.content || `scanned-binary:${docType}`
        }
      });
      saveDb(db);
      return json(res, 201, file);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const statusMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    if (!['Admin', 'Reviewer'].includes(role)) return json(res, 403, { error: 'Only Admin/Reviewer can change status.' });
    try {
      const payload = await parseBody(req);
      const client = db.clients.find((c) => c.id === statusMatch[1]);
      if (!client) return json(res, 404, { error: 'Client not found.' });
      if (!statuses.includes(payload.status)) return json(res, 400, { error: 'Unknown status.' });

      client.status = payload.status;
      client.updatedAt = new Date().toISOString();
      client.events.unshift({ id: crypto.randomUUID(), type: 'system', message: `Status changed to ${payload.status}`, actor, timestamp: new Date().toISOString() });
      addAudit(db, { actor, role, action: 'CHANGE_STATUS', clientId: client.id, detail: payload.status });
      saveDb(db);
      return json(res, 200, client);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const noteMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/notes$/);
  if (noteMatch && req.method === 'POST') {
    if (role === 'Read-only' || role === 'Client') return json(res, 403, { error: 'Not allowed to add internal notes.' });
    try {
      const payload = await parseBody(req);
      const client = db.clients.find((c) => c.id === noteMatch[1]);
      if (!client) return json(res, 404, { error: 'Client not found.' });

      const note = {
        id: crypto.randomUUID(),
        text: payload.text || '',
        mentions: payload.mentions || [],
        pinned: Boolean(payload.pinned),
        actor,
        timestamp: new Date().toISOString(),
        internalOnly: true
      };

      client.notes.unshift(note);
      client.events.unshift({ id: crypto.randomUUID(), type: 'manual', message: `Note added by ${actor}`, actor, timestamp: note.timestamp });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor, role, action: 'ADD_NOTE', clientId: client.id, detail: note.text.slice(0, 80) });
      saveDb(db);
      return json(res, 201, note);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const requestMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/requests$/);
  if (requestMatch && req.method === 'POST') {
    if (!['Admin', 'Preparer', 'Reviewer'].includes(role)) return json(res, 403, { error: 'Not allowed to create document requests.' });
    try {
      const payload = await parseBody(req);
      const client = db.clients.find((c) => c.id === requestMatch[1]);
      if (!client) return json(res, 404, { error: 'Client not found.' });

      const request = {
        id: crypto.randomUUID(),
        text: payload.text || 'Please upload requested documents.',
        dueDate: payload.dueDate || null,
        priority: payload.priority || 'medium',
        createdBy: actor,
        createdAt: new Date().toISOString(),
        completed: false
      };
      client.docRequests.unshift(request);
      client.events.unshift({ id: crypto.randomUUID(), type: 'system', message: `Document request created: ${request.text}`, actor, timestamp: new Date().toISOString() });
      client.updatedAt = new Date().toISOString();
      addAudit(db, { actor, role, action: 'CREATE_DOC_REQUEST', clientId: client.id, detail: request.text.slice(0, 80) });
      saveDb(db);
      return json(res, 201, request);
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const portalMatch = url.pathname.match(/^\/api\/portal\/([^/]+)$/);
  if (portalMatch && req.method === 'GET') {
    const client = db.clients.find((c) => c.id === portalMatch[1]);
    if (!client) return json(res, 404, { error: 'Client not found.' });
    return json(res, 200, toPortalClient(client));
  }

  const dashboardPath = url.pathname === '/api/dashboard' && req.method === 'GET';
  if (dashboardPath) {
    const active = db.clients.filter((c) => c.status !== 'Archived').length;
    const returnsByStatus = Object.fromEntries(statuses.map((s) => [s, db.clients.filter((c) => c.status === s).length]));
    const missingDocs = db.clients
      .map((c) => {
        const checklist = computeChecklist(c);
        return {
          clientId: c.id,
          clientName: c.name,
          missing: checklist.filter((i) => !i.found).map((i) => i.doc)
        };
      })
      .filter((r) => r.missing.length > 0);

    const deadlines = db.clients
      .filter((c) => ['Data Entry', 'Review', 'Ready to File', 'Extended'].includes(c.status))
      .map((c) => ({ clientId: c.id, clientName: c.name, status: c.status, taxYears: c.taxYears }));

    const staffWorkload = (db.users || []).map((u) => ({
      staff: u.name,
      assigned: db.clients.filter((c) => c.assignedStaff === u.name && !['Filed', 'Archived'].includes(c.status)).length
    }));

    return json(res, 200, {
      totalActiveClients: active,
      returnsByStatus,
      missingDocCount: missingDocs.length,
      missingDocs,
      staffWorkload,
      approachingDeadlines: deadlines,
      extensionsPending: db.clients.filter((c) => c.status === 'Extended').length,
      filedCount: db.clients.filter((c) => c.status === 'Filed').length,
      recentAudit: db.auditLog.slice(0, 30)
    });
  }

  return false;
}

function serveStatic(req, res) {
  const requested = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(publicDir, requested);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.jsx': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json'
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const handled = await routeApi(req, res);
    if (handled !== false) return;
  }
  serveStatic(req, res);
});

ensureDb();
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexus app running on http://0.0.0.0:${PORT}`);
});
