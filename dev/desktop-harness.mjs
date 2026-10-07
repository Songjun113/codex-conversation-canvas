import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';
import {startServer} from '../standalone/server.mjs';import {allowedRequest} from '../standalone/desktop-bridge.mjs';
const id='11111111-1111-1111-1111-111111111111',dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-popup-'));
const messages=['完成项目目标','尝试 A 失败，改用方案 B','方案 B 验证通过'].map((text,i)=>({id:'m'+i,role:'user',text,phase:''}));
const service=await startServer({port:0,dataDir:dir,history:{list:async()=>({data:[{id,name:'弹窗验证任务'}]}),read:async()=>({status:'ok',kind:'canvas-messages',session_id:id,messages,content:'fixture',source:'app-server'})},fetchImpl:async(url,options)=>{
 const prompt=JSON.parse(options.body).messages[0].content;
 if(prompt.includes('本轮片段：')){
  const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],parts=JSON.parse(prompt.split('本轮片段：')[1]);
  const content=JSON.stringify({requestId,summaries:parts.map(p=>({source:p.source,goal:p.text.slice(0,100),proposal:'',attempt:'',result:'',failure:'',pivot:'',unresolved:''}))});
  return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 }
 if(prompt.includes('本页指定节点：')){
  const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],nodes=JSON.parse(prompt.split('本页指定节点：')[1]);
  const content=JSON.stringify({requestId,upserts:nodes.map((n,i)=>({...n,title:['明确项目目标','评估方案 A 的失败','验证并推进方案 B'][i]||n.title,summary:'承接上层目标，说明本步的尝试与结果',description:n.description}))});
  return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 }
 const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],prefix=prompt.match(/新 ID 必须以 (b[0-9]+_) 开头/)[1],parts=JSON.parse(prompt.split('本批资料：')[1].split('\n')[0]);
 const content=JSON.stringify({requestId,currentNodeId:prefix+'2',upserts:parts.map((p,i)=>({id:prefix+i,parent:i?prefix+'0':null,lane:i?'branch':'main',title:['项目目标','尝试 A','方案 B'][i],summary:'弹窗验证的模拟结果',description:p.text,status:i===1?'已放弃':'待验证',sources:[p.partId]}))});
 return new Response('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}});
const mock="window.conversationCanvasBridge=async text=>{const request=JSON.parse(text);if(request.cancel)return;const deliver=data=>window.__canvasDesktopReceive(request.generation,request.id,data);try{const r=await fetch('/bridge',{method:'POST',body:text});deliver({status:r.status,headers:{'content-type':r.headers.get('content-type')}});for await(const bytes of r.body){let binary='';for(const b of bytes)binary+=String.fromCharCode(b);deliver({chunk:btoa(binary)});}deliver({done:true});}catch{deliver({error:'fixture failed'});}};";
const server=http.createServer(async(req,res)=>{
 res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'none'");
 if(req.url.startsWith('/bridge')){try{const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));if(!allowedRequest(input))throw Error();const r=await fetch(service.origin+input.route,{method:input.method,headers:{'x-canvas-token':service.token,'content-type':'application/json'},body:input.method==='POST'?input.body:undefined});res.writeHead(r.status,{'content-type':r.headers.get('content-type')});for await(const c of r.body)res.write(c);res.end();}catch{res.writeHead(500);res.end('{}');}return;}
 if(req.url==='/canvas.js'){res.setHeader('content-type','text/javascript');res.end(mock+'\n'+fs.readFileSync(new URL('../public/canvas.desktop.user.js',import.meta.url),'utf8').replace("location.origin!=='app://-'","false"));return;}
 res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Codex 弹窗验证</title><style>body{font:14px system-ui;margin:0;background:#f9fafb;color:#182230}header{display:flex;align-items:center;height:60px;padding:0 22px;background:white;border-bottom:1px solid #ddd}.ms-auto{margin-left:auto;display:flex;min-width:32px;height:32px}main{padding:35px}</style><header data-testid="app-shell-header-context-menu-surface"><strong>Codex · 模拟对话窗口</strong><div class="ms-auto" data-app-shell-header-obstacle="true"></div></header><main><h2>弹窗验证任务</h2><p>这是本地测试页面；点击右上角图标，在当前窗口打开独立画布。</p><textarea aria-label="主对话草稿">保留的主对话草稿</textarea></main><script src="/canvas.js"></script>');
});
server.listen(47837,'127.0.0.1',()=>console.log('http://127.0.0.1:47837/?thread='+id));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{server.closeAllConnections();server.close();await service.close();fs.rmSync(dir,{recursive:true,force:true});process.exit();});
