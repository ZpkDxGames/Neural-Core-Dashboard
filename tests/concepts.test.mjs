import test from 'node:test';
import assert from 'node:assert/strict';
import { extractConceptMentions } from '../lib/concepts.ts';
import { buildGraph } from '../lib/graph.ts';

function conv(id, provider, title, text) {
  return { id: provider + ':' + id, provider, title, createdAt: null, updatedAt: null, tags: [],
    messages: [{ id: 'm1', role: 'user', text, at: null }] };
}
test('links two providers through one literal shared topic, preserving source evidence', () => {
  const a = conv('a', 'chatgpt', 'Data design', 'Use PostgreSQL for persistent storage.');
  const b = conv('b', 'claude', 'Schema discussion', 'Postgres indexes need maintenance.');
  const graph = buildGraph([a,b]);
  const concept = graph.nodes.find(n => n.id === 'concept:postgresql');
  assert.ok(concept);
  assert.equal(concept.type,'concept');
  assert.deepEqual(new Set(concept.evidence.map(e => e.provider)),new Set(['chatgpt','claude']));
  assert.deepEqual(new Set(concept.evidence.map(e => e.conversationId)), new Set([a.id,b.id]));
  assert.ok(concept.evidence.every(e => e.messageId === 'm1'));
  assert.ok(concept.evidence.every(e => /postgres/i.test(e.excerpt)));
  assert.ok(graph.edges.some(e => e.source === a.id && e.target === concept.id && e.type === 'mentions'));
  assert.ok(graph.edges.some(e => e.source === b.id && e.target === concept.id && e.type === 'mentions'));
});
test('does not infer personal interests without literal evidence or match token substrings',()=>{
  const c=conv('x','gemini','Email report','JavaScript is useful for websites, no mention of JVM.');
  const labels=extractConceptMentions(c).map(x=>x.label);
  assert.ok(labels.includes('JavaScript'));
  assert.ok(!labels.includes('Java'));
  assert.ok(!labels.includes('Neural networks'));
  assert.ok(!labels.includes('ChatGPT'));
});
test('title-only matches cite the title rather than fabricating a message quote',()=>{
  const c=conv('title','generic','Vercel deployment','Everything works.');
  const found=extractConceptMentions(c).find(x=>x.id==='vercel');
  assert.ok(found);
  assert.equal(found.evidence.messageId,null);
  assert.equal(found.evidence.excerpt,'Vercel deployment');
  assert.equal(found.evidence.title,'Vercel deployment');
});
test('graph node budget and link references remain bounded and valid',()=>{
  const items=Array.from({length:300},(_,i)=>conv(String(i),i%2?'chatgpt':'claude','PostgreSQL and React','Postgres with React and Vercel'));
  const graph=buildGraph(items,55);
  assert.ok(graph.nodes.length<=55);
  assert.equal(new Set(graph.nodes.map(x=>x.id)).size,graph.nodes.length);
  const ids=new Set(graph.nodes.map(x=>x.id));
  for(const e of graph.edges){assert.ok(ids.has(e.source));assert.ok(ids.has(e.target));}
});
test('topic extraction is deterministic across repeated runs',()=>{
  const item=conv('stable','chatgpt','Next.js dashboard','Use React, TypeScript, and Vercel.');
  assert.deepEqual(extractConceptMentions(item),extractConceptMentions(item));
  assert.deepEqual(buildGraph([item]),buildGraph([item]));
});
