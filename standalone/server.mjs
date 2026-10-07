import http from 'node:http';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AppServer} from './app-server.mjs';import {History} from './history.mjs';
import {apiEndpoint} from '../external-api.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function resolveCodex(){
  if(process.env.CANVAS_CODEX)return {command:process.env.CANVAS_CODEX,args:[]};
  const dirs=(process.env.PATH||'').split(path.delimiter);
  for(const dir of dirs){const exe=path.join(dir,process.platform==='win32'?'codex.exe':'codex');if(fs.existsSync(exe))return {command:exe,args:[]};}
  if(process.platform==='win32')for(const dir of dirs){
    const cmd=path.join(dir,'codex.cmd');if(!fs.existsSync(cmd))continue;
    const text=fs.readFileSync(cmd,'utf8'),direct=text.match(/"([^"\r\n]+node\.exe)"\s+"([^"\r\n]+codex\.js)"/i);
    if(direct&&fs.existsSync(direct[1])&&fs.existsSync(direct[2]))return {command:direct[1],args:[direct[2]]};
    const js=path.join(dir,'node_modules','@openai','codex','bin','codex.js');if(fs.existsSync(js))return {command:process.execPath,args:[js]};
  }
  throw Error('未找到 Codex CLI。请安装官方 CLI，或通过 CANVAS_CODEX 指定 codex.exe 路径。');
}
export async function startServer({port=47835,home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),dataDir=process.env.CANVAS_DATA_DIR||path.join(os.homedir(),'.conversation-canvas'),history:provided,fetchImpl=fetch,desktop=false}={}){
  await fs.promises.mkdir(dataDir,{recursive:true});
  let rpc,connecting;
  const connect={async call(method,params){
    if(!rpc||rpc.dead){
      if(!connecting)connecting=(async()=>{const resolved=resolveCodex();const candidate=new AppServer(resolved.command,resolved.args);try{await candidate.start();rpc=candidate;}catch(e){candidate.close();throw e;}})().finally(()=>{connecting=null;});
      await connecting;
    }
    return rpc.call(method,params);
  }};
  const history=provided||new History(home,connect),token=randomBytes(32).toString('hex');
  let origin;
  const recordFile=key=>path.join(dataDir,createHash('sha256').update(key).digest('hex')+'.json');
  const read=async key=>{try{return JSON.parse(await fs.promises.readFile(recordFile(key),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const write=async(key,value)=>{const dest=recordFile(key),temp=dest+'.'+randomBytes(6).toString('hex')+'.tmp';await fs.promises.writeFile(temp,JSON.stringify(value),{mode:0o600});await fs.promises.rename(temp,dest);};
  const body=async req=>{const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>32*1024*1024)throw Error('请求过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
  const server=http.createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));};
    try{
      if(req.headers.host!==new URL(origin).host){json(403,{error:'无效来源'});return;}
      const url=new URL(req.url,origin);
      if(url.pathname==='/health'&&req.method==='GET'){json(200,{product:'conversation-canvas',mode:desktop?'desktop':'standalone'});return;}
      if(url.pathname.startsWith('/api/')){
        if(req.headers['x-canvas-token']!==token||(req.headers.origin&&req.headers.origin!==origin)){json(403,{error:'请使用启动程序提供的地址打开画布'});return;}
        if(url.pathname==='/api/threads'&&req.method==='GET'){json(200,await history.list(url.searchParams.get('cursor')));return;}
        if(url.pathname==='/api/history'&&req.method==='GET'){
          const id=url.searchParams.get('id');try{const result=await history.read(id);await write('snapshot:'+id,result);json(200,result);}
          catch(e){const cached=await read('snapshot:'+id);if(!cached)throw e;json(200,{...cached,offline:true,warning:'连接暂不可用，正在显示上次保存的原文'});}return;
        }
        if(url.pathname==='/api/store'){
          const key=url.searchParams.get('key');if(!key||key.length>250)throw Error('存储标识无效');
          if(req.method==='GET'){json(200,await read(key));return;}
          if(req.method==='POST'){const value=await body(req);await write(key,value);json(200,{ok:true});return;}
        }
        if(url.pathname==='/api/model'&&req.method==='POST'){
          const input=await body(req),endpoint=apiEndpoint(input.url);
          if(endpoint!==input.url||typeof input.key!=='string'||/[\r\n]/.test(input.key)||typeof input.body!=='string')throw Error('模型请求格式无效');
          const controller=new AbortController();res.on('close',()=>controller.abort());
          const upstream=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:input.key},body:input.body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(180000)])});
          if(!upstream.ok){await upstream.body?.cancel();json(upstream.status,{error:'模型服务返回错误'});return;}
          res.writeHead(200,{'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
          for await(const chunk of upstream.body){if(!res.write(chunk))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});if(res.destroyed)break;}res.end();return;
        }
        json(404,{error:'接口不存在'});return;
      }
      const assets={'/':'standalone/index.html','/app.js':'standalone/host.js','/canvas.js':'public/canvas.standalone.js'};
      if(!assets[url.pathname]||req.method!=='GET'){json(404,{error:'不存在'});return;}
      res.writeHead(200,{'content-type':url.pathname==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'","referrer-policy":"no-referrer"});
      res.end(await fs.promises.readFile(path.join(root,assets[url.pathname])));
    }catch(e){if(res.headersSent){res.destroy();return;}json(500,{error:req.url?.startsWith('/api/model')?'API 请求失败或超时，请重试':e.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin='http://127.0.0.1:'+server.address().port;
  return {server,url:origin+'/#token='+token,token,origin,close:async()=>{rpc?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const running=await startServer();console.log('Conversation Canvas: '+running.url);
  for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>running.close().then(()=>process.exit()));
}
