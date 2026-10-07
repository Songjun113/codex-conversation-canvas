(()=>{
if(window.top!==window||location.origin!=='app://-')return;
window.__conversationCanvasCleanup?.();
window.__canvasDesktopTransportClose?.();
const pending=new Map(),generation=crypto.randomUUID();let seq=0;
const send=value=>{if(typeof window.conversationCanvasBridge!=='function')throw Error('画布后台未连接，请启动桌面连接服务');window.conversationCanvasBridge(JSON.stringify({...value,generation}));};
function finish(id,error){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);if(error){p.reject(error);try{p.controller?.error(error);}catch{}}else p.controller?.close();}
window.__canvasDesktopReceive=(g,id,event)=>{if(g!==generation)return;const p=pending.get(id);if(!p)return;
 if(event.accepted){clearTimeout(p.timer);p.timer=setTimeout(p.timeout,190000);return;}
 if(event.error){finish(id,Object.assign(Error(event.error),{status:event.status}));return;}
 if(event.headers){p.resolve(new Response(new ReadableStream({start(controller){p.controller=controller;},cancel(){p.abort();}}),{status:event.status,headers:event.headers}));}
 if(event.chunk){const raw=atob(event.chunk);p.controller.enqueue(Uint8Array.from(raw,c=>c.charCodeAt(0)));}
 if(event.done)finish(id);
};
async function request(route,options={}){
 const response=await new Promise((resolve,reject)=>{const id=String(++seq);const abort=()=>{try{send({id,cancel:true});}catch{}finish(id,options.signal?.reason||Error('请求已取消'));};
 const timeout=()=>{try{send({id,cancel:true});}catch{}finish(id,Error('画布后台未响应，请运行 start-desktop.ps1 后重试'));};const timer=setTimeout(timeout,5000);
 pending.set(id,{resolve,reject,timer,timeout,signal:options.signal,abort});if(options.signal?.aborted){abort();return;}options.signal?.addEventListener('abort',abort,{once:true});
 try{send({id,route,method:options.method||'GET',body:options.body});}catch(e){finish(id,e);}
 });
 if(!response.ok){let value;try{value=await response.json();}catch{}throw Object.assign(Error(value?.error||'画布服务请求失败'),{status:response.status});}return response;
}
window.__canvasDesktopTransportClose=()=>{for(const [id,p] of pending)p.abort();pending.clear();};
window.canvasStandalone={
 embedded:true,
 async read(id,signal){return (await request('/api/history?id='+encodeURIComponent(id),{signal})).json();},
 async list(cursor){return (await request('/api/threads'+(cursor?'?cursor='+encodeURIComponent(cursor):''))).json();},
 async store(key,value,write){return (await request('/api/store?key='+encodeURIComponent(key),write?{method:'POST',body:JSON.stringify(value??null)}:{})).json();},
 model(url,options){return request('/api/model',{method:'POST',body:JSON.stringify({url,key:options.headers?.Authorization||'',body:options.body}),signal:options.signal});}
};
})();
