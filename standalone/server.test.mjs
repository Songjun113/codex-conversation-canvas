import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {startServer} from './server.mjs';
test('authenticated local service, streamed model, saved tree and offline snapshot survive restart',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-server-'));let calls=0;
 const history={list:async()=>({data:[]}),read:async id=>({session_id:id,messages:[{id:'m',text:'saved'}]})};
 let s=await startServer({port:0,dataDir,history,fetchImpl:async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer fixture');return new Response('data: {"ok":true}\n\n',{headers:{'content-type':'text/event-stream'}});}});
 t.after(async()=>{await s.close();await fs.rm(dataDir,{recursive:true,force:true});});
 const req=(route,options={})=>fetch(s.origin+route,{...options,headers:{'x-canvas-token':s.token,...options.headers}});
 assert.equal((await fetch(s.origin+'/api/threads')).status,403);
 assert.equal((await req('/api/threads',{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await req('/api/threads')).status,200);assert.equal(calls,0);
 assert.equal((await fetch(s.origin+'/package.json')).status,404);
 await req('/api/store?key=tree:one',{method:'POST',body:JSON.stringify({nodes:[{id:'n'}]})});
 await req('/api/history?id=one');
 const r=await req('/api/model',{method:'POST',body:JSON.stringify({url:'https://example.com/v1/chat/completions',key:'Bearer fixture',body:'{}'})});
 assert.equal(r.status,200);assert.match(await r.text(),/ok/);assert.equal(calls,1);
 await s.close();s=await startServer({port:0,dataDir,history:{...history,read:async()=>{throw Error('offline');}}});
 assert.deepEqual(await(await req('/api/store?key=tree:one')).json(),{nodes:[{id:'n'}]});
 const snapshot=await(await req('/api/history?id=one')).json();assert.equal(snapshot.offline,true);assert.equal(snapshot.messages[0].text,'saved');
});
test('provider failures cannot echo secrets',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-secret-'));
 const s=await startServer({port:0,dataDir,history:{},fetchImpl:async()=>{throw Error('SECRET');}});
 t.after(async()=>{await s.close();await fs.rm(dataDir,{recursive:true,force:true});});
 const r=await fetch(s.origin+'/api/model',{method:'POST',headers:{'x-canvas-token':s.token},body:JSON.stringify({url:'https://example.com/v1/chat/completions',key:'Bearer SECRET',body:'{}'})});
 assert.equal(r.status,500);assert.doesNotMatch(await r.text(),/SECRET/);
});
