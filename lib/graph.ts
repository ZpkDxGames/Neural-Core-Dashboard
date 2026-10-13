import { CATEGORIES, type Conversation, type GraphEdge, type GraphNode, type KnowledgeGraph } from './types.ts';
const classifiers: Record<string,string[]> = {
  'Development': ['repository','github','typescript','java','python','coding','software','plugin','bug','fix','source','api','function','code','build','commit','debug'],
  'AI & Automation': ['ai','model','prompt','agent','claude','gemini','gpt','automation','neural','inference','llm','embedding'],
  'UI / UX': ['ui','ux','dashboard','design','responsive','animation','colors','interface','graph','renderer','layout'],
  'Learning': ['study','course','university','learn','homework','math','education','lecture','exam'],
  'Gaming': ['minecraft','server','paper','voxy','vulkan','survival','farm','mod','game','sodium'],
  'Infrastructure': ['vps','ubuntu','docker','postgres','cloudflare','vercel','deploy','host','linux','backup','ssh'],
  'Planning': ['plan','roadmap','goal','organize','schedule','milestone','strategy','project','priority'],
};
export function classify(c: Conversation): string {
  const text = `${c.title} ${c.messages.slice(0,8).map(m=>m.text.slice(0,600)).join(' ')}`.toLowerCase();
  const title=c.title.toLowerCase();
  const contains=(haystack:string,word:string)=>new RegExp(`(?:^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`,'i').test(haystack);
  let best: string = 'General'; let max = 0;
  for (const [name,words] of Object.entries(classifiers)) {
    const score = words.reduce((sum,w)=>sum+(contains(text,w)?(contains(title,w)?3:1):0),0);
    if (score>max) {max=score;best=name;}
  }
  return best;
}
export function buildGraph(conversations: Conversation[], maxNodes=1200): KnowledgeGraph {
  const nodes: GraphNode[]=[{id:'core',label:'Neural Core',type:'core',category:'Core',strength:1}];
  const edges: GraphEdge[]=[];
  for(const category of CATEGORIES) {
    nodes.push({id:`category:${category}`,label:category,type:'category',category,strength:0.95});
    edges.push({source:'core',target:`category:${category}`,type:'contains'});
  }
  for(const p of ['chatgpt','claude','gemini','generic'] as const) {
    nodes.push({id:`provider:${p}`,label:p[0].toUpperCase()+p.slice(1),type:'provider',category:'Sources',provider:p,strength:0.85});
    edges.push({source:'core',target:`provider:${p}`,type:'source'});
  }
  const selected=[...conversations].sort((a,b)=>Date.parse(b.updatedAt||b.createdAt||'1970')-Date.parse(a.updatedAt||a.createdAt||'1970')).slice(0,Math.max(0,maxNodes-13));
  const seen=new Set<string>();
  for(const c of selected) {
    if(seen.has(c.id))continue;
    seen.add(c.id);
    const category=classify(c);
    nodes.push({id:c.id,label:c.title,type:'conversation',category,provider:c.provider,description:`${c.messages.length} messages · ${c.provider}`,strength:0.35+Math.min(0.45,c.messages.length/125)});
    edges.push({source:c.id,target:`category:${category}`,type:'classified'});
    edges.push({source:c.id,target:`provider:${c.provider}`,type:'origin'});
  }
  return {nodes,edges};
}
// Fixture is explicitly synthetic, with no claims about the user or imported sources.
export function demoGraph(): KnowledgeGraph {
  const nodes: GraphNode[]=[{id:'core',label:'Neural Core',type:'core',category:'Core',strength:1}];
  const edges: GraphEdge[]=[];
  const titles=['Architecture','Design exploration','Release engineering','Performance profiling','Project planning','Knowledge discovery','Memory consolidation','Quality analysis','Integration research','Documentation'];
  for(let i=0;i<CATEGORIES.length;i++) {
    const category=CATEGORIES[i];
    nodes.push({id:`category:${category}`,label:category,type:'category',category,strength:1});
    edges.push({source:'core',target:`category:${category}`,type:'contains'});
    const count=[140,112,106,78,99,88,65,72][i];
    for(let j=0;j<count;j++) {
      const id=`demo:${i}:${j}`;
      nodes.push({id,label:`${titles[(i+j)%titles.length]} ${String(j+1).padStart(3,'0')}`,type:'conversation',category,strength:0.22+(j%9)/20,description:'Demonstration node — not imported data'});
      edges.push({source:id,target:`category:${category}`,type:'belongs-to'});
      if(j>0 && j%3===0) edges.push({source:id,target:`demo:${i}:${j-1}`,type:'related'});
    }
  }
  return {nodes,edges};
}
