import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArchive} from '../lib/archive.ts';
import {buildGraph,classify,demoGraph} from '../lib/graph.ts';

test('ChatGPT chain chooses current branch, never duplicate alternative branches',()=>{
 const archive=[{id:'a',title:'Project Alpha',create_time:1760000000,current_node:'n3',mapping:{
 n1:{parent:null,message:{id:'m1',author:{role:'user'},content:{parts:['Help with TypeScript']},create_time:1760000000}},
 n2:{parent:'n1',message:{id:'m2',author:{role:'assistant'},content:{parts:['Certainly']}}},
 n3:{parent:'n2',message:{id:'m3',author:{role:'user'},content:{parts:['Fix my code']}}},
 n4:{parent:'n1',message:{id:'m4',author:{role:'assistant'},content:{parts:['Old branch']}}}
 }}];
 const r=parseArchive(archive);
 assert.equal(r.provider,'chatgpt');assert.deepEqual(r.conversations[0].messages.map(m=>m.text),['Help with TypeScript','Certainly','Fix my code']);
 assert.equal(classify(r.conversations[0]),'Development');
 assert.equal(buildGraph(r.conversations).nodes.some(n=>n.id==='chatgpt:a'),true);
});
test('Claude chats with content blocks are supported',()=>{
 const r=parseArchive([{uuid:'xyz',name:'Project',chat_messages:[{uuid:'m',sender:'human',content:[{type:'text',text:'Design a dashboard'}]}]}]);
 assert.equal(r.provider,'claude');assert.equal(r.conversations[0].messages[0].text,'Design a dashboard');
});
test('generic normalized Gemini conversations accepted without making up responses',()=>{
 const r=parseArchive({conversations:[{id:'abc',provider:'gemini',title:'Ideas',messages:[{role:'user',text:'Explore a neural sphere'}]}]});
 assert.equal(r.conversations[0].provider,'gemini');assert.equal(r.conversations[0].messages.length,1);
});
test('unsupported exports and empty messages are rejected',()=>{
 assert.throws(()=>parseArchive({random:1}),/Unsupported/);
 assert.throws(()=>parseArchive([{id:'bad',mapping:{}}]),/No readable/);
});
test('synthetic graph has valid internal node references',()=>{
 const g=demoGraph();const ids=new Set(g.nodes.map(n=>n.id));
 assert.equal(g.nodes.length>500,true);
 for(const edge of g.edges){assert.ok(ids.has(edge.source));assert.ok(ids.has(edge.target));}
});

test('AI keyword requires a word boundary rather than matching email',()=>{
  const c={id:'generic:email',provider:'generic',title:'Email notes',createdAt:null,updatedAt:null,tags:[],messages:[{id:'m',role:'user',text:'Email a friendly thank-you',at:null}]};
  assert.notEqual(classify(c),'AI & Automation');
});


test('normalized browser export reimport retains original provider-scoped IDs',()=>{
 const original={id:'gemini:stable-record-1',provider:'gemini',title:'Synthetic',createdAt:null,updatedAt:null,messages:[{id:'message-1',role:'user',text:'Synthetic only',at:null}],tags:[]};
 const parsed=parseArchive({format:'neural-core-v1',conversations:[original]});
 assert.equal(parsed.conversations[0].id,original.id);
 const parsedAgain=parseArchive({conversations:parsed.conversations});
 assert.equal(parsedAgain.conversations[0].id,original.id);
});
