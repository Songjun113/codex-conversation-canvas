(()=>{
const fragment=new URLSearchParams(location.hash.slice(1)),token=fragment.get('token')||sessionStorage.getItem('canvas-token');
if(token)sessionStorage.setItem('canvas-token',token);history.replaceState(null,'',location.pathname+location.search);
async function request(route,options={}){
 const response=await fetch(route,{...options,headers:{'x-canvas-token':token,'content-type':'application/json',...options.headers}});
 if(!response.ok){let value;try{value=await response.json();}catch{}throw Object.assign(Error(value?.error||'本地服务无法连接'),{status:response.status});}return response;
}
window.canvasStandalone={
 async read(id,signal){return (await request('/api/history?id='+encodeURIComponent(id),{signal})).json();},
 async store(key,value,write){const response=await request('/api/store?key='+encodeURIComponent(key),write?{method:'POST',body:JSON.stringify(value??null)}:{});return response.json();},
 async model(url,options){return request('/api/model',{method:'POST',body:JSON.stringify({url,key:options.headers?.Authorization||options.headers?.authorization||'',body:options.body}),signal:options.signal});}
};
const selector=document.getElementById('threads'),notice=document.getElementById('notice');let cursor=null,loading=false;
async function list(reset=false){if(loading)return;loading=true;try{
 const page=await(await request('/api/threads'+(!reset&&cursor?'?cursor='+encodeURIComponent(cursor):''))).json();
 if(reset)selector.replaceChildren(new Option('选择对话…',''));
 for(const t of page.data||[])if(![...selector.options].some(o=>o.value===t.id))selector.add(new Option((t.name||t.preview||t.cwd||t.id).slice(0,80),t.id));
 cursor=page.nextCursor;document.getElementById('more').disabled=!cursor;const current=new URL(location.href).searchParams.get('thread');if(current)selector.value=current;
 notice.textContent=page.source==='local-files'?'官方服务暂不可用，已从本地记录列出对话。':'只读取本机已保存的对话。';
}catch(e){notice.textContent=e.message;}finally{loading=false;}}
selector.onchange=()=>{const url=new URL(location.href);if(selector.value)url.searchParams.set('thread',selector.value);else url.searchParams.delete('thread');history.replaceState(null,'',url);window.dispatchEvent(new Event('canvas-thread-change'));};
document.getElementById('more').onclick=()=>list();document.getElementById('refresh').onclick=()=>list(true);list(true);
})();
