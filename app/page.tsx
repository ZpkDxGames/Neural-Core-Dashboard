'use client';
import dynamic from 'next/dynamic';
import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, BrainCircuit, ChevronDown, ChevronRight,
  CircleHelp, Database, FileJson, FileUp, Filter, GitBranch, HardDrive, LayoutDashboard,
  LockKeyhole, Menu, Network, Pause, Play, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Trash2, X
} from 'lucide-react';
import { buildGraph, classify, demoGraph } from '../lib/graph';
import { parseArchive } from '../lib/archive';
import { clearLocalConversations, readConversations, saveConversations } from '../lib/store';
import { CATEGORIES, type Conversation, type GraphNode, type Provider } from '../lib/types';
const NeuralSphere=dynamic(()=>import('../components/NeuralSphere'),{ssr:false,loading:()=> <div className="loading-sphere">Initializing neural canvas…</div>});
type View='overview'|'network'|'memories'|'insights'|'sources'|'settings';
const nav=[
  {id:'overview',label:'Overview',icon:LayoutDashboard},
  {id:'network',label:'Neural Network',icon:Network},
  {id:'memories',label:'Memories',icon:Database},
  {id:'insights',label:'Insights',icon:Activity},
  {id:'sources',label:'Sources',icon:GitBranch},
  {id:'settings',label:'Settings',icon:Settings2},
] as const;
const CAT_COLORS=['#91acf7','#c2a5f4','#68ddd1','#f3c67f','#83c9a7','#9cb6cc','#ef9cb6','#b9bdcc'];
const total=(x:number)=>x.toLocaleString('en-US');
export default function Page(){
  const [view,setView]=useState<View>('overview');
  const [conversations,setConversations]=useState<Conversation[]>([]);
  const [importedCount,setImportedCount]=useState(0);
  const [initialized,setInitialized]=useState(false);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('All categories');
  const [source,setSource]=useState('All sources');
  const [playing,setPlaying]=useState(true);
  const [selected,setSelected]=useState<GraphNode|null>(null);
  const [menuOpen,setMenuOpen]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null);
  const local=importedCount>0;
  const reload=useCallback(async()=>{
    try{const r=await readConversations();setConversations(r.items);setImportedCount(r.total);}
    catch{setStatus('Browser storage unavailable. Enable IndexedDB or use a normal browsing window.');}
    finally{setInitialized(true);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  const filtered=useMemo(()=>conversations.filter(c=>
    (source==='All sources'||c.provider===source.toLowerCase())&&
    (category==='All categories'||classify(c)===category)&&
    (!query||`${c.title} ${c.messages.slice(0,4).map(m=>m.text.slice(0,180)).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  ),[conversations,query,source,category]);
  const graph=useMemo(()=>local?buildGraph(filtered):demoGraph(),[filtered,local]);
  const displayedGraph=useMemo(()=>{
    if(local)return graph;
    const nodes=graph.nodes.filter(n=>
      (category==='All categories'||n.type==='core'||n.category===category)&&
      (!query||n.type==='core'||n.type==='category'||n.label.toLowerCase().includes(query.toLowerCase()))
    );
    const ids=new Set(nodes.map(n=>n.id));
    return {nodes,edges:graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target))};
  },[graph,local,category,query]);
  const distribution=useMemo(()=>CATEGORIES.map((name,i)=>({name,value:local?filtered.filter(c=>classify(c)===name).length:graph.nodes.filter(n=>n.category===name&&n.type==='conversation').length,color:CAT_COLORS[i]})),[filtered,graph,local]);
  const srcCount=(p:Provider)=>conversations.filter(c=>c.provider===p).length;
  const title=nav.find(n=>n.id===view)?.label||'Overview';
  async function handleImport(file: File){
    if(!file)return;
    if(file.size>32*1024*1024){setStatus('The first-release importer supports JSON files up to 32 MB. Split larger exports.');return;}
    setBusy(true);setStatus('');
    try{
      const archive=parseArchive(JSON.parse(await file.text()));
      await saveConversations(archive.conversations);
      await reload();
      setCategory('All categories');setSource('All sources');setQuery('');setSelected(null);
      setStatus(`Imported ${total(archive.conversations.length)} ${archive.provider} conversations locally${archive.ignored?`; skipped ${archive.ignored} unreadable records`:''}. No conversation data was sent to a server.`);
      setView('network');
    }catch(e){setStatus(e instanceof Error?e.message:'Import failed. Check the archive JSON.');}
    finally{setBusy(false);if(fileInput.current)fileInput.current.value='';}
  }
  async function removeLocal(){
    if(!window.confirm('Delete ALL Neural Core conversations stored in this browser? This cannot be undone.'))return;
    try{await clearLocalConversations();await reload();setSelected(null);setStatus('Local conversation storage cleared.');setView('overview');}
    catch{setStatus('Unable to clear browser storage.');}
  }
  async function exportLocal(){
    const data=await readConversations(50000);
    const blob=new Blob([JSON.stringify({format:'neural-core-v1',exportedAt:new Date().toISOString(),conversations:data.items},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='neural-core-local-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function copyContext(){
    if(!selected || !local)return;
    const c=conversations.find(c=>c.id===selected.id);
    let context='';
    if(c){
      context='Context from my '+c.provider+' conversation "'+c.title+'":\n'+
        c.messages.slice(0,6).map(m=>m.role+': '+m.text.slice(0,1500)).join('\n\n');
    } else if(selected.type==='concept' && selected.evidence?.length){
      context='These are explicit mentions of "'+selected.label+'" in my AI conversation archives, not verified inferences:\n\n'+
        selected.evidence.slice(0,6).map(e=>'['+e.provider+' | '+e.title+'] '+e.excerpt).join('\n\n');
    } else {
      setStatus('Select an imported conversation or evidence-backed topic to copy context.');
      return;
    }
    void navigator.clipboard.writeText(context).then(()=>setStatus('Evidence-backed context copied. Paste it into ChatGPT, Claude, or Gemini.')).catch(()=>setStatus('Clipboard permission denied.'));
  }
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-mark"><BrainCircuit size={20} strokeWidth={1.8}/></div><div><strong>neural<span>core</span></strong><small>PERSONAL KNOWLEDGE OS</small></div></div>
      <div className="sidebar-tag"><span className="dot green"/> LOCAL WORKSPACE <ChevronDown size={13}/></div>
      <div className="nav-section-label">WORKSPACE</div>
      <nav className="nav-items">{nav.slice(0,4).map(n=><button key={n.id} className={`nav-item ${view===n.id?'active':''}`} onClick={()=>{setView(n.id);setMenuOpen(false)}}><n.icon size={17} strokeWidth={1.8}/><span>{n.label}</span>{n.id==='memories'&&local?<em>{total(importedCount)}</em>:null}</button>)}</nav>
      <div className="nav-section-label lower">MANAGEMENT</div>
      <nav className="nav-items">{nav.slice(4).map(n=><button key={n.id} className={`nav-item ${view===n.id?'active':''}`} onClick={()=>{setView(n.id);setMenuOpen(false)}}><n.icon size={17} strokeWidth={1.8}/><span>{n.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-info"><div className="mini-icon"><LockKeyhole size={15}/></div><div><strong>Local-first mode</strong><small>Browser storage only</small></div><ShieldCheck size={15} className="dim"/></div><div className="sidebar-footer"><span>NEURAL CORE</span><span>v0.1.0 · Alpha.2</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="top-left"><button className="mobile-menu icon-button" onClick={()=>setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Menu size={18}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{title}</strong></div><div className="top-actions"><span className="private-indicator"><span className="dot green"/> Local-only · no sync</span><button className="avatar" title="Local workspace">NC</button></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="dashline"/> INTELLIGENCE LAYER / {view.toUpperCase()}</div><h1>{view==='overview'?'Your neural workspace':title}</h1><p>{view==='overview'?'A connected view of everything your AI conversations know.':view==='network'?'Explore connections across your imported knowledge.':view==='memories'?'Browse and retrieve your saved conversation context.':view==='insights'?'Understand how topics are distributed across your knowledge.':view==='sources'?'Bring conversation histories together without leaving your browser.':'Control your local-first storage and privacy preferences.'}</p></div><button className="primary-button" onClick={()=>fileInput.current?.click()} disabled={busy}><FileUp size={16}/>{busy?'Importing…':'Import conversations'}</button></div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void handleImport(f);}}/>
        {status&&<div className="notice" role="status"><span>{status}</span><button onClick={()=>setStatus('')} aria-label="Dismiss"><X size={15}/></button></div>}
        {view==='overview'||view==='network'?<>
          <div className="summary-cards">
            <div className="metric-card"><div className="metric-head"><span>KNOWLEDGE NODES</span><Network size={16}/></div><div className="metric-value">{total(displayedGraph.nodes.length)}<span>nodes</span></div><div className="metric-meta">{local?'Extracted from local archive':'Illustrative neural dataset'}</div></div>
            <div className="metric-card"><div className="metric-head"><span>RELATIONSHIPS</span><GitBranch size={16}/></div><div className="metric-value">{total(displayedGraph.edges.length)}<span>edges</span></div><div className="metric-meta">{local?'Source, category and cited topic links':'Simulated relationships'}</div></div>
            <div className="metric-card"><div className="metric-head"><span>CONVERSATIONS</span><Database size={16}/></div><div className="metric-value">{local?total(importedCount):'0'}<span>saved</span></div><div className="metric-meta">{local?'Stored in this browser':'No personal content imported'}</div></div>
            <div className="metric-card"><div className="metric-head"><span>DATA SOURCES</span><Activity size={16}/></div><div className="metric-value">{local?total(['chatgpt','claude','gemini','generic'].filter(p=>srcCount(p as Provider)>0).length):'0'}<span>imported</span></div><div className="metric-meta">Manual archive import · no sync</div></div>
          </div>
          <section className="visual-grid">
            <div className="sphere-panel">
              <div className="panel-top"><div><div className="section-kicker">NEURAL EXPLORER <span className="tiny-separator">/</span> {local?'LOCAL DATA':'DEMO MODE'}</div><h2>Knowledge constellation</h2></div><div className="sphere-actions"><button className="icon-button" onClick={()=>setPlaying(!playing)} title={playing?'Pause rotation':'Resume rotation'}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><button className="pill-action" onClick={()=>{setQuery('');setCategory('All categories');setSource('All sources');setSelected(null);}}><RotateCcw size={14}/> Clear filters</button></div></div>
              <div className="filterbar"><label className="searchfield"><Search size={16}/><input aria-label="Search knowledge" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search the network…"/></label><label className="filter-select"><Filter size={14}/><select aria-label="Filter category" value={category} onChange={e=>{setCategory(e.target.value);setSelected(null);}}><option>All categories</option>{CATEGORIES.map(x=><option key={x}>{x}</option>)}</select><ChevronDown size={12}/></label><label className="filter-select"><select aria-label="Filter source" disabled={!local} value={source} onChange={e=>{setSource(e.target.value);setSelected(null);}}><option>All sources</option>{['chatgpt','claude','gemini','generic'].map(x=><option key={x} value={x}>{x}</option>)}</select><ChevronDown size={12}/></label></div>
              <div className="sphere-stage"><div className="stage-glow"/><div className="stage-corner top-l"><span className="dot aqua"/> {local?'LOCAL GRAPH RENDER':'SYNTHETIC GRAPH PREVIEW'}</div><div className="stage-axis">DRAG TO ROTATE <span>·</span> SCROLL TO ZOOM <span>·</span> SELECT A NODE</div>{initialized&&<NeuralSphere graph={displayedGraph} playing={playing} onSelect={setSelected}/>}<div className="stage-bottom"><div className="stage-pill"><span className="dot aqua"/> {displayedGraph.nodes.length} nodes rendered</div><span>3D NETWORK · WEBGL</span></div></div>
              <div className="sphere-footer"><div><span className="footer-point"/> Neural Core <span className="sep">/</span> {local?'Imported knowledge':'Synthetic sample'}</div><span>{displayedGraph.edges.length} relationships visualized</span></div>
            </div>
            <div className="right-panels"><div className="details-card"><div className="section-kicker">SELECTED MEMORY</div>{selected?<><div className="detail-icon"><BrainCircuit size={18}/></div><h3>{selected.label}</h3><p>{selected.description||`Knowledge group: ${selected.category}`}</p><div className="detail-row"><span>Category</span><strong>{selected.category}</strong></div><div className="detail-row"><span>Node type</span><strong>{selected.type}</strong></div>{selected.provider&&<div className="detail-row"><span>Source</span><strong>{selected.provider}</strong></div>}<>{selected.evidence?.length ? <div className="evidence-preview"><strong>Source evidence · literal mentions</strong>{selected.evidence.slice(0,3).map((e,i)=><div className="evidence-item" key={e.conversationId+":"+e.messageId+":"+i}><span>{e.provider} · {e.title}</span><p>{e.excerpt}</p></div>)}</div> : null}<button className="light-button" disabled={!local || (selected.type!=="conversation" && !selected.evidence?.length)} onClick={copyContext}>Copy cited context <ArrowRight size={15}/></button></></>:<><div className="detail-placeholder"><div className="detail-icon"><CircleHelp size={20}/></div><h3>Explore the network</h3><p>Select a glowing node to inspect its origin, category and relationships.</p></div></>}</div>
              <div className="category-card"><div className="card-header"><div><div className="section-kicker">ORGANIZATION</div><h3>Knowledge clusters</h3></div><span className="chip">{CATEGORIES.length}</span></div><div className="category-list">{distribution.map(c=><button key={c.name} className="category-row" onClick={()=>{setCategory(c.name);setView('network');}}><span className="color-bullet" style={{background:c.color}}/><span>{c.name}</span><strong>{c.value}</strong></button>)}</div></div></div>
          </section>
          {!local&&<div className="demo-banner"><div className="demo-banner-icon"><Sparkles size={17}/></div><div><strong>You're viewing a synthetic network.</strong><p>These nodes are illustrative—not inferred memories or personality traits. Import an archive to visualize your real conversation structure.</p></div><button onClick={()=>fileInput.current?.click()}>Import your data <ArrowRight size={14}/></button></div>}
        </>:null}
        {view==='memories'&&<div className="workspace-card"><div className="workspace-card-header"><div><div className="section-kicker">RETRIEVAL</div><h2>Conversation library</h2><p>Open a memory and copy context for use in any AI website.</p></div><span className="chip">{total(filtered.length)} records</span></div><div className="memory-filters"><label className="searchfield"><Search size={16}/><input placeholder="Search titles and excerpts" value={query} onChange={e=>setQuery(e.target.value)}/></label><select value={source} onChange={e=>setSource(e.target.value)}><option>All sources</option><option value="chatgpt">chatgpt</option><option value="claude">claude</option><option value="gemini">gemini</option><option value="generic">generic</option></select></div><div className="memory-list">{filtered.slice(0,100).map(c=><button key={c.id} className="memory-row" onClick={()=>{setSelected({id:c.id,label:c.title,type:'conversation',category:classify(c),provider:c.provider,strength:.5,description:`${c.messages.length} messages`});setView('network');}}><div className="memory-icon"><FileJson size={17}/></div><div><strong>{c.title}</strong><span>{c.provider} · {classify(c)} · {c.messages.length} messages</span></div><ChevronRight size={16}/></button>)}{!local?<div className="empty-content">No conversations stored yet. Import an archive to create your personal library.</div>:filtered.length===0?<div className="empty-content">No matching conversations.</div>:null}{filtered.length>100&&<p className="list-limit">Showing first 100 matches. Refine your search to narrow the results.</p>}</div></div>}
        {view==='insights'&&<div className="workspace-card"><div className="workspace-card-header"><div><div className="section-kicker">STRUCTURE / CATEGORY ANALYSIS</div><h2>Topic distribution</h2><p>{local?'Heuristic keyword classification; not a verified personality assessment.':'Demo-only topic frequencies. Import conversations for actual statistics.'}</p></div><span className="chip">{local?'LOCAL OBSERVATIONS':'SAMPLE DATA'}</span></div><div className="insights-chart">{distribution.map(c=><div className="insight-row" key={c.name}><div className="insight-name">{c.name}</div><div className="insight-track"><div style={{width:`${c.value/Math.max(1,...distribution.map(d=>d.value))*100}%`,background:c.color}}/></div><span>{c.value}</span></div>)}</div><div className="insight-explainer"><ShieldCheck size={18}/><p>Categories are estimated from conversation titles and text, not from a behavioral or psychological profile. Every classification remains editable in later phases.</p></div></div>}
        {view==='sources'&&<div className="workspace-card"><div className="workspace-card-header"><div><div className="section-kicker">EXTERNAL AI PLATFORMS</div><h2>Conversation sources</h2><p>Import supported JSON exports into on-device storage.</p></div></div><div className="source-grid">{(['chatgpt','claude','gemini'] as const).map(p=><div className="source-card" key={p}><div className="source-icon">{p.slice(0,1).toUpperCase()}</div><h3>{p==='chatgpt'?'ChatGPT':p==='claude'?'Claude':'Gemini'}</h3><p>{p==='chatgpt'?'Official conversations.json export':p==='claude'?'Official chats.json export':'Normalized JSON only in this release'}</p><strong>{srcCount(p)} conversations</strong><span>{srcCount(p)?'Imported locally':'Not yet imported'}</span></div>)}</div><button className="primary-button source-import" onClick={()=>fileInput.current?.click()}><FileUp size={16}/> Select JSON archive</button><p className="helper-text">Official-site automatic capture is planned for the browser-extension phase. No automatic sync is active.</p></div>}
        {view==='settings'&&<div className="workspace-card settings-card"><div className="workspace-card-header"><div><div className="section-kicker">PRIVACY CONTROLS</div><h2>Local storage</h2><p>Everything imported through the interface is stored using your browser's IndexedDB.</p></div></div><div className="setting-row"><div className="setting-icon"><HardDrive size={18}/></div><div><strong>Local conversation archive</strong><p>{total(importedCount)} saved conversations · no cloud readback</p></div><button className="light-button" onClick={()=>void exportLocal()} disabled={!local}><ArrowDownToLine size={15}/> Export</button></div><div className="setting-row"><div className="setting-icon"><LockKeyhole size={18}/></div><div><strong>Server synchronization</strong><p>Disabled until your VPS authentication and storage are configured.</p></div><span className="chip">OFF</span></div><div className="setting-row"><div className="setting-icon"><Trash2 size={18}/></div><div><strong>Delete local memories</strong><p>Clears conversation data from this browser profile.</p></div><button className="danger-button" onClick={()=>void removeLocal()} disabled={!local}>Delete data</button></div></div>}
        <footer className="bottom-footer"><span>NEURAL CORE / PERSONAL KNOWLEDGE NETWORK</span><span>PRIVACY BY DESIGN <span className="sep">·</span> {local?'LOCAL DATA':'NO PERSONAL DATA YET'}</span></footer>
      </div>
    </main>
  </div>;
}
