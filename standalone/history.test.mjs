import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {History,parseSavedMessage} from './history.mjs';
const id='11111111-1111-1111-1111-111111111111';
const meta=(ordinal,base)=>({ordinal,type:'session_meta',payload:{id,history_base:base}});
const msg=(ordinal,text)=>({ordinal,type:'response_item',payload:{type:'message',role:'user',content:[{text}]}});
const lines=rows=>rows.map(r=>JSON.stringify(r)+'\n').join('');
async function fixture(t){const home=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-history-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'sessions'));const file=name=>path.join(home,'sessions',name+'-'+id+'.jsonl');const h=new History(home,{call:async()=>{throw Error('unsupported');}});return {home,file,h};}
test('joins rollover at byte cutoff, excludes retired tail and updates appended messages',async t=>{
 const {file,h}=await fixture(t),root=lines([meta(0),msg(1,'first')]);await fs.writeFile(file('base'),root+lines([msg(2,'retired')]));
 const base={thread_id:id,end_ordinal_exclusive:2,end_byte_offset:Buffer.byteLength(root)};
 await fs.writeFile(file('next'),lines([meta(2,base),msg(3,'second')])+'{"ordinal":4');
 let r=await h.read(id);assert.deepEqual(r.messages.map(m=>m.text),['first','second']);assert.equal(r.segments,2);assert.equal(r.tailPending,true);
 await fs.appendFile(file('next'),',"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"third"}]}}\n');
 r=await h.read(id);assert.deepEqual(r.messages.map(m=>m.text),['first','second','third']);assert.equal(r.tailPending,false);
});
test('rejects gaps and missing parent rather than publishing partial history',async t=>{
 const {file,h}=await fixture(t);await fs.writeFile(file('base'),lines([meta(0),msg(2,'gap')]));
 await assert.rejects(h.read(id),/编号/);
 await fs.writeFile(file('base'),lines([meta(10,{thread_id:id,end_ordinal_exclusive:10,end_byte_offset:100}),msg(11,'orphan')]));
 await assert.rejects(h.read(id),/唯一/);
});
test('rejects malformed complete records; accepts old records without ordinals',async t=>{
 const {file,h}=await fixture(t);await fs.writeFile(file('base'),lines([meta(undefined),msg(undefined,'old')]));assert.equal((await h.read(id)).messages.length,1);
 await fs.appendFile(file('base'),'broken\n');await assert.rejects(h.read(id),/损坏/);
});
test('official pagination path works without local files',async t=>{
 const {home}=await fixture(t);const h=new History(home,{call:async method=>method==='thread/turns/list'?{data:[{id:'t',status:'completed'}]}:{data:[{turnId:'t',item:{id:'m',type:'userMessage',content:[{text:'official'}]}}]}});
 const r=await h.read(id);assert.equal(r.source,'app-server');assert.equal(r.messages[0].text,'official');await assert.rejects(h.read('../bad'),/无效/);
});


test('normalizes local questions and image wrappers; source IDs survive adapter changes',()=>{
 const question=parseSavedMessage({type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:'q',arguments:JSON.stringify({questions:[{title:'Which approach?',options:['A','B']}]})}},'fallback');
 assert.equal(question.text,'Which approach?\n- A\n- B');assert.equal(question.phase,'final_answer');
 assert.equal(parseSavedMessage(msg(1,'<codex_internal_context source="goal">system</codex_internal_context>'),'x'),null);
 const image=msg(1,'request');image.payload.content.push({text:'<image name=[Image #1] path="private">'},{type:'input_image'},{text:'</image>'});assert.equal(parseSavedMessage(image,'x').text,'request');
 const h=new History('',{}),a=h.result(id,[{id:'native',role:'user',text:'same'}],'app-server'),b=h.result(id,[{id:'file',role:'user',text:'same'}],'local-files');assert.equal(a.messages[0].id,b.messages[0].id);
});
