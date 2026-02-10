const { useEffect, useState } = React;
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });

function App() {
  const [portalCode, setPortalCode] = useState(new URLSearchParams(window.location.search).get('code') || '');
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [uploadCategory, setUploadCategory] = useState('Current Year/1099s');

  const load = async () => {
    setError('');
    if (!portalCode) return;
    const res = await fetch(`/api/client/session?portalCode=${encodeURIComponent(portalCode)}`);
    const json = await res.json();
    if (!res.ok) return setError(json.error || 'Failed login');
    setSession(json);
  };

  useEffect(() => { load(); }, []);

  const upload = async (file, source='client-upload') => {
    if (!file || !session) return;
    const base64 = await toBase64(file);
    const res = await fetch(`/api/client/${session.id}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalCode, base64, originalName: file.name, category: uploadCategory, source })
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error || 'Upload failed');
    await load();
  };

  return <div className="wrap">
    <div className="hero"><h1>Secure Client Portal</h1><p>This portal is separate from admin. Enter your portal code to continue.</p></div>
    <div className="card"><label>Portal Code</label><input value={portalCode} onChange={(e)=>setPortalCode(e.target.value)} placeholder="portal-xxxxxx" /><button onClick={load}>Sign In</button>{error && <p>{error}</p>}</div>
    {session && <>
      <div className="grid g2">
        <div className="card"><h3>Welcome, {session.name}</h3><p>Status: <b>{session.status}</b></p><p>Tax Years: {session.taxYears.join(', ')}</p>
          <h4>Requested Documents</h4>{session.requests.length===0?<p>None right now.</p>:session.requests.map(r=><div className="file" key={r.id}><div>{r.text}</div><div>{r.priority}</div></div>)}
          <h4>Upload</h4><select value={uploadCategory} onChange={(e)=>setUploadCategory(e.target.value)}>{['Intake','Current Year/W2s','Current Year/1099s','Current Year/K-1s','Misc'].map(f=><option key={f}>{f}</option>)}</select>
          <input type="file" onChange={(e)=>upload(e.target.files[0],'client-upload')} />
          <h4>Scan from phone camera</h4><input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e)=>upload(e.target.files[0],'client-scan')} />
        </div>
        <div className="card"><h3>Your Files</h3>{session.files.map(f=><div className="file" key={f.id}><div><b>{f.originalName}</b><div className="small">{f.category} v{f.version}</div></div><div>{f.source}</div></div>)}
          <h3>Checklist</h3>{session.checklist.map(c=><div className="file" key={c.doc}><div>{c.doc}</div><div>{c.found?'Received':'Needed'}</div></div>)}
        </div>
      </div>
    </>}
  </div>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
