import test from 'node:test';import assert from 'node:assert/strict';
import {reviewTree,reviewPrompt,mergeReview} from './tree-review.mjs';
import {organizeLong} from './long-organizer.mjs';
import {readApiResponse,completionText,apiError} from './external-api.mjs';
const node=(id,parent=null)=>({id,parent,lane:parent?'branch':'main',title:'原题',summary:'原概括',description:'已有事实',status:'待验证',sources:['m'],evidence:[{messageId:'m',start:0,end:3,digest:'d'}]});
function answer(prompt){const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],targets=JSON.parse(prompt.split('本页指定节点：')[1]);return JSON.stringify({requestId,upserts:targets.map(n=>({...n,title:'优化后的任务',summary:'先明确目标，再检验方案',description:'保留已有事实及尚待验证的结果'}))});}
test('review covers all nodes, checkpoints resume and preserves source evidence/status',async()=>{
 const state={nodes:[node('root'),...Array.from({length:10},(_,i)=>node('n'+i,'root'))],currentNodeId:'n9',manifest:{m:'digest'}};
 let saved,calls=0;
 await assert.rejects(reviewTree({state,save:async r=>{saved=structuredClone(r);},run:async prompt=>{if(++calls===2)throw Object.assign(Error('offline'),{retryable:true});return answer(prompt);}}),/offline/);
 assert.equal(saved.offset,8);assert.equal(state.nodes[0].title,'原题');
 const requestId=saved.pending.requestId;
 const next=await reviewTree({state,review:saved,save:async()=>{},run:async(prompt,id)=>{assert.equal(id,requestId);return answer(prompt);}});
 assert.equal(next.nodes.length,11);assert.ok(next.nodes.every(n=>n.title==='优化后的任务'));assert.deepEqual(next.nodes[0].evidence,state.nodes[0].evidence);assert.deepEqual(next.nodes[0].sources,['m']);assert.equal(next.nodes[0].status,'待验证');assert.equal(next.reviewVersion,1);
});
test('review rejects cycles, new IDs, missing coverage and keeps evidence even if model tries to change it',()=>{
 const nodes=[node('root'),node('a','root'),node('b','a')],targets=nodes.slice(1),{allowed}=reviewPrompt(nodes,targets,'r');
 const value={requestId:'r',upserts:targets.map(n=>({...n}))};value.upserts[0].parent='b';
 assert.throws(()=>mergeReview(JSON.stringify(value),nodes,targets,'r',allowed,'b'),/循环/);
 value.upserts[0].parent='root';value.upserts[0].sources=['invented'];value.upserts[0].status='已验证';
 const result=mergeReview(JSON.stringify(value),nodes,targets,'r',allowed,'b');assert.deepEqual(result[1].sources,['m']);assert.equal(result[1].status,'待验证');
 value.upserts.pop();assert.throws(()=>mergeReview(JSON.stringify(value),nodes,targets,'r',allowed,'b'),/完整覆盖/);
});
function batchAnswer(prompt){
 const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],prefix=prompt.match(/新 ID 必须以 (b[0-9]+_) 开头/)[1],parts=JSON.parse(prompt.split('本批资料：')[1].split('\n')[0]),catalog=JSON.parse(prompt.split('已有节点目录（摘要可能缩短，以原 ID 为准）：')[1].split('\n')[0]);
 const root=catalog.find(n=>n.parent===null);
 return JSON.stringify({requestId,currentNodeId:null,upserts:[{...node(root?.id||prefix+'0'),sources:parts.map(p=>p.partId)}]});
}
test('organization shrinks oversized batches and single parts without losing coverage, then reviews',async()=>{
 const text='原文'.repeat(2500),messages=[{id:'m',role:'user',text}],prompts=[],graphs=[];let saved;
 const result=await organizeLong({messages,compact:true,review:true,save:async d=>{saved=structuredClone(d);},onGraph:g=>graphs.push(structuredClone(g)),run:async prompt=>{
  prompts.push(prompt);if(prompt.includes('本页指定节点：'))return answer(prompt);
  const parts=JSON.parse(prompt.split('本批资料：')[1].split('\n')[0]);if(parts.some(p=>p.text.length>1500))throw Object.assign(Error('large'),{reduceBatch:true});
  return batchAnswer(prompt);
 }});
 assert.equal(result.job,null);assert.equal(result.published.reviewVersion,1);assert.equal(saved.published.nodes[0].title,'优化后的任务');
 const evidence=result.published.nodes[0].evidence.sort((a,b)=>a.start-b.start);assert.equal(evidence[0].start,0);assert.equal(evidence.at(-1).end,text.length);
 assert.ok(evidence.every((e,i)=>!i||e.start===evidence[i-1].end));assert.ok(prompts.some(p=>p.includes('本页指定节点：')));
 let reruns=0;await organizeLong({messages,record:result,compact:true,review:true,save:async()=>{},run:async()=>{reruns++;throw Error('should not repeat');}});
 assert.equal(reruns,0);
});
test('SSE reasoning traffic beyond old 4 MB limit does not reject a small result; actual oversized output triggers shrink',async()=>{
 const reasoning='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'x'.repeat(60000)}}]})+'\n\n';
 let i=0;const encoder=new TextEncoder();
 const stream=new ReadableStream({pull(c){if(i++<75)c.enqueue(encoder.encode(reasoning));else{c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));c.close();}}});
 assert.equal(completionText(await readApiResponse(new Response(stream,{headers:{'content-type':'text/event-stream'}}))),'ok');
 assert.throws(()=>completionText({choices:[{finish_reason:'length'}]}),e=>e.reduceBatch===true);
 assert.equal(apiError({status:413}).reduceBatch,true);
 const large='data: '+JSON.stringify({choices:[{delta:{content:'x'.repeat(270000)}}]})+'\n\n';
 await assert.rejects(readApiResponse(new Response(large,{headers:{'content-type':'text/event-stream'}})),e=>e.reduceBatch===true);
});
