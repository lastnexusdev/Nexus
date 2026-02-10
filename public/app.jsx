const { useEffect, useMemo, useState } = React;

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-user': 'Alex Admin',
      'x-role': 'Admin',
      ...(options.headers || {})
    },
    ...options
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

function App() {
  const [view, setView] = useState('dashboard');
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [meta, setMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const [newClient, setNewClient] = useState({
    name: '', businessName: '', entityType: '1040', taxYears: '2025', assignedStaff: '', identifiers: ''
  });
  const [newFile, setNewFile] = useState({ category: 'Current Year/W2s', originalName: '', taxYear: '2025' });
  const [note, setNote] = useState('');

  const refreshAll = async () => {
    setError('');
    try {
      const [clientRows, dash, metaRows] = await Promise.all([
        api(`/api/clients?search=${encodeURIComponent(search)}`),
        api('/api/dashboard'),
        api('/api/meta')
      ]);
      setClients(clientRows);
      setDashboard(dash);
      setMeta(metaRows);
      if (!selectedClientId && clientRows[0]) setSelectedClientId(clientRows[0].id);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { refreshAll(); }, [search]);
  useEffect(() => {
    if (!selectedClientId) return;
    api(`/api/clients/${selectedClientId}`).then(setSelectedClient).catch((e) => setError(e.message));
  }, [selectedClientId]);

  const statuses = meta?.statuses || [];

  const createClient = async () => {
    await api('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        ...newClient,
        taxYears: newClient.taxYears.split(',').map((v) => v.trim()),
        identifiers: newClient.identifiers.split(',').map((v) => v.trim()).filter(Boolean)
      })
    });
    setNewClient({ name: '', businessName: '', entityType: '1040', taxYears: '2025', assignedStaff: '', identifiers: '' });
    await refreshAll();
  };

  const uploadFile = async () => {
    await api(`/api/clients/${selectedClientId}/files`, {
      method: 'POST',
      body: JSON.stringify({ ...newFile, content: `placeholder for ${newFile.originalName}` })
    });
    setNewFile({ ...newFile, originalName: '' });
    const updated = await api(`/api/clients/${selectedClientId}`);
    setSelectedClient(updated);
    await refreshAll();
  };

  const addNote = async () => {
    await api(`/api/clients/${selectedClientId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text: note, mentions: (note.match(/@\w+/g) || []).map((m) => m.replace('@', '')) })
    });
    setNote('');
    setSelectedClient(await api(`/api/clients/${selectedClientId}`));
  };

  const updateStatus = async (status) => {
    await api(`/api/clients/${selectedClientId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    setSelectedClient(await api(`/api/clients/${selectedClientId}`));
    await refreshAll();
  };

  const indicator = (client) => {
    const missing = client?.checklist?.filter((c) => !c.found).length || 0;
    if (missing === 0) return { label: 'Green', color: '#0e9f6e' };
    if (missing <= 2) return { label: 'Yellow', color: '#e49f00' };
    return { label: 'Red', color: '#d64545' };
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Nexus Tax Ops</h1>
        {['dashboard', 'clients', 'workflow', 'portal'].map((v) => (
          <button key={v} className={`nav-btn ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>
            {v === 'portal' ? 'Client Portal (Phase 2)' : v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
        <div style={{ marginTop: 12 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, EIN/SSN, year..." />
        </div>
      </aside>

      <main className="main">
        {error ? <div className="card" style={{ border: '1px solid #d64545' }}>{error}</div> : null}

        {view === 'dashboard' && dashboard && (
          <div className="row" style={{ gap: 14 }}>
            <div className="row cols-4">
              <div className="card"><div className="muted">Total Active Clients</div><div className="metric">{dashboard.totalActiveClients}</div></div>
              <div className="card"><div className="muted">Missing Doc Counts</div><div className="metric">{dashboard.missingDocCount}</div></div>
              <div className="card"><div className="muted">Extensions Pending</div><div className="metric">{dashboard.extensionsPending}</div></div>
              <div className="card"><div className="muted">Filed vs Pending</div><div className="metric">{dashboard.filedCount} / {dashboard.totalActiveClients}</div></div>
            </div>

            <div className="row cols-3">
              <div className="card">
                <h3>Returns by Status</h3>
                {Object.entries(dashboard.returnsByStatus).map(([status, count]) => (
                  <div key={status} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span>{status}</span><b>{count}</b>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3>Staff Workload</h3>
                {dashboard.staffWorkload.map((row) => (
                  <div key={row.staff} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span>{row.staff}</span><b>{row.assigned}</b>
                  </div>
                ))}
              </div>

              <div className="card">
                <h3>Approaching Priorities @8am</h3>
                {dashboard.missingDocs.slice(0, 4).map((row) => (
                  <div key={row.clientId} className="warn">
                    <b>{row.clientName}</b>
                    <div className="muted">Missing: {row.missing.join(', ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {view === 'clients' && (
          <div className="grid-2">
            <div className="card">
              <h3>Client Registry</h3>
              <div className="client-list">
                {clients.map((c) => (
                  <div key={c.id} className={`client-row ${selectedClientId === c.id ? 'active' : ''}`} onClick={() => setSelectedClientId(c.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <b>{c.name || c.businessName}</b>
                      <span className={`badge status-${c.status.replace(/\s/g, '\\ ')}`}>{c.status}</span>
                    </div>
                    <div className="muted">{c.entityType} • {c.taxYears.join(', ')} • {c.assignedStaff || 'Unassigned'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>Create Client Container</h3>
              <div className="row">
                <input placeholder="Client / Business Name" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
                <input placeholder="Business Name (optional)" value={newClient.businessName} onChange={(e) => setNewClient({ ...newClient, businessName: e.target.value })} />
                <div className="grid-2">
                  <select value={newClient.entityType} onChange={(e) => setNewClient({ ...newClient, entityType: e.target.value })}>
                    {['1040', '1120', '1120S', '1065'].map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input placeholder="Tax year(s): 2025,2024" value={newClient.taxYears} onChange={(e) => setNewClient({ ...newClient, taxYears: e.target.value })} />
                </div>
                <input placeholder="Assigned staff" value={newClient.assignedStaff} onChange={(e) => setNewClient({ ...newClient, assignedStaff: e.target.value })} />
                <input placeholder="EIN / SSN (masked), comma separated" value={newClient.identifiers} onChange={(e) => setNewClient({ ...newClient, identifiers: e.target.value })} />
                <button className="primary" onClick={createClient}>Create Client</button>
              </div>
            </div>
          </div>
        )}

        {view === 'workflow' && (
          <div className="row" style={{ gap: 12 }}>
            <div className="kanban">
              {statuses.map((s) => (
                <div className="kan-col" key={s}>
                  <b>{s}</b>
                  {clients.filter((c) => c.status === s).map((c) => <div key={c.id} className="kan-item" onClick={() => { setView('clients'); setSelectedClientId(c.id); }}>{c.name}</div>)}
                </div>
              ))}
            </div>

            {selectedClient && (
              <div className="grid-2">
                <div className="card">
                  <h3>{selectedClient.name} – structured file area</h3>
                  <div className="muted">Client Internal ID: {selectedClient.clientInternalId}</div>
                  <div className="grid-2" style={{ marginTop: 10 }}>
                    <select value={newFile.category} onChange={(e) => setNewFile({ ...newFile, category: e.target.value })}>
                      {(meta?.defaultFolders || []).filter((f) => !f.endsWith('.pdf')).map((folder) => <option key={folder}>{folder}</option>)}
                    </select>
                    <input placeholder="Original file name" value={newFile.originalName} onChange={(e) => setNewFile({ ...newFile, originalName: e.target.value })} />
                  </div>
                  <button className="primary" style={{ marginTop: 10 }} onClick={uploadFile}>Upload (auto-sort + rename + version)</button>

                  <h4>Latest Files</h4>
                  {(selectedClient.files || []).slice(0, 8).map((f) => (
                    <div key={f.id} style={{ borderBottom: '1px solid #edf2fa', padding: '6px 0' }}>
                      <b>{f.originalName}</b> <span className="muted">v{f.version}</span>
                      <div className="muted">{f.category} • {f.storedName}</div>
                    </div>
                  ))}
                </div>

                <div className="card">
                  <h3>Missing Document Tracker</h3>
                  <div>
                    {(selectedClient.checklist || []).map((item) => (
                      <div key={item.doc} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span>{item.doc}</span>
                        <span style={{ color: item.found ? '#0e9f6e' : '#d64545' }}>{item.found ? 'Found' : 'Missing'}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ margin: '10px 0' }}>Visual indicator: <b style={{ color: indicator(selectedClient).color }}>{indicator(selectedClient).label}</b></div>
                  <button className="ghost" onClick={() => setNote(`@client Missing docs requested on ${new Date().toLocaleDateString()}`)}>Request documents</button>

                  <h4 style={{ marginTop: 14 }}>Update Status</h4>
                  <select value={selectedClient.status} onChange={(e) => updateStatus(e.target.value)}>
                    {statuses.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            )}

            {selectedClient && (
              <div className="grid-2">
                <div className="card">
                  <h3>Internal Notes & Timeline</h3>
                  <textarea rows="3" placeholder="Add note with @mentions. Internal only." value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="primary" style={{ marginTop: 8 }} onClick={addNote}>Add Note</button>
                  <div className="timeline" style={{ marginTop: 10 }}>
                    {(selectedClient.notes || []).map((n) => (
                      <div key={n.id} style={{ borderBottom: '1px solid #edf2fa', padding: '6px 0' }}>
                        <b>{n.actor}</b> <span className="muted">{new Date(n.timestamp).toLocaleString()}</span>
                        <div>{n.text}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <h3>Audit Events</h3>
                  <div className="timeline">
                    {(selectedClient.events || []).map((e) => (
                      <div key={e.id} style={{ borderBottom: '1px solid #edf2fa', padding: '6px 0' }}>
                        <b>{e.type === 'manual' ? 'Note' : 'System'}</b> <span className="muted">{new Date(e.timestamp).toLocaleString()}</span>
                        <div>{e.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === 'portal' && (
          <div className="card">
            <h3>Client Portal (Phase 2 ready)</h3>
            <ul>
              <li>Secure client login + separate permission layer (no internal note access).</li>
              <li>Document requests, upload area, secure messaging, filed return downloads.</li>
              <li>Signed URL and expiring download links wired to backend audit events.</li>
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
