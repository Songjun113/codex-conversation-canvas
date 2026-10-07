import fs from 'node:fs';import {EventEmitter} from 'node:events';
export function validTarget(target,port){
 try{const page=new URL(target.url),ws=new URL(target.webSocketDebuggerUrl);
 return target.type==='page'&&page.origin==='null'&&page.protocol==='app:'&&page.hostname==='-'&&['/index.html','/detached-window.html'].includes(page.pathname)&&!/(prewarm|avatar-overlay)/.test(target.url)&&ws.protocol==='ws:'&&['127.0.0.1','[::1]','localhost'].includes(ws.hostname)&&Number(ws.port)===port&&!ws.username&&!ws.password&&ws.pathname.startsWith('/devtools/page/');
 }catch{return false;}
}
export class Cdp extends EventEmitter{
 constructor(url){super();this.url=url;this.pending=new Map();this.seq=0;}
 async open(){
  this.ws=new WebSocket(this.url);
  this.ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(m.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else this.emit(m.method,m.params);});
  this.ws.addEventListener('close',()=>{this.dead=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('desktop disconnected'));}this.pending.clear();this.emit('disconnect');});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.ws.close();reject(Error('desktop connection timeout'));},5000);this.ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('desktop connection failed'));},{once:true});});
 }
 call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.seq,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('desktop command timeout'));},10000);this.pending.set(id,{resolve,reject,timer});try{this.ws.send(JSON.stringify({id,method,params}));}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 close(){this.dead=true;this.ws?.close();}
}
export function allowedRequest(input){
 if(!['GET','POST'].includes(input.method)||typeof input.route!=='string')return false;
 const u=new URL(input.route,'http://canvas');
 return input.route.startsWith('/api/')&&u.origin==='http://canvas'&&(
 (u.pathname==='/api/history'&&input.method==='GET')||
 (u.pathname==='/api/threads'&&input.method==='GET')||
 u.pathname==='/api/store'||(u.pathname==='/api/model'&&input.method==='POST'));
}
export async function attachDesktop(target,{port,origin,token,script,client,fetchImpl=fetch}){
 if(!validTarget(target,port))throw Error('Invalid desktop target');
 const cdp=client||new Cdp(target.webSocketDebuggerUrl),contexts=new Set(),requests=new Map();
 const abortAll=()=>{for(const controller of requests.values())controller.abort();requests.clear();};
 cdp.on('disconnect',abortAll);
 cdp.on('Runtime.executionContextCreated',({context})=>{if(context.auxData?.isDefault&&context.origin==='app://-')contexts.add(context.id);});
 cdp.on('Runtime.executionContextDestroyed',({executionContextId})=>{contexts.delete(executionContextId);for(const [key,controller]of requests)if(key.startsWith(executionContextId+':')){controller.abort();requests.delete(key);}});
 cdp.on('Runtime.executionContextsCleared',()=>{contexts.clear();abortAll();});
 cdp.on('Runtime.bindingCalled',async event=>{
  if(event.name!=='conversationCanvasBridge'||!contexts.has(event.executionContextId))return;
  let input;try{input=JSON.parse(event.payload);}catch{return;}
  if(typeof input.id!=='string'||input.id.length>80||typeof input.generation!=='string'||input.generation.length>80)return;
  const key=event.executionContextId+':'+input.generation+':'+input.id;
  if(input.cancel){requests.get(key)?.abort();return;}
  const deliver=async data=>{const result=await cdp.call('Runtime.evaluate',{contextId:event.executionContextId,expression:'window.__canvasDesktopReceive?.('+[input.generation,input.id,data].map(value=>JSON.stringify(value)).join(',')+')',returnByValue:true});if(result.exceptionDetails)throw Error('Desktop receiver unavailable');};
  if(requests.has(key))return;
  const controller=new AbortController();requests.set(key,controller);
  try{
   if(!allowedRequest(input))throw Error('Unsupported canvas request');
   await deliver({accepted:true});
   const response=await fetchImpl(origin+input.route,{method:input.method,headers:{'x-canvas-token':token,'content-type':'application/json'},body:input.method==='POST'?input.body:undefined,signal:controller.signal});
   await deliver({status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json'}});
   for await(const chunk of response.body){if(controller.signal.aborted)break;await deliver({chunk:Buffer.from(chunk).toString('base64')});}
   await deliver({done:true});
  }catch{if(!controller.signal.aborted)await deliver({error:'画布后台连接中断，请重试'}).catch(()=>{});}
  finally{requests.delete(key);}
 });
 await cdp.open();
 try{
  await cdp.call('Runtime.enable');await cdp.call('Runtime.addBinding',{name:'conversationCanvasBridge'});
  const registered=await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:script});
  const result=await cdp.call('Runtime.evaluate',{expression:script,returnByValue:true});if(result.exceptionDetails)throw Error('Canvas installation failed');
  cdp.dispose=async()=>{abortAll();try{await cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:registered.identifier});await cdp.call('Runtime.evaluate',{expression:'window.__conversationCanvasCleanup?.();window.__canvasDesktopTransportClose?.();delete window.canvasStandalone;'});await cdp.call('Runtime.removeBinding',{name:'conversationCanvasBridge'});}finally{cdp.close();}};
  return cdp;
 }catch(e){cdp.close();throw e;}
}
export function watchDesktop({port=9229,origin,token,onStatus=()=>{}}){
 const script=fs.readFileSync(new URL('../public/canvas.desktop.user.js',import.meta.url),'utf8'),sessions=new Map();let busy=false,stopped=false,last='';
 const status=value=>{if(value!==last){last=value;onStatus(value);}};
 const poll=async()=>{if(busy||stopped)return;busy=true;try{
  const response=await fetch('http://127.0.0.1:'+port+'/json',{signal:AbortSignal.timeout(2500)});const targets=(await response.json()).filter(t=>validTarget(t,port));
  for(const [id,c]of sessions)if(c.dead||!targets.some(t=>t.id===id)){c.close();sessions.delete(id);}
  for(const target of targets)if(!sessions.has(target.id)){const c=await attachDesktop(target,{port,origin,token,script});if(stopped){await c.dispose();break;}sessions.set(target.id,c);}
  status(sessions.size?'已连接 Codex：画布按钮已就绪':'等待 Codex 主窗口');
 }catch{status('等待 Codex 桌面连接（请通过 Codex++ 启动）');}finally{busy=false;}};
 const timer=setInterval(poll,3000);poll();
 return {async close(){stopped=true;clearInterval(timer);await Promise.allSettled([...sessions.values()].map(c=>c.dispose()));sessions.clear();}};
}
