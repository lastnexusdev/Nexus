const { useEffect, useMemo, useState } = React;

const users = {
  admin: { user: 'Alex Admin', role: 'Admin' },
  client: { user: 'Client User', role: 'Client' }
};

async function api(url, options = {}, actor = users.admin) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-user': actor.user,
      'x-role': actor.role,
      ...(options.headers || {})
    },
    ...options
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function kpiCard(label, value, sub) {
  return (
    <article className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </article>
  );
}

function App() {
  const [mode, setMode] = useState('admin');
  const actor = mode === 'admin' ? users.admin : users.client;

  const [view, setView] = useState('dashboard');
  const [meta, setMeta] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [portalClient, setPortalClient] = useState(null);
  const [error, setError] = useState('');

  const [newClient, setNewClient] = useState({
    name: '', businessName: '', entityType: '1040', taxYears: '2025', assignedStaff: '', identifiers: ''
  });
  const [newFile, setNewFile] = useState({ category: 'Current Year/W2s', originalName: '', taxYear: '2025', internalOnly: false });
  const [note, setNote] = useState('');
  const [requestText, setRequestText] = useState('Please upload missing W-2 and 1099 documents.');
  const [scanDocType, setScanDocType] = useState('intake-packet');

  const refreshAdmin = async () => {
    setError('');
    try {
      const [m, d, c] = await Promise.all([
        api('/api/meta', {}, actor),
        api('/api/dashboard', {}, actor),
        api(`/api/clients?search=${encodeURIComponent(search)}`, {}, actor)
      ]);
      setMeta(m);
      setDashboard(d);
      setClients(c);
      if (!selectedClientId && c[0]) setSelectedClientId(c[0].id);
    } catch (e) {
      setError(e.message);
    }
  };

  const refreshPortal = async () => {
    setError('');
    try {
      const c = await api('/api/clients?search=', {}, users.admin);
      const target = c[0];
      if (!target) {
        setPortalClient(null);
        return;
      }
      const p = await api(`/api/portal/${target.id}`, {}, actor);
      setPortalClient(p);
      setSelectedClientId(target.id);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (mode === 'admin') refreshAdmin();
    else refreshPortal();
  }, [mode, search]);

  useEffect(() => {
    if (!selectedClientId || mode !== 'admin') return;
    api(`/api/clients/${selectedClientId}`, {}, actor).then(setSelectedClient).catch((e) => setError(e.message));
  }, [selectedClientId, mode]);

  const statuses = meta?.statuses || [];

  const missingSeverity = (client) => {
    const missing = client?.checklist?.filter((x) => !x.found).length || 0;
    if (missing === 0) return { label: 'Good to go', className: 'chip green' };
    if (missing <= 2) return { label: 'Needs attention', className: 'chip yellow' };
    return { label: 'Action required', className: 'chip red' };
  };

  const createClient = async () => {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        ...newClient,
        taxYears: newClient.taxYears.split(',').map((v) => v.trim()),
        identifiers: newClient.identifiers.split(',').map((v) => v.trim()).filter(Boolean)
      })
    }, actor);
    setNewClient({ name: '', businessName: '', entityType: '1040', taxYears: '2025', assignedStaff: '', identifiers: '' });
    refreshAdmin();
  };

  const uploadFile = async () => {
    await api(`/api/clients/${selectedClientId}/files`, {
      method: 'POST',
      body: JSON.stringify({ ...newFile, content: `uploaded:${newFile.originalName}` })
    }, actor);
    setNewFile({ ...newFile, originalName: '' });
    setSelectedClient(await api(`/api/clients/${selectedClientId}`, {}, actor));
    refreshAdmin();
  };

  const scanFileAdmin = async () => {
    await api(`/api/clients/${selectedClientId}/scan`, {
      method: 'POST',
      body: JSON.stringify({
        docType: scanDocType,
        category: 'Intake',
        taxYear: String(new Date().getFullYear()),
        content: `scan-from-admin:${scanDocType}`,
        ocrText: `Extracted OCR text for ${scanDocType}`
      })
    }, actor);
    setSelectedClient(await api(`/api/clients/${selectedClientId}`, {}, actor));
    refreshAdmin();
  };

  const scanFileClient = async () => {
    if (!selectedClientId) return;
    await api(`/api/clients/${selectedClientId}/scan`, {
      method: 'POST',
      body: JSON.stringify({
        docType: 'client-phone-scan',
        category: 'Current Year/1099s',
        content: 'scan-from-client-camera',
        ocrText: 'Client camera scan OCR result'
      })
    }, actor);
    const p = await api(`/api/portal/${selectedClientId}`, {}, actor);
    setPortalClient(p);
  };

  const addNote = async () => {
    await api(`/api/clients/${selectedClientId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text: note, mentions: (note.match(/@\w+/g) || []).map((m) => m.slice(1)) })
    }, actor);
    setNote('');
    setSelectedClient(await api(`/api/clients/${selectedClientId}`, {}, actor));
  };

  const updateStatus = async (status) => {
    await api(`/api/clients/${selectedClientId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, actor);
    setSelectedClient(await api(`/api/clients/${selectedClientId}`, {}, actor));
    refreshAdmin();
  };

  const createRequest = async () => {
    await api(`/api/clients/${selectedClientId}/requests`, {
      method: 'POST',
      body: JSON.stringify({ text: requestText, priority: 'high' })
    }, actor);
    setSelectedClient(await api(`/api/clients/${selectedClientId}`, {}, actor));
  };

  const workloadSummary = useMemo(() => {
    if (!dashboard?.staffWorkload) return [];
    return dashboard.staffWorkload.slice().sort((a, b) => b.assigned - a.assigned);
  }, [dashboard]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Nexus TaxOps</div>
        <p className="sub">Built for a calm, productive 8:00am.</p>

        <div className="mode-toggle">
          <button className={mode === 'admin' ? 'active' : ''} onClick={() => { setMode('admin'); setView('dashboard'); }}>Admin View</button>
          <button className={mode === 'client' ? 'active' : ''} onClick={() => { setMode('client'); setView('portal'); }}>Client View</button>
        </div>

        {mode === 'admin' && (
          <>
            {['dashboard', 'clients', 'workflow', 'compliance'].map((v) => (
              <button className={`nav ${view === v ? 'active' : ''}`} key={v} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
            ))}
            <input className="search" placeholder="Search client, EIN/SSN, status..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </>
        )}
      </aside>

      <main className="main">
        {error ? <div className="alert">{error}</div> : null}

        {mode === 'admin' && view === 'dashboard' && dashboard && (
          <section className="stack">
            <header className="hero">
              <div>
                <h1>Morning Command Center</h1>
                <p>Everything a preparer needs at a glance: priorities, deadlines, missing docs, and workload.</p>
              </div>
            </header>

            <div className="kpi-grid">
              {kpiCard('Active Clients', dashboard.totalActiveClients, 'excluding archived')}
              {kpiCard('Missing Doc Cases', dashboard.missingDocCount, 'requires follow-up')}
              {kpiCard('Extensions Pending', dashboard.extensionsPending, 'watch filing dates')}
              {kpiCard('Filed Returns', dashboard.filedCount, 'season progress')}
            </div>

            <div className="grid-3">
              <article className="card">
                <h3>Returns by status</h3>
                {Object.entries(dashboard.returnsByStatus).map(([k, v]) => <div key={k} className="line"><span>{k}</span><b>{v}</b></div>)}
              </article>
              <article className="card">
                <h3>Staff workload</h3>
                {workloadSummary.map((w) => <div key={w.staff} className="line"><span>{w.staff}</span><b>{w.assigned}</b></div>)}
              </article>
              <article className="card">
                <h3>Priority queue</h3>
                {(dashboard.missingDocs || []).slice(0, 6).map((r) => (
                  <div key={r.clientId} className="priority-item">
                    <b>{r.clientName}</b>
                    <small>Missing: {r.missing.join(', ')}</small>
                  </div>
                ))}
              </article>
            </div>
          </section>
        )}

        {mode === 'admin' && view === 'clients' && (
          <section className="grid-2">
            <article className="card list-card">
              <h3>Client Containers</h3>
              <div className="scroll">
                {clients.map((c) => (
                  <div key={c.id} className={`client-item ${selectedClientId === c.id ? 'active' : ''}`} onClick={() => setSelectedClientId(c.id)}>
                    <div className="line"><b>{c.name || c.businessName}</b><span className="status-pill">{c.status}</span></div>
                    <small>{c.entityType} · {c.taxYears.join(', ')} · {c.assignedStaff || 'Unassigned'}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="card">
              <h3>Create a new client</h3>
              <div className="form-grid">
                <input placeholder="Client / Business Name" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                <input placeholder="Business name (optional)" value={newClient.businessName} onChange={(e) => setNewClient({ ...newClient, businessName: e.target.value })} />
                <select value={newClient.entityType} onChange={(e) => setNewClient({ ...newClient, entityType: e.target.value })}>
                  {['1040', '1120', '1120S', '1065'].map((x) => <option key={x}>{x}</option>)}
                </select>
                <input placeholder="Tax years (2025,2024)" value={newClient.taxYears} onChange={(e) => setNewClient({ ...newClient, taxYears: e.target.value })} />
                <input placeholder="Assigned staff" value={newClient.assignedStaff} onChange={(e) => setNewClient({ ...newClient, assignedStaff: e.target.value })} />
                <input placeholder="Masked EIN/SSN" value={newClient.identifiers} onChange={(e) => setNewClient({ ...newClient, identifiers: e.target.value })} />
              </div>
              <button className="btn primary" onClick={createClient}>Create Container</button>
            </article>
          </section>
        )}

        {mode === 'admin' && view === 'workflow' && selectedClient && (
          <section className="stack">
            <header className="card split">
              <div>
                <h2>{selectedClient.name}</h2>
                <p>{selectedClient.clientInternalId} · {selectedClient.entityType} · {selectedClient.taxYears.join(', ')}</p>
              </div>
              <div className={missingSeverity(selectedClient).className}>{missingSeverity(selectedClient).label}</div>
            </header>

            <div className="kanban">
              {statuses.map((s) => (
                <article key={s} className="kan-col">
                  <h4>{s}</h4>
                  {clients.filter((c) => c.status === s).map((c) => <div className="kan-item" key={c.id} onClick={() => setSelectedClientId(c.id)}>{c.name}</div>)}
                </article>
              ))}
            </div>

            <div className="grid-2">
              <article className="card">
                <h3>Files + Scan Center</h3>
                <div className="form-grid compact">
                  <select value={newFile.category} onChange={(e) => setNewFile({ ...newFile, category: e.target.value })}>
                    {(meta?.defaultFolders || []).map((f) => <option key={f}>{f}</option>)}
                  </select>
                  <input placeholder="Original file name" value={newFile.originalName} onChange={(e) => setNewFile({ ...newFile, originalName: e.target.value })} />
                  <label className="line"><input type="checkbox" checked={newFile.internalOnly} onChange={(e) => setNewFile({ ...newFile, internalOnly: e.target.checked })} /> Internal only</label>
                  <button className="btn" onClick={uploadFile}>Upload to folder</button>
                </div>
                <div className="scan-box">
                  <h4>Direct scan (admin scanner)</h4>
                  <input value={scanDocType} onChange={(e) => setScanDocType(e.target.value)} placeholder="Doc type" />
                  <button className="btn primary" onClick={scanFileAdmin}>Scan & Attach</button>
                </div>

                <h4>Client visible files</h4>
                <div className="scroll small">
                  {selectedClient.files.filter((f) => !f.internalOnly).map((f) => (
                    <div className="file-row" key={f.id}>
                      <div><b>{f.originalName}</b><small>{f.category} · v{f.version}</small></div>
                      <span>{f.source}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="card">
                <h3>Checklist + Requests</h3>
                {(selectedClient.checklist || []).map((c) => <div className="line" key={c.doc}><span>{c.doc}</span><b>{c.found ? '✓' : 'Missing'}</b></div>)}
                <textarea rows="3" value={requestText} onChange={(e) => setRequestText(e.target.value)} />
                <button className="btn" onClick={createRequest}>Request documents</button>
                <h4>Change status</h4>
                <select value={selectedClient.status} onChange={(e) => updateStatus(e.target.value)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
              </article>
            </div>

            <div className="grid-2">
              <article className="card">
                <h3>Internal team notes</h3>
                <textarea rows="3" placeholder="Use @mentions for staff" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn" onClick={addNote}>Save note</button>
                <div className="scroll small">
                  {(selectedClient.notes || []).map((n) => <div key={n.id} className="log"><b>{n.actor}</b><small>{new Date(n.timestamp).toLocaleString()}</small><p>{n.text}</p></div>)}
                </div>
              </article>
              <article className="card">
                <h3>Activity Timeline</h3>
                <div className="scroll small">
                  {(selectedClient.events || []).map((e) => <div key={e.id} className="log"><b>{e.type}</b><small>{new Date(e.timestamp).toLocaleString()}</small><p>{e.message}</p></div>)}
                </div>
              </article>
            </div>
          </section>
        )}

        {mode === 'admin' && view === 'compliance' && dashboard && (
          <section className="grid-2">
            <article className="card">
              <h3>Audit trail (recent)</h3>
              <div className="scroll small">
                {dashboard.recentAudit.map((a) => <div key={a.id} className="line"><span>{a.action} · {a.actor}</span><small>{new Date(a.timestamp).toLocaleString()}</small></div>)}
              </div>
            </article>
            <article className="card">
              <h3>Security posture</h3>
              <ul>
                <li>Role-based write restrictions enabled.</li>
                <li>Client portal view excludes internal notes/internal files.</li>
                <li>Files stored outside static web root.</li>
                <li>Scan uploads are audited with source labels.</li>
              </ul>
            </article>
          </section>
        )}

        {mode === 'client' && view === 'portal' && (
          <section className="stack">
            <header className="hero client">
              <div>
                <h1>Welcome to your secure tax portal</h1>
                <p>Upload or scan documents from your phone, track progress, and see exactly what we still need.</p>
              </div>
            </header>

            {!portalClient ? (
              <article className="card">No client record is available yet. Create one in Admin View first.</article>
            ) : (
              <>
                <div className="kpi-grid">
                  {kpiCard('Current Status', portalClient.status)}
                  {kpiCard('Your Tax Years', portalClient.taxYears.join(', '))}
                  {kpiCard('Open Requests', portalClient.requests.filter((r) => !r.completed).length)}
                  {kpiCard('Uploaded Files', portalClient.files.length)}
                </div>

                <div className="grid-2">
                  <article className="card">
                    <h3>Requested documents</h3>
                    {portalClient.requests.length === 0 ? <p>No requests right now.</p> : portalClient.requests.map((r) => (
                      <div className="priority-item" key={r.id}>
                        <b>{r.text}</b>
                        <small>Priority: {r.priority}</small>
                      </div>
                    ))}

                    <h4>Scan from phone / camera</h4>
                    <p className="muted">Tap scan to simulate direct camera-to-folder document capture.</p>
                    <button className="btn primary" onClick={scanFileClient}>Scan & Upload Now</button>
                  </article>

                  <article className="card">
                    <h3>Your visible files</h3>
                    <div className="scroll small">
                      {portalClient.files.map((f) => (
                        <div className="file-row" key={f.id}>
                          <div><b>{f.originalName}</b><small>{f.category} · v{f.version}</small></div>
                          <span>{f.source}</span>
                        </div>
                      ))}
                    </div>

                    <h4>Checklist</h4>
                    {portalClient.checklist.map((c) => <div className="line" key={c.doc}><span>{c.doc}</span><b>{c.found ? 'Received' : 'Needed'}</b></div>)}
                  </article>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
