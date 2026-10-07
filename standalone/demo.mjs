// Synthetic integration fixture: no external network and no personal history.
import {startServer} from './server.mjs';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const id='11111111-1111-1111-1111-111111111111';
const messages=['目标：整理项目的任务与尝试。','尝试 A：页面注入，更新后失效。','尝试 B：独立读取历史，验证通过。'].map((text,i)=>({id:'m'+i,text,role:'user',phase:'',turnId:null}));
const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-demo-'));
const running=await startServer({port:47836,dataDir,history:{list:async()=>({data:[{id,name:'独立画布验证项目'}]}),read:async()=>({status:'ok',kind:'canvas-messages',session_id:id,messages,content:'fixture',source:'app-server'})},
fetchImpl:async(url,options)=>{
 const prompt=JSON.parse(options.body).messages[0].content;
 if(prompt.includes('本轮片段：')){
  const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],parts=JSON.parse(prompt.split('本轮片段：')[1]);
  const content=JSON.stringify({requestId,summaries:parts.map(p=>({source:p.source,goal:p.text.slice(0,100),proposal:'',attempt:'',result:'',failure:'',pivot:'',unresolved:''}))});
  return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 }
 if(prompt.includes('本页指定节点：')){
  const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],nodes=JSON.parse(prompt.split('本页指定节点：')[1]);
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({requestId,upserts:nodes.map(n=>({...n,title:'复盘：'+n.title}))})},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});
 }
 const requestId=prompt.match(/"requestId":"([^"]+)"/)[1],prefix=prompt.match(/新 ID 必须以 (b[0-9]+_) 开头/)[1];
 const parts=JSON.parse(prompt.split('本批资料：')[1].split('\n')[0]);
 const content=JSON.stringify({requestId,currentNodeId:prefix+'2',upserts:parts.map((p,i)=>({id:prefix+i,parent:i?prefix+'0':null,lane:i?'branch':'main',title:['项目目标','尝试 A：页面注入','尝试 B：独立读取'][i],summary:'模拟模型结果，仅验证接口和画布',description:p.text,status:i===1?'已放弃':'待验证',sources:[p.partId]}))});
 return new Response('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}});
console.log(running.url.replace('/#','/?thread='+id+'#'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await running.close();await fs.rm(dataDir,{recursive:true,force:true});process.exit();});
