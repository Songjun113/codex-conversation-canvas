import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeParts,briefTasks,parseBrief} from './parallel-briefs.mjs';
import {organizeLong,prepareHistory} from './long-organizer.mjs';
import {createApiOrganizer,apiConfig} from './external-api.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const messages=Array.from({length:8},(_,i)=>[{id:'u'+i,role:'user',text:'目标 '+i},{id:'a'+i,role:'assistant',phase:'final_answer',text:'尝试 '+i+'，失败后修改方案。'}]).flat();
function briefAnswer(prompt,id){return JSON.stringify({requestId:id,summaries:JSON.parse(prompt.split('本轮片段：')[1]).map(p=>({source:p.source,goal:p.text.slice(0,60),proposal:'',attempt:'尝试',result:'尚未验证',failure:'',pivot:'',unresolved:''}))});}
function treeAnswer(prompt,id){const parts=JSON.parse(prompt.split('本批资料：')[1].split('\n')[0]),catalog=JSON.parse(prompt.split('已有节点目录（摘要可能缩短，以原 ID 为准）：')[1].split('\n')[0]),root=catalog.find(n=>n.parent===null),prefix=prompt.match(/新 ID 必须以 (b\d+_) 开头/)[1];return JSON.stringify({requestId:id,currentNodeId:root?.id||prefix+'0',upserts:[{id:root?.id||prefix+'0',parent:null,lane:'main',title:'目标',summary:'任务事实',description:'保留失败原因与转向',status:'待验证',sources:parts.map(p=>p.partId)}]});}
test('bounded concurrent rounds complete out of order but compile in original order with exact evidence',async()=>{
 let active=0,peak=0,briefCalls=0,record,writeActive=0;const completion=[];
 const result=await organizeLong({messages,parallel:true,compact:true,concurrency:4,save:async v=>{assert.equal(writeActive++,0);await wait(1);record=v;writeActive--;},run:async(p,id)=>{
  if(p.includes('本轮片段：')){const index=briefCalls++;peak=Math.max(peak,++active);await wait(index===0?30:3);active--;completion.push(index);return briefAnswer(p,id);}
  const parts=JSON.parse(p.split('本批资料：')[1].split('\n')[0]);assert.match(parts[0].text,/目标 0/);return treeAnswer(p,id);
 }});
 assert.equal(peak,4);assert.notEqual(completion[0],0);assert.equal(briefCalls,8);assert.equal(record.job,null);
 const original=await prepareHistory(messages);assert.deepEqual(result.published.nodes[0].evidence,original.parts.map(({messageId,start,end,digest})=>({messageId,start,end,digest})));
 await organizeLong({messages,record:result,parallel:true,save:async()=>{},run:async()=>{throw Error('must reuse completed work');}});
 let incremental=0;await organizeLong({messages:[...messages,{id:'new',role:'user',text:'下一步'}],record:result,parallel:true,save:async()=>{},run:async(p,id)=>{if(p.includes('本轮片段：')){incremental++;return briefAnswer(p,id);}return treeAnswer(p,id);}});assert.equal(incremental,1);
});
test('failure drains other workers, saves their results, and retries only unfinished units',async()=>{
 const {parts}=await prepareHistory(messages);let saved,fail=true;const seen=new Map();
 const run=async(p,id)=>{const source=JSON.parse(p.split('本轮片段：')[1])[0].text;seen.set(source,(seen.get(source)||0)+1);if(source==='目标 0'&&fail){fail=false;await wait(2);throw Object.assign(Error('rate'),{retryable:true});}await wait(8);return briefAnswer(p,id);};
 const options={parts,done:{},run,save:async(cache,tasks)=>{saved=structuredClone({cache,tasks});}};
 await assert.rejects(summarizeParts(options),/rate/);assert.equal(Object.keys(saved.cache).length,6);
 await summarizeParts({...options,...saved});assert.equal(seen.get('目标 1'),1);assert.equal(seen.get('目标 0'),2);
});
test('oversized brief splits its round; malformed references cannot commit',async()=>{
 const {parts}=await prepareHistory(messages.slice(0,2));let calls=0,cache={};
 await summarizeParts({parts,done:{},cache,run:async(p,id)=>{calls++;if(calls===1)throw Object.assign(Error('size'),{reduceBatch:true});return briefAnswer(p,id);},save:async()=>{}});
 assert.equal(calls,3);assert.equal(Object.keys(cache).length,2);
 assert.throws(()=>parseBrief(JSON.stringify({requestId:'x',summaries:[{source:'unknown'}]}),{parts},'x'),/覆盖/);
});
test('API parallel sessions do not cancel each other and congestion is recorded',async()=>{
 let active=0,peak=0,attempt=0;
 const api=createApiOrganizer({retryDelayMs:1,request:async(u,o)=>{peak=Math.max(peak,++active);await wait(5);active--;assert.equal(o.signal.aborted,false);if(attempt++===0)throw {status:429};return {choices:[{message:{content:'ok'}}]};}});
 const config=apiConfig({channel:'external',baseUrl:'https://example.com',model:'test',key:'fixture'}),sessions=Array.from({length:4},(_,i)=>({parallelSlot:'s'+i}));
 assert.deepEqual(await Promise.all(sessions.map((s,i)=>api.run(config,'test','r'+i,s,async()=>{}))),['ok','ok','ok','ok']);
 assert.equal(peak,4);assert.ok(sessions.some(s=>s.congested));api.dispose();
});
test('round splitting retains the preceding dialogue as context',async()=>{
 const {parts}=await prepareHistory(messages);const tasks=briefTasks(parts);assert.equal(tasks.length,8);assert.equal(tasks[0].parts.length,2);assert.ok(tasks[1].context.some(c=>c.text.includes('目标 0')));
});
test('pausing keeps pending IDs and resumes saved tasks without losing completed summaries',async()=>{
 const {parts}=await prepareHistory(messages);const control=new AbortController();let saved,calls=0;
 await assert.rejects(summarizeParts({parts,done:{},signal:control.signal,concurrency:1,save:async(cache,tasks)=>{saved=structuredClone({cache,tasks});},run:async(p,id)=>{if(++calls===2){control.abort();control.signal.throwIfAborted();}return briefAnswer(p,id);}}),{name:'AbortError'});
 const pending=saved.tasks[1].requestId;let resumed=0;
 await summarizeParts({parts,done:{},...saved,concurrency:1,save:async()=>{},run:async(p,id)=>{if(!resumed++)assert.equal(id,pending);return briefAnswer(p,id);}});assert.equal(resumed,7);
});
test('congestion checkpoint reduces subsequent launches and single oversized units fall back to raw text',async()=>{
 const {parts}=await prepareHistory(messages);let launches=0,active=0,peakAfterThrottle=0,throttled=false;const statuses=[];
 await summarizeParts({parts,done:{},concurrency:4,save:async()=>{},progress:t=>statuses.push(t),run:async(p,id,session,checkpoint)=>{
  launches++;active++;if(launches===1){session.congested=true;await checkpoint();throttled=true;}else if(throttled&&launches>4)peakAfterThrottle=Math.max(peakAfterThrottle,active);
  await wait(5);active--;return briefAnswer(p,id);
 }});
 assert.ok(statuses.some(t=>t.includes('并发 2')));assert.ok(peakAfterThrottle<=2);
 const single=parts.slice(0,1),result=await summarizeParts({parts:single,done:{},save:async()=>{},run:async()=>{throw Object.assign(Error('size'),{reduceBatch:true});}});
 assert.equal(result[0].text,single[0].text);assert.equal(result[0].brief,undefined);
});
test('128 concurrency is configurable, persisted, and enforced as the scheduler ceiling',async()=>{
 const {storedApiConfig}=await import('./external-api.mjs');
 for(const value of [16,32,64,128])assert.equal(storedApiConfig(apiConfig({concurrency:value})).concurrency,value);
 assert.equal(apiConfig({concurrency:999}).concurrency,128);assert.equal(apiConfig({}).concurrency,4);
 const {parts}=await prepareHistory(Array.from({length:150},(_,i)=>({id:'high'+i,role:'user',text:'任务 '+i})));
 let active=0,peak=0;
 const results=await summarizeParts({parts,done:{},concurrency:999,save:async()=>{},run:async(p,id)=>{peak=Math.max(peak,++active);await wait(5);active--;return briefAnswer(p,id);}});
 assert.equal(peak,128);assert.equal(results.length,150);assert.ok(results.every(p=>p.brief));
});
