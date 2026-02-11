const { useEffect, useState } = React;

const headers = { 'Content-Type': 'application/json', 'x-user': 'Admin User', 'x-role': 'Admin' };
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

function App() {
  const [dash, setDash] = useState(null);
  const [clients, setClients] = useState([]);
  const [meta, setMeta] = useState({ statuses: [], folders: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [reqText, setReqText] = useState('Please upload missing documents.');
  const [form, setForm] = useState({ name:'', entityType:'1040', taxYears:'2025', assignedStaff:'' });
  const [uploadCategory, setUploadCategory] = useState('Current Year/W2s');
  const [uploadInternal, setUploadInternal] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setError('');
      const [m, d, c] = await Promise.all([
        fetch('/api/meta').then((r) => r.json()),
        fetch('/api/admin/dashboard').then((r) => r.json()),
        fetch(`/api/admin/clients?q=${encodeURIComponent(search)}`).then((r) => r.json())
      ]);
      setMeta(m); setDash(d); setClients(c);
      if (!selectedId && c[0]) setSelectedId(c[0].id);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { refresh(); }, [search]);
  useEffect(() => { if (selectedId) fetch(`/api/admin/clients/${selectedId}`).then((r)=>r.json()).then(setSelected); }, [selectedId]);

  const createClient = async () => {
    await fetch('/api/admin/clients', { method:'POST', headers, body: JSON.stringify({ ...form, taxYears: form.taxYears.split(',').map(s=>s.trim()) }) });
    setForm({ name:'', entityType:'1040', taxYears:'2025', assignedStaff:'' });
    refresh();
  };

  const uploadFromInput = async (file, source='upload') => {
    if (!file || !selectedId) return;
    const base64 = await toBase64(file);
    await fetch(`/api/admin/clients/${selectedId}/upload`, { method:'POST', headers, body: JSON.stringify({ base64, originalName: file.name, category: uploadCategory, internalOnly: uploadInternal, source }) });
    setSelected(await fetch(`/api/admin/clients/${selectedId}`).then((r)=>r.json()));
    refresh();
  };

  const changeStatus = async (status) => {
    await fetch(`/api/admin/clients/${selectedId}/status`, { method:'PATCH', headers, body: JSON.stringify({ status }) });
    setSelected(await fetch(`/api/admin/clients/${selectedId}`).then((r)=>r.json()));
    refresh();
  };

  const addNote = async () => {
    await fetch(`/api/admin/clients/${selectedId}/notes`, { method:'POST', headers, body: JSON.stringify({ text: note }) });
    setNote('');
    setSelected(await fetch(`/api/admin/clients/${selectedId}`).then((r)=>r.json()));
  };

  const addRequest = async () => {
    await fetch(`/api/admin/clients/${selectedId}/requests`, { method:'POST', headers, body: JSON.stringify({ text: reqText, priority:'high' }) });
    setSelected(await fetch(`/api/admin/clients/${selectedId}`).then((r)=>r.json()));
  };

  return <div className="layout"><aside className="side"><h2>Nexus Admin</h2><p className="small">Separate admin app</p><input placeholder="Search" value={search} onChange={(e)=>setSearch(e.target.value)} /></aside><main className="main">{error && <div className="card">{error}</div>}
    {dash && <div className="grid g4">{[['Active',dash.active],['Total',dash.total],['Filed',dash.filed],['Extensions',dash.extensions]].map(([k,v])=><div className="card" key={k}><div className="small">{k}</div><h2>{v}</h2></div>)}</div>}
    <div className="grid g2">
      <div className="card"><h3>Clients</h3><div className="list">{clients.map(c=><div key={c.id} className={`item ${selectedId===c.id?'active':''}`} onClick={()=>setSelectedId(c.id)}><div className="row"><b>{c.name}</b><span className="pill">{c.status}</span></div><div className="small">Portal code: {c.portalCode}</div></div>)}</div></div>
      <div className="card"><h3>New Client</h3><input placeholder="Name" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/><select value={form.entityType} onChange={(e)=>setForm({...form,entityType:e.target.value})}>{['1040','1120','1120S','1065'].map(e=><option key={e}>{e}</option>)}</select><input placeholder="Tax years csv" value={form.taxYears} onChange={(e)=>setForm({...form,taxYears:e.target.value})}/><input placeholder="Assigned staff" value={form.assignedStaff} onChange={(e)=>setForm({...form,assignedStaff:e.target.value})}/><button onClick={createClient}>Create</button></div>
    </div>
    {selected && <div className="grid g2">
      <div className="card"><h3>{selected.name}</h3><div className="small">Internal ID {selected.clientInternalId}</div><select value={selected.status} onChange={(e)=>changeStatus(e.target.value)}>{meta.statuses.map(s=><option key={s}>{s}</option>)}</select>
        <h4>File Upload</h4><select value={uploadCategory} onChange={(e)=>setUploadCategory(e.target.value)}>{meta.folders.map(f=><option key={f}>{f}</option>)}</select>
        <label className="small"><input type="checkbox" checked={uploadInternal} onChange={(e)=>setUploadInternal(e.target.checked)} /> Internal only</label>
        <input type="file" onChange={(e)=>uploadFromInput(e.target.files[0],'upload')} />
        <h4>Scan from scanner/camera</h4><input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e)=>uploadFromInput(e.target.files[0],'scan')} />
        <h4>Checklist</h4>{selected.checklist.map(i=><div className="row" key={i.doc}><span>{i.doc}</span><b>{i.found?'✓':'Missing'}</b></div>)}
      </div>
      <div className="card"><h3>Client Visible Files</h3><div className="scroll">{selected.files.filter(f=>!f.internalOnly).map(f=><div className="item" key={f.id}><b>{f.originalName}</b><div className="small">{f.category} v{f.version} • {f.source}</div></div>)}</div>
      <h4>Request docs</h4><textarea value={reqText} onChange={(e)=>setReqText(e.target.value)} /><button onClick={addRequest}>Send Request</button>
      <h4>Internal Notes</h4><textarea value={note} onChange={(e)=>setNote(e.target.value)} /><button onClick={addNote}>Save Note</button>
      </div>
    </div>}
    {dash && <div className="grid g2"><div className="card"><h3>Missing Docs Queue</h3>{dash.missing.slice(0,8).map(m=><div key={m.id} className="warn"><b>{m.name}</b><div className="small">{m.missing.join(', ')}</div></div>)}</div><div className="card"><h3>Audit</h3><div className="scroll">{dash.audit.map(a=><div key={a.id} className="small">{a.at} • {a.action} • {a.actor}</div>)}</div></div></div>}
  </main></div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
