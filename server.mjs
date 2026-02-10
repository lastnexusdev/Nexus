import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const storageDir = path.join(__dirname, 'storage');
const dbPath = path.join(dataDir, 'db.json');

const defaultFolders = [
  'Intake',
  'Intake/Questionnaire.pdf',
  'Intake/ID.pdf',
  'Prior Year/2024',
  'Prior Year/2023',
  'Current Year/W2s',
  'Current Year/1099s',
  'Current Year/K-1s',
  'Workpapers',
  'Filed Returns',
  'Misc'
];

const statusFlow = [
  'Intake Received',
  'Missing Docs',
  'Data Entry',
  'Review',
  'Ready to File',
  'Filed',
  'Extended',
  'Archived'
];

const requiredDocsByEntity = {
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
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
  });
}

function addAudit(db, event) {
  db.auditLog.unshift({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event });
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const db = loadDb();
  const actor = req.headers['x-user'] || 'system';
  const role = req.headers['x-role'] || 'Admin';

  if (url.pathname === '/api/meta' && req.method === 'GET') {
    return json(res, 200, {
      roles: ['Admin', 'Preparer', 'Reviewer', 'Read-only'],
      statuses: statusFlow,
      defaultFolders,
      requiredDocsByEntity,
      users: db.users
    });
  }

  if (url.pathname === '/api/clients' && req.method === 'GET') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const status = url.searchParams.get('status');
    const entityType = url.searchParams.get('entityType');
    const assignedStaff = url.searchParams.get('assignedStaff');

    const filtered = db.clients.filter((c) => {
      const searchable = [c.name, c.businessName, c.entityType, c.status, c.assignedStaff, ...(c.taxYears || []), ...(c.identifiers || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (search && !searchable.includes(search)) return false;
      if (status && c.status !== status) return false;
      if (entityType && c.entityType !== entityType) return false;
      if (assignedStaff && c.assignedStaff !== assignedStaff) return false;
      return true;
    });
    return json(res, 200, filtered);
  }

  if (url.pathname === '/api/clients' && req.method === 'POST') {
    if (role === 'Read-only') return json(res, 403, { error: 'Read-only role cannot create clients.' });
    return parseBody(req)
      .then((payload) => {
        const client = {
          id: `client-${Date.now()}`,
          clientInternalId: `C-${Math.floor(Math.random() * 90000 + 10000)}`,
          name: payload.name,
          businessName: payload.businessName || '',
          entityType: payload.entityType || '1040',
          taxYears: payload.taxYears || [new Date().getFullYear().toString()],
          status: payload.status || 'Intake Received',
          assignedStaff: payload.assignedStaff || '',
          notes: [],
          pinnedWarnings: [],
          identifiers: payload.identifiers || [],
          files: [],
          checklist: [],
          events: [
            {
              id: crypto.randomUUID(),
              type: 'system',
              message: 'Client created.',
              timestamp: new Date().toISOString(),
              actor
            }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        fs.mkdirSync(path.join(storageDir, client.id), { recursive: true });
        for (const folder of defaultFolders.filter((f) => !f.endsWith('.pdf'))) {
          fs.mkdirSync(path.join(storageDir, client.id, folder), { recursive: true });
        }

        db.clients.unshift(client);
        addAudit(db, { actor, role, action: 'CREATE_CLIENT', clientId: client.id, detail: client.name });
        saveDb(db);
        return json(res, 201, client);
      })
      .catch((error) => json(res, 400, { error: error.message }));
  }

  const fileMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/files$/);
  if (fileMatch && req.method === 'POST') {
    if (role === 'Read-only') return json(res, 403, { error: 'Read-only role cannot upload files.' });
    return parseBody(req)
      .then((payload) => {
        const client = db.clients.find((c) => c.id === fileMatch[1]);
        if (!client) return json(res, 404, { error: 'Client not found.' });

        if (['Filed', 'Archived'].includes(client.status)) {
          return json(res, 400, { error: `Uploads are locked while status is ${client.status}.` });
        }

        const category = payload.category || 'Misc';
        const originalName = sanitizeName(payload.originalName || 'document.txt');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const existingVersions = client.files.filter((f) => f.category === category && f.originalName === originalName).length;
        const version = existingVersions + 1;
        const storedName = `${timestamp}__${originalName}`;

        const duplicateStored = client.files.find((f) => f.category === category && f.storedName === storedName);
        if (duplicateStored && !payload.allowOverwrite) {
          return json(res, 409, { error: 'File exists. Set allowOverwrite=true to overwrite.' });
        }

        const filePath = path.join(storageDir, client.id, category);
        fs.mkdirSync(filePath, { recursive: true });
        fs.writeFileSync(path.join(filePath, storedName), payload.content || '');

        const fileRecord = {
          id: crypto.randomUUID(),
          category,
          originalName,
          storedName,
          version,
          uploadedBy: actor,
          uploadedAt: new Date().toISOString(),
          taxYear: payload.taxYear || new Date().getFullYear().toString(),
          tags: payload.tags || []
        };
        client.files.unshift(fileRecord);
        client.events.unshift({ id: crypto.randomUUID(), type: 'system', message: `File uploaded: ${originalName} (${category}) v${version}`, actor, timestamp: new Date().toISOString() });
        client.updatedAt = new Date().toISOString();
        addAudit(db, { actor, role, action: 'UPLOAD_FILE', clientId: client.id, detail: `${category}/${storedName}` });
        saveDb(db);
        return json(res, 201, fileRecord);
      })
      .catch((error) => json(res, 400, { error: error.message }));
  }

  const statusMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/status$/);
  if (statusMatch && req.method === 'PATCH') {
    if (!['Admin', 'Reviewer'].includes(role)) return json(res, 403, { error: 'Only Admin/Reviewer can change status.' });
    return parseBody(req)
      .then((payload) => {
        const client = db.clients.find((c) => c.id === statusMatch[1]);
        if (!client) return json(res, 404, { error: 'Client not found.' });
        if (!statusFlow.includes(payload.status)) return json(res, 400, { error: 'Unknown status.' });

        client.status = payload.status;
        client.updatedAt = new Date().toISOString();
        client.events.unshift({ id: crypto.randomUUID(), type: 'system', message: `Status changed to ${payload.status}`, actor, timestamp: new Date().toISOString() });
        addAudit(db, { actor, role, action: 'CHANGE_STATUS', clientId: client.id, detail: payload.status });
        saveDb(db);
        return json(res, 200, client);
      })
      .catch((error) => json(res, 400, { error: error.message }));
  }

  const noteMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/notes$/);
  if (noteMatch && req.method === 'POST') {
    if (role === 'Read-only') return json(res, 403, { error: 'Read-only role cannot add notes.' });
    return parseBody(req)
      .then((payload) => {
        const client = db.clients.find((c) => c.id === noteMatch[1]);
        if (!client) return json(res, 404, { error: 'Client not found.' });

        const note = {
          id: crypto.randomUUID(),
          text: payload.text,
          mentions: payload.mentions || [],
          pinned: Boolean(payload.pinned),
          actor,
          timestamp: new Date().toISOString(),
          internalOnly: true
        };
        client.notes.unshift(note);
        client.events.unshift({ id: crypto.randomUUID(), type: 'manual', message: `Note added by ${actor}`, actor, timestamp: note.timestamp });
        client.updatedAt = new Date().toISOString();
        addAudit(db, { actor, role, action: 'ADD_NOTE', clientId: client.id, detail: payload.text?.slice(0, 80) || '' });
        saveDb(db);
        return json(res, 201, note);
      })
      .catch((error) => json(res, 400, { error: error.message }));
  }

  const oneClientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (oneClientMatch && req.method === 'GET') {
    const client = db.clients.find((c) => c.id === oneClientMatch[1]);
    if (!client) return json(res, 404, { error: 'Client not found.' });
    const required = requiredDocsByEntity[client.entityType] || requiredDocsByEntity.default;
    const present = new Set(client.files.map((f) => f.originalName.toLowerCase()));
    const checklist = required.map((doc) => {
      const found = client.files.some((f) => f.originalName.toLowerCase().includes(doc.toLowerCase().replace(/[^a-z0-9]/gi, '')));
      return { doc, found };
    });
    return json(res, 200, { ...client, checklist });
  }

  if (url.pathname === '/api/dashboard' && req.method === 'GET') {
    const activeClients = db.clients.filter((c) => !['Archived'].includes(c.status)).length;
    const byStatus = Object.fromEntries(statusFlow.map((s) => [s, db.clients.filter((c) => c.status === s).length]));
    const missingDocs = db.clients
      .map((c) => {
        const required = requiredDocsByEntity[c.entityType] || requiredDocsByEntity.default;
        const missing = required.filter((doc) => !c.files.some((f) => f.originalName.toLowerCase().includes(doc.toLowerCase().replace(/[^a-z0-9]/gi, ''))));
        return { clientId: c.id, clientName: c.name, missing };
      })
      .filter((row) => row.missing.length > 0);

    const staffWorkload = db.users.map((u) => ({
      staff: u.name,
      assigned: db.clients.filter((c) => c.assignedStaff === u.name && !['Archived', 'Filed'].includes(c.status)).length
    }));

    return json(res, 200, {
      totalActiveClients: activeClients,
      returnsByStatus: byStatus,
      missingDocCount: missingDocs.length,
      missingDocs,
      staffWorkload,
      extensionsPending: db.clients.filter((c) => c.status === 'Extended').length,
      filedCount: db.clients.filter((c) => c.status === 'Filed').length,
      recentAudit: db.auditLog.slice(0, 20)
    });
  }

  return false;
}

function serveStatic(req, res) {
  let filePath = path.join(publicDir, req.url === '/' ? '/index.html' : req.url);
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
      '.css': 'text/css',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(content);
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Nexus app running on http://0.0.0.0:${PORT}`);
});
