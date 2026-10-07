import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {EventEmitter} from 'node:events';import {webcrypto} from 'node:crypto';
import {validTarget,allowedRequest,attachDesktop} from './desktop-bridge.mjs';
const target={id:'t',type:'page',url:'app://-/index.html',webSocketDebuggerUrl:'ws://127.0.0.1:9229/devtools/page/t'};
test('desktop attaches only to local Codex main windows and limits bridge routes',()=>{
 assert.equal(validTarget(target,9229),true);
 for(const patch of [{url:'https://example.com'},{type:'webview'},{url:'app://-/index.html?initialRoute=avatar-overlay'},{webSocketDebuggerUrl:'ws://example.com:9229/devtools/page/t'},{webSocketDebuggerUrl:'ws://127.0.0.1:9999/devtools/page/t'}])assert.equal(validTarget({...target,...patch},9229),false);
 assert.equal(allowedRequest({method:'POST',route:'/api/model'}),true);
 for(const route of ['https://evil.example/api/store','//evil.example/api/store','/api/execute','/api/store/../../secret'])assert.equal(allowedRequest({method:'POST',route}),false);
});
test('renderer bridge streams UTF-8, handles HTTP errors, ignores stale generations and cancels',async()=>{
 const messages=[],window={};window.top=window;window.conversationCanvasBridge=s=>messages.push(JSON.parse(s));
 vm.runInNewContext(fs.readFileSync(new URL('./desktop-host.js',import.meta.url),'utf8'),{window,location:{origin:'app://-'},crypto:webcrypto,Response,ReadableStream,Uint8Array,atob,setTimeout,clearTimeout,Error,Map,JSON});
 const send=(request,event)=>window.__canvasDesktopReceive(request.generation,request.id,event);
 const read=window.canvasStandalone.read('thread');const r=messages.at(-1);
 window.__canvasDesktopReceive('stale',r.id,{error:'must be ignored'});
 send(r,{accepted:true});send(r,{status:200,headers:{'content-type':'application/json'}});
 send(r,{chunk:Buffer.from(JSON.stringify({messages:[{text:'任务🌳'}]})).toString('base64')});send(r,{done:true});
 assert.equal((await read).messages[0].text,'任务🌳');
 const bad=window.canvasStandalone.read('bad');const b=messages.at(-1);send(b,{status:503,headers:{}});send(b,{chunk:Buffer.from('{"error":"offline"}').toString('base64')});send(b,{done:true});await assert.rejects(bad,e=>e.status===503);
 const controller=new AbortController(),cancelled=window.canvasStandalone.read('cancel',controller.signal);controller.abort(Error('stopped'));await assert.rejects(cancelled,/stopped/);assert.equal(messages.at(-1).cancel,true);
 window.__canvasDesktopTransportClose();
});
test('service streams only from trusted default contexts and registers reload injection',async()=>{
 class Fake extends EventEmitter{constructor(){super();this.calls=[];}async open(){}async call(method,params){this.calls.push({method,params});if(method==='Runtime.enable')this.emit('Runtime.executionContextCreated',{context:{id:7,origin:'app://-',auxData:{isDefault:true}}});return method==='Page.addScriptToEvaluateOnNewDocument'?{identifier:'reload'}:{};}close(){}}
 const client=new Fake();let requests=0;
 const connection=await attachDesktop(target,{port:9229,origin:'http://127.0.0.1:47835',token:'private-token',script:'/* canvas */',client,fetchImpl:async(url,options)=>{requests++;assert.equal(options.headers['x-canvas-token'],'private-token');return new Response('data: 你好\n\n');}});
 const input={id:'1',generation:'generation',route:'/api/model',method:'POST',body:'{}'},event={name:'conversationCanvasBridge',executionContextId:7,payload:JSON.stringify(input)};
 client.emit('Runtime.bindingCalled',{...event,executionContextId:9});assert.equal(requests,0);
 client.emit('Runtime.bindingCalled',event);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);
 const expressions=client.calls.filter(c=>c.method==='Runtime.evaluate').map(c=>c.params.expression);
 assert.ok(expressions.some(e=>e.includes('"done":true')));assert.ok(expressions.some(e=>e.includes(Buffer.from('data: 你好\n\n').toString('base64'))));
 assert.ok(client.calls.some(c=>c.method==='Page.addScriptToEvaluateOnNewDocument'));
 assert.ok(expressions.every(e=>!e.includes('private-token')));
 await connection.dispose();assert.ok(client.calls.some(c=>c.method==='Runtime.removeBinding'));
});
