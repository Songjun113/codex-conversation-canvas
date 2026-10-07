import {test} from 'node:test';import assert from 'node:assert/strict';
import {arrangeGlobal,mergeGlobalTree} from './global-arranger.mjs';
import {organizeLong,prepareHistory} from './long-organizer.mjs';
const makeMessages=n=>Array.from({length:n},(_,i)=>({id:'m'+i,role:'user',text:'讨论方案 '+i}));
function answer(p,id,each=false){const parts=JSON.parse(p.split('本批资料：')[1].split('\n')[0]);return JSON.stringify({requestId:id,currentNodeId:'b1_0',upserts:(each?parts:[null]).map((part,i)=>({id:'b1_'+i,parent:i?'b1_0':null,lane:i?'branch':'main',title:'任务 '+i,summary:'明确目标',description:'失败后转向',status:'待验证',sources:part?[part.partId]:parts.map(p=>p.partId)}))});}
function brief(p,id){return JSON.stringify({requestId:id,summaries:JSON.parse(p.split('本轮片段：')[1]).map(p=>({source:p.source,goal:p.text,proposal:'',attempt:'',result:'',failure:'',pivot:'',unresolved:''}))});}
const state=manifest=>({nodes:[],done:{},manifest,batchCount:0});
test('all summaries enter one global request beyond the old batch size, with no 16-node restriction',async()=>{
 const {parts,manifest}=await prepareHistory(makeMessages(50));let calls=0;
 const result=await arrangeGlobal({parts,state:state(manifest),save:async()=>{},run:async(p,id)=>{calls++;assert.equal(JSON.parse(p.split('本批资料：')[1]).length,50);return answer(p,id,true);}});
 assert.equal(calls,1);assert.equal(result.nodes.length,50);assert.equal(result.nodes.at(-1).evidence[0].messageId,'m49');
});
test('input compression is checkpointed and all original sources survive into the global tree',async()=>{
 const {parts,manifest}=await prepareHistory(makeMessages(20).map(m=>({...m,text:m.text+'概括'.repeat(800)})));let saved,compressCalls=0,globalCalls=0,failed=false;
 const run=async(p,id)=>{if(p.includes('待压缩概括：')){compressCalls++;if(compressCalls===2&&!failed){failed=true;throw Error('offline');}const input=JSON.parse(p.split('待压缩概括：')[1]);return JSON.stringify({requestId:id,groups:[{text:'合并后的目标、失败与转向',sources:input.map(v=>v.source)}]});}globalCalls++;return answer(p,id);};
 const options={parts,state:state(manifest),maxInputChars:3000,save:async w=>{saved=structuredClone(w);},run};
 await assert.rejects(arrangeGlobal(options),/offline/);const offset=saved.compress.offset;assert.ok(offset>0);
 const result=await arrangeGlobal({...options,work:saved});assert.equal(globalCalls,1);assert.equal(result.nodes[0].sources.length,20);assert.equal(new Set(result.nodes[0].evidence.map(e=>e.messageId)).size,20);
});
test('output overflow switches to full-tree skeleton, never accepts truncated output',async()=>{
 const {parts,manifest}=await prepareHistory(makeMessages(12));let calls=0;
 const result=await arrangeGlobal({parts,state:state(manifest),save:async()=>{},run:async(p,id)=>{if(++calls===1)throw Object.assign(Error('length'),{reduceBatch:true});assert.match(p,/全树骨架/);const v=JSON.parse(answer(p,id));v.upserts.forEach(n=>{delete n.summary;delete n.description;});return JSON.stringify(v);}});
 assert.equal(calls,2);assert.equal(result.needsDetailReview,true);assert.equal(result.nodes[0].sources.length,12);
});
test('missing or invented sources and cyclic trees are rejected',async()=>{
 const {parts}=await prepareHistory(makeMessages(2)),units=parts.map(p=>({text:p.text,sources:[p.partId]}));
 const value={requestId:'x',upserts:[{id:'n',parent:null,lane:'main',title:'n',summary:'s',description:'d',status:'待验证',sources:['p1']}]};
 assert.throws(()=>mergeGlobalTree(JSON.stringify(value),units,parts,'x'),/遗漏/);
 value.upserts[0].sources=['p1','p2','fake'];assert.throws(()=>mergeGlobalTree(JSON.stringify(value),units,parts,'x'),/未知/);
 value.upserts[0].sources=['p1','p2'];value.upserts.push({...value.upserts[0],id:'loop',parent:'loop'});assert.throws(()=>mergeGlobalTree(JSON.stringify(value),units,parts,'x'),/循环/);
});
test('existing summaries are reused, additions globally recompile old and new facts, and failures preserve published tree',async()=>{
 const messages=makeMessages(40);let saved,briefCalls=0,trees=0,fail=false;
 const run=async(p,id)=>{if(p.includes('本轮片段：')){briefCalls++;return brief(p,id);}trees++;if(fail)throw Error('offline');return answer(p,id);};
 const save=async v=>{saved=structuredClone(v);};
 const original=await organizeLong({messages,parallel:true,run,save});assert.equal(trees,1);
 const n=briefCalls;await organizeLong({messages,record:original,parallel:true,run,save});assert.equal(briefCalls,n);assert.equal(trees,1);
 const added=[...messages,{id:'extra',role:'user',text:'更改路线'}];fail=true;
 await assert.rejects(organizeLong({messages:added,record:original,parallel:true,run,save}),/offline/);assert.deepEqual(saved.published,original.published);
 const pending=saved.job.global.pending.requestId;fail=false;
 const result=await organizeLong({messages:added,record:saved,parallel:true,save,run:async(p,id)=>{assert.equal(id,pending);assert.equal(JSON.parse(p.split('本批资料：')[1]).length,41);return answer(p,id);}});
 assert.equal(briefCalls,n+1);assert.equal(result.published.nodes[0].sources.length,41);
});
test('skeleton success automatically runs detail review before publishing',async()=>{
 let treeCalls=0,reviews=0;
 const result=await organizeLong({messages:makeMessages(3),parallel:true,save:async()=>{},run:async(p,id)=>{
  if(p.includes('本轮片段：'))return brief(p,id);
  if(p.includes('本页指定节点：')){reviews++;return JSON.stringify({requestId:id,upserts:JSON.parse(p.split('本页指定节点：')[1]).map(n=>({...n,summary:'补全的摘要',description:'按原文补全的详情'}))});}
  if(++treeCalls===1)throw Object.assign(Error('size'),{reduceBatch:true});return answer(p,id);
 }});
 assert.equal(reviews,1);assert.equal(result.published.nodes[0].description,'按原文补全的详情');assert.equal(result.published.needsDetailReview,false);
});
