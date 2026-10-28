import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, imagePayload } from './api';
import './styles.css';
import { recordedComparison } from './recorded';
const STATIC_REVIEW=import.meta.env.MODE==='review';
const assetBase=import.meta.env.BASE_URL;

const WATCHES = [
  { id: 'field', name: 'The Field', detail: 'Olive canvas · everyday utility', tone: '#4d6048' },
  { id: 'dress', name: 'The Dress', detail: 'Warm leather · quiet detail', tone: '#967856' },
  { id: 'diver', name: 'The Diver', detail: 'Midnight steel · a bolder profile', tone: '#344d58' },
];
const terminal = ['success','error','uncertain','paused'];
const Icon = ({ name, size = 20, ...props }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{({
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  heart: <path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-4 4 0 8 8 14 8-6 12-10 8-14Z" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
  clear: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  compare: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16" /></>,
  file: <><path d="M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h6"/></>,
})[name]}</svg>;

function FilePicker({ label, hint, value, onChange, disabled }) {
  const [error, setError] = useState('');
  const input = useRef();
  const select = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    setError('');
    if (!['image/jpeg','image/png'].includes(file.type) || file.size >= 8 * 1024 * 1024) { setError('Choose a JPEG or PNG smaller than 8 MB.'); event.target.value = ''; return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (Math.min(image.width,image.height) < 640 || Math.max(image.width,image.height) > 4096) throw new Error('Use 640–4096 pixels on each side.');
      onChange({ file, url, width: image.width, height: image.height });
    } catch (e) { URL.revokeObjectURL(url); setError(e.message || 'Could not read this image.'); }
    event.target.value = '';
  };
  return <div className="file-field"><label className={`upload ${value ? 'has-file' : ''}`}>
    {value ? <img src={value.url} alt={`${label} local preview`} /> : <Icon name="upload" size={24} />}
    <span><strong>{label}</strong><small>{value ? `${value.width} × ${value.height} · stays local until confirmation` : hint}</small></span>
    <input ref={input} type="file" accept="image/jpeg,image/png" aria-label={label} onChange={select} disabled={disabled} />
  </label>{error && <p className="field-error" role="alert">{error}</p>}</div>;
}

function ConsentDialog({ source, products, onClose, onConfirm }) {
  const [rights,setRights] = useState(false), [transfer,setTransfer] = useState(false), [units,setUnits] = useState(false);
  const ref = useRef();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} onCancel={onClose} className="consent-dialog">
    <div className="dialog-top"><span className="section-index">Before your photos leave this device</span><button className="icon-button" onClick={onClose} aria-label="Close confirmation"><Icon name="close" /></button></div>
    <h2>Your photos.<br/>Your decision.</h2>
    <p>This sends these three images to Perfect Corp. YouCam and creates two watch previews. API units may be consumed. This is an appearance preview, not a size measurement.</p>
    <div className="consent-previews">{[source, ...products].map((image,i) => <img key={i} src={image.url} alt={i === 0 ? 'Your selected wrist' : `Your selected watch ${i}`} />)}</div>
    <label className="check-row"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /><span>I own these images or have permission from the people and rights holders to use them.</span></label>
    <label className="check-row"><input type="checkbox" checked={transfer} onChange={e => setTransfer(e.target.checked)} /><span>I consent to sending these images to YouCam under its <a target="_blank" rel="noreferrer" href="https://www.perfectcorp.com/perfectbeauty/youcam/privacy-policy-api">privacy policy</a>. Clearing this app does not confirm deletion at YouCam.</span></label>
    <label className="check-row"><input type="checkbox" checked={units} onChange={e => setUnits(e.target.checked)} /><span>I authorize two render requests using this account’s API units. I have checked the current pricing in my YouCam account.</span></label>
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>Keep photos local</button><button className="primary" disabled={!rights || !transfer || !units} onClick={() => onConfirm({ version: 'photo-transfer-v1', rights, transfer, units })}>Send to YouCam <Icon name="arrow" /></button></div>
  </dialog>;
}

function Results({ job, mode, selected, favorite, setFavorite, onResume, busy, notes, setNotes }) {
  const complete = job?.items.some(i => i.state === 'success');
  const items = job?.items || (mode==='recorded'?recordedComparison(assetBase).items.map(item=>({...item,state:'empty',result:null})):selected.map(id => ({ label: WATCHES.find(w => w.id === id).name, state: 'empty', result: null, productId: id })));
  return <section className="comparison" id="comparison" aria-label="Watch comparison">
    <div className="canvas-heading"><span className="section-index">02 / The comparison</span><span className="canvas-status"><i className={job?.state === 'running' ? 'pulsing' : ''} />{!job ? 'Ready when you are' : ({ uploading: 'Transferring approved images', running: 'Preparing your comparison', success: 'Comparison ready', paused: 'Waiting for your next check', error: 'Review required', uncertain: 'Check provider console' })[job.state]}</span></div>
    <div className="canvases">{items.map((item,i) => <article className="preview" key={`${job?.id || 'empty'}-${i}`}>
      <div className="preview-top"><span>LOOK {String.fromCharCode(65 + i)}</span>{item.state === 'success' && <button className={`save-button ${favorite === i ? 'saved' : ''}`} aria-label={`${favorite === i ? 'Unsave' : 'Save'} look ${String.fromCharCode(65+i)}`} aria-pressed={favorite === i} onClick={() => setFavorite(favorite === i ? null : i)}><Icon name="heart" size={16} />{favorite === i ? 'Saved' : 'Save'}</button>}</div>
      <div className="image-area">
        {item.state === 'success' ? <img className="result-image" src={item.result} alt={`${item.label} ${job.mode === 'fixture' ? 'illustrated workflow fixture, not a YouCam render' : 'YouCam appearance preview'}`} onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextElementSibling.hidden=false; }} /> : <img className="result-image muted-image" src={`${assetBase}fixtures/${mode === 'fixture' ? (selected[i] || 'field') : 'wrist'}.svg`} alt={mode === 'fixture' ? 'Original vector watch fixture' : 'Wrist photo guide illustration'} />}
        <p hidden className="image-failed">Preview unavailable. It may have expired. No new render has been requested.</p>
        {job?.state === 'uncertain' && !item.hasProviderTask && item.state === 'submitting' ? <div className="render-overlay error-overlay"><strong>Submission not confirmed</strong><p>Check your YouCam console before creating another render. This look has no acknowledged task ID.</p></div> : ['running','submitting','queued'].includes(item.state) && <div className="render-overlay"><span className="spinner" /><strong>{job.mode === 'fixture' ? 'Running local workflow…' : 'Waiting for YouCam…'}</strong><small>{job.mode === 'fixture' ? 'No provider request is being made.' : 'You can leave this tab open.'}</small></div>}
        {item.state === 'error' && <div className="render-overlay error-overlay"><strong>Try a clearer photo</strong><p>{item.error?.message}</p></div>}
        <span className="image-disclosure">{job?.mode==='recorded' && item.state==='success'?'RECORDED YOUCAM OUTPUT · NO NEW API CALL':job?.mode === 'live' && item.state === 'success' ? 'YOUCAM API OUTPUT · APPEARANCE ONLY' : 'LOCAL ILLUSTRATION · NOT A YOUCAM RENDER'}</span>
      </div>
      <div className="preview-caption"><h3>{item.label}</h3><span>{item.state === 'success' ? (job.mode==='recorded'?'Real API output on an illustrated wrist':job.mode === 'fixture' ? 'Illustrated on a sample wrist' : 'Preview on your selected wrist') : 'Your next everyday, considered.'}</span></div>
    </article>)}</div>
    {job?.error && <div className="error-banner" role="alert"><div><strong>{job.error.code === 'SUBMISSION_UNCERTAIN' ? 'Submission needs a manual check' : 'Your comparison is preserved'}</strong><p>{job.error.message}</p></div>{(job.canResume ?? job.state === 'paused') && <button className="secondary" onClick={onResume} disabled={busy || (job.retryAt || 0) > Date.now()}>{job.state === 'uncertain' ? 'Check acknowledged task' : 'Check same task'} <Icon name="arrow" size={16} /></button>}</div>}
    <div className="comparison-foot"><p><Icon name="compare" size={17} />Compare the look, not the fit. No size or comfort guarantee.</p><span>{job?.mode==='recorded'?'Recorded 25 October 2026 · no new call':job ? 'Session expires after 30 minutes' : 'Same wrist. Two perspectives.'}</span></div>
    {complete && <div className="decision-note"><label htmlFor="notes">What would make it yours?</label><input id="notes" value={notes} maxLength={240} placeholder="A note for your shortlist — e.g. the olive strap feels more like me." onChange={e => setNotes(e.target.value)} /><span>Text notes stay in this browser tab. Photos are never included in your shortlist export.</span></div>}
  </section>;
}

function App() {
  const [config,setConfig] = useState(null), [mode,setMode] = useState(STATIC_REVIEW?'recorded':'fixture');
  const [selected,setSelected] = useState(['field','dress']), [source,setSource] = useState(null), [products,setProducts] = useState([null,null]);
  const [job,setJob] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [dialog,setDialog] = useState(false), [scenario,setScenario] = useState('success'), [favorite,setFavorite] = useState(null);
  const [notes,setNotes] = useState(() => sessionStorage.getItem('fitcheck-notes') || '');
  const [savedView,setSavedView] = useState(false);
  const request = useRef(null), assets = useRef([]), generation = useRef(0);
  const active = busy || (job && !terminal.includes(job.state));
  useEffect(() => {
    let alive = true;
    if(STATIC_REVIEW){setConfig({liveEnabled:false});return () => {alive=false;};}
    Promise.all([api('/api/config'), api('/api/jobs')]).then(([c,j]) => {
      if (!alive) return; setConfig(c); const last = j.jobs.at(-1);
      if (last) {
        setJob(last); setMode(last.mode); setNotice('Recovered your most recent comparison in this browser session.');
        if (last.mode === 'fixture' && last.items.every(item => WATCHES.some(watch => watch.id === item.productId))) setSelected(last.items.map(item => item.productId));
        try { const saved = JSON.parse(sessionStorage.getItem('fitcheck-favorite')); if(saved?.jobId === last.id) setFavorite(saved.index); } catch { /* Ignore stale local preferences. */ }
      }
    }).catch(e => alive && setError(e.message));
    return () => { alive=false; assets.current.forEach(url => URL.revokeObjectURL(url)); };
  }, []);
  useEffect(() => { sessionStorage.setItem('fitcheck-notes', notes); }, [notes]);
  useEffect(() => { if (job) sessionStorage.setItem('fitcheck-favorite', JSON.stringify({ jobId: job.id, index: favorite })); }, [job?.id, favorite]);
  useEffect(() => {
    if (!job || terminal.includes(job.state)) return;
    let alive = true; const current = generation.current;
    const timer = setTimeout(() => {
      api(`/api/jobs/${job.id}`).then(next => { if (alive && current === generation.current) setJob(next); }).catch(e => { if (alive) { setError(e.message); setJob(j => ({ ...j, state: 'paused', error: { code: e.code, message: e.message } })); } });
    }, 2800);
    return () => { alive=false; clearTimeout(timer); };
  }, [job]);
  // Refresh the retry button when a provider backoff interval expires.
  useEffect(() => { if (!job?.retryAt || job.retryAt < Date.now()) return; const t = setTimeout(() => setJob(j => j ? { ...j } : j), job.retryAt-Date.now()+100); return () => clearTimeout(t); }, [job?.retryAt]);
  const replaceImage = (image, index) => {
    setError(''); request.current=null;
    assets.current.push(image.url);
    if (index === undefined) { if(source) URL.revokeObjectURL(source.url); setSource(image); }
    else setProducts(items => items.map((old,i) => { if(i !== index) return old; if(old) URL.revokeObjectURL(old.url); return image; }));
  };
  const resetInputs = () => { assets.current.forEach(url => URL.revokeObjectURL(url)); assets.current=[]; setSource(null); setProducts([null,null]); };
  const focusMode = () => { setSavedView(false); requestAnimationFrame(() => document.getElementById('preview-mode')?.focus()); };
  const changeMode = value => { if(active) return; setMode(value); setJob(null); setError(''); setNotice(''); setSavedView(false); setFavorite(null); request.current=null; resetInputs(); };
  const choose = id => {
    if(active) return; setJob(null); setFavorite(null); setSavedView(false); request.current=null; setError('');
    setSelected(items => items.includes(id) ? (items.length > 1 ? items.filter(x=>x !== id) : items) : (items.length === 2 ? [items[1],id] : [...items,id]));
  };
  const submit = async consent => {
    setDialog(false); setBusy(true); setError(''); setNotice(''); setFavorite(null); setSavedView(false);
    try {
      if(mode==='recorded'){setJob(recordedComparison(assetBase));setNotice('Previously generated YouCam outputs on original project illustrations. No new API call or upload.');return;}
      if (!request.current) {
        const body = mode === 'fixture' ? { mode, productIds: selected, scenario } : {
          mode, source: await imagePayload(source.file), products: await Promise.all(products.map((p,i) => imagePayload(p.file).then(image => ({ label: `Your watch ${String.fromCharCode(65+i)}`, image })))), consent,
        };
        request.current = { key: crypto.randomUUID(), body };
      }
      const current = generation.current;
      const next = await api('/api/jobs', { method: 'POST', headers: { 'Idempotency-Key': request.current.key }, body: JSON.stringify(request.current.body) });
      if (current === generation.current) {
        setJob(next); request.current=null;
        if (window.innerWidth < 760) requestAnimationFrame(() => document.getElementById('comparison')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
      }
    } catch(e) { setError(e.message + (e.status ? '' : ' Use Recover submission to repeat the same request ID.')); }
    finally { setBusy(false); }
  };
  const resume = async () => { setBusy(true); setError(''); try { setJob(await api(`/api/jobs/${job.id}/resume`, { method:'POST' })); } catch(e) { setError(e.message); } finally {setBusy(false);} };
  const clear = async () => {
    generation.current++; setBusy(true);
    try { if(!STATIC_REVIEW)await api('/api/jobs', { method:'DELETE' }); setJob(null); setFavorite(null); setNotes(''); setSavedView(false); request.current=null; resetInputs(); setError(''); setNotice(mode==='recorded'?'Your note and selection were cleared. The recorded example images remain public.':'Local session cleared. Provider-side deletion is not confirmed; see YouCam’s privacy policy.'); }
    catch(e) {setError(e.message);} finally {setBusy(false);}
  };
  const download = () => {
    const data = { product: 'FitCheck Studio', evidence: job?.mode === 'recorded' ? 'RECORDED_YOUCAM_OUTPUT_NO_NEW_API_CALL' : job?.mode === 'fixture' ? 'LOCAL_WORKFLOW_FIXTURE_NOT_YOUCAM' : 'YOUCAM_OUTPUT_NOT_SIZE_MEASUREMENT', comparisonId: job?.id, favorite: favorite === null ? null : job?.items[favorite]?.label, note: notes, items: job?.items.map(i => ({ label: i.label, state: i.state })), exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href=url; link.download='fitcheck-shortlist.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    setNotice('Shortlist exported with evidence labels. No photos or provider result URLs are included.');
  };
  const canStart = mode === 'recorded' ? true : mode === 'fixture' ? selected.length === 2 : config?.liveEnabled && source && products.every(Boolean);
  return <>
    <header className="header"><a href="#" className="brand" onClick={e=>{e.preventDefault();setSavedView(false);}}><span className="brand-icon">f<span>c</span></span><span>fitcheck<span className="brand-light"> studio</span></span></a><nav aria-label="Main navigation"><button className={!savedView ? 'nav-active' : ''} onClick={()=>setSavedView(false)}>The fitting room</button><button className={savedView ? 'nav-active' : ''} onClick={()=>setSavedView(true)}>Your shortlist <span className="count">{favorite === null ? '0' : '1'}</span></button></nav><span className="provider-indicator"><span />{mode==='recorded' ? 'Recorded YouCam · no new call' : config?.liveEnabled ? (job?.mode === 'live' && job?.items.some(item => item.state === 'success') ? 'YouCam · results received' : 'YouCam · confirm before upload') : 'YouCam live mode disabled'}</span></header>
    <main>
      <div className="intro"><div><h1>{savedView ? 'Keep what feels like you.' : <>Find your <em>everyday.</em></>}</h1><p>{savedView ? 'A small, considered shortlist. Yours to take away.' : 'Two watches. Your point of view. A little less guessing before you buy.'}</p></div><div className="intro-aside"><Icon name="shield" size={24}/><span>Your photo stays yours.<small>You decide when it leaves this device.</small></span></div></div>
      <div className="mode-banner"><span><strong>{mode==='recorded'?'Verified example':mode === 'fixture' ? 'Local demo' : 'Live preview'}</strong>{mode==='recorded'?'Real YouCam outputs generated on original illustrations. Recorded 25 October 2026. No new call, upload or units used.':mode === 'fixture' ? 'Original illustrations. No real photos, no YouCam calls, no API units used.' : 'Your photos stay local until you confirm transfer. Two API renders may use units.'}</span><button className="text-button" onClick={focusMode}>Change mode <Icon name="arrow" size={14}/></button></div>
      {error && <div className="page-message error-message" role="alert">{error}{request.current && <button className="text-button" disabled={busy} onClick={()=>submit()}>Recover submission</button>}</div>}
      {notice && <div className="page-message" role="status">{notice}</div>}
      {savedView ? <section className="shortlist"><div className="shortlist-heading"><div><span className="section-index">The pieces you come back to</span><h2>Your shortlist</h2></div><button className="secondary" onClick={()=>setSavedView(false)}>Back to comparison <Icon name="arrow" /></button></div>{favorite !== null && job?.items[favorite]?.state === 'success' ? <div className="shortlist-content"><img src={job.items[favorite].result} alt="Saved watch preview" /><div><span className="section-index">{job.mode==='recorded'?'Recorded YouCam appearance preview':job.mode === 'fixture' ? 'Local workflow fixture' : 'YouCam appearance preview'}</span><h2>{job.items[favorite].label}</h2><p>{notes || 'The one worth a second look.'}</p><p className="muted">Appearance only. Confirm dimensions, materials and fit with the retailer.</p><button className="primary" onClick={download}>Export shortlist <Icon name="file" /></button><button className="text-button remove" onClick={()=>setFavorite(null)}>Remove from shortlist</button></div></div> : <div className="empty-shortlist"><Icon name="heart" size={36}/><h2>Room for something good.</h2><p>Run a comparison, then save the look you keep coming back to.</p><button className="primary" onClick={()=>setSavedView(false)}>Visit the fitting room <Icon name="arrow" /></button></div>}</section> : <div className="workspace">
        <aside className="setup"><div className="setup-heading"><span className="section-index">01 / Make it personal</span><h2>Your fitting room</h2></div>
          <label className="mode-select" htmlFor="preview-mode">Preview mode<select aria-label="Preview mode" id="preview-mode" value={mode} onChange={e=>changeMode(e.target.value)} disabled={active}><option value="recorded">Verified YouCam · recorded example</option><option value="fixture" disabled={STATIC_REVIEW}>Local demo · no upload</option><option value="live" disabled={STATIC_REVIEW}>YouCam · your photos</option></select></label>
          {mode==='recorded'?<><div className="sample-wrist"><img src={assetBase+'verified-samples/wrist.png'} alt="Original illustrated input, not a real person"/><div><strong>Original illustrated wrist</strong><p>Previously sent to YouCam. This example replays its real outputs.</p><span className="small-tag">SYNTHETIC INPUT / REAL API OUTPUT</span></div></div><div className="watch-list">{['field','diver'].map(id=><div className="watch-option" key={id}><img src={assetBase+'verified-samples/'+id+'.png'} alt={'Original '+id+' illustration'}/><span><strong>{id==='field'?'The Field':'The Diver'}</strong><small>Project-authored product input</small></span></div>)}</div><p className="file-help">These results verify the integration on illustrated inputs. They do not establish photo realism, wrist sizing or fit accuracy. Live testing with your own photos requires the server build.</p></>:mode === 'fixture' ? <><div className="sample-wrist"><img src={assetBase+'fixtures/wrist.svg'} alt="Original illustrated wrist fixture"/><div><strong>A sample wrist</strong><p>An illustration for exploring the flow. Not a real person or AI render.</p><span className="small-tag">WORKFLOW FIXTURE</span></div></div><div className="section-label"><h3>Pick two perspectives</h3><span>{selected.length} / 2</span></div><div className="watch-list">{WATCHES.map(w => <button key={w.id} className={`watch-option ${selected.includes(w.id) ? 'selected' : ''}`} disabled={active} onClick={()=>choose(w.id)} aria-pressed={selected.includes(w.id)}><img src={`${assetBase}fixtures/${w.id}.svg`} alt=""/><span><strong>{w.name}</strong><small>{w.detail}</small></span><span className="selection-dot">{selected.includes(w.id) && <Icon name="check" size={13}/>}</span></button>)}</div></> : <><p className="setup-copy">Choose one wrist photo and two upright, front-facing watch images you are allowed to use.</p><FilePicker label="Your wrist photo" hint="Back of wrist · all five fingers visible" value={source} onChange={image=>replaceImage(image)} disabled={active}/>{products.map((p,i)=><FilePicker key={i} label={`Watch ${String.fromCharCode(65+i)} photo`} hint="Upright · face and front strap visible" value={p} onChange={image=>replaceImage(image,i)} disabled={active}/>)}<p className="file-help">JPEG or PNG · under 8 MB · 640–4096 px per side. Metadata is stripped before provider transfer.</p>{!config?.liveEnabled && <p className="live-blocker">Live previews are disabled. Add an approved server API key and enable unit usage before sending any photo.</p>}</>}
          <div className="start-area"><button className="primary start" disabled={!canStart || active || Boolean(request.current)} onClick={()=>mode !== 'live' ? submit() : setDialog(true)}>{busy ? 'Preparing…' : mode==='recorded'?'View verified results':mode === 'fixture' ? 'Compare sample looks' : 'Review photo transfer'}<Icon name="arrow" /></button><p>{mode==='recorded'?'Previously generated results. Zero new requests.':mode === 'fixture' ? 'A complete local walkthrough. Zero uploads.' : 'Nothing is uploaded by choosing a file.'}</p></div>
          <details className="photo-guide"><summary>A better photo, a clearer preview <span>+</span></summary><p>Show the back of your wrist and all five fingers. Use even light and avoid sleeves covering your wrist. Product images must be upright and front-facing, with the face unobstructed and the back clasp out of view.</p><a href="https://docs.perfectcorp.com/reference/ai_watch/section/overview" target="_blank" rel="noreferrer">YouCam photo requirements ↗</a></details>
          {mode === 'fixture' && <details className="demo-tools"><summary>Explore recovery states <span>+</span></summary><label htmlFor="scenario">Next demo comparison<select id="scenario" value={scenario} disabled={active} onChange={e=>{setScenario(e.target.value);request.current=null;}}><option value="success">Successful comparison</option><option value="rate-limit">Rate limit · wait and recover</option><option value="detection">Photo detection failure</option><option value="timeout">Slow task · resume same ID</option></select></label><p>All errors in this menu are injected locally.</p></details>}
        </aside>
        <Results job={job} mode={mode} selected={selected} favorite={favorite} setFavorite={setFavorite} onResume={resume} busy={busy} notes={notes} setNotes={setNotes}/>
      </div>}
      <div className="privacy-strip"><div><Icon name="shield" size={18}/><p><strong>Considered choices, considered privacy.</strong> {mode==='recorded'?'Recorded images are public examples. Notes stay in this tab. Clear removes your note and selection.':'Local task records expire after 30 minutes. Clearing removes local records and previews; YouCam may retain transferred images under its policy.'}</p></div><button className="text-button" disabled={busy} onClick={clear}><Icon name="clear" size={16}/>Clear local session</button></div>
    </main><footer><span>FitCheck Studio</span><p>Choose the look. Check the fit with the retailer.</p><a href="https://docs.perfectcorp.com/reference/ai_watch" target="_blank" rel="noreferrer">YouCam API documentation ↗</a></footer>
    {dialog && <ConsentDialog source={source} products={products} onClose={()=>setDialog(false)} onConfirm={submit}/>}
  </>;
}
createRoot(document.getElementById('root')).render(<App/>);
