import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseMessage} from '../model.mjs';
import {readNativeHistory} from '../native-history.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function parseSavedMessage(record,fallbackId){
  const payload=record.payload;
  if(record.type==='response_item'&&payload?.type==='function_call'&&/^(?:functions\.)?request_user_input(?:_async)?$/.test(payload.name||'')){
    try{const args=JSON.parse(payload.arguments);const text=(args.questions||[]).map(q=>[q.question||q.title||'',...(q.options||[]).map(o=>'- '+(typeof o==='string'?o:o.label||''))].join('\n')).filter(Boolean).join('\n');
      return text?{id:payload.call_id||fallbackId,text,role:'assistant',phase:'final_answer',turnId:payload.internal_chat_message_metadata_passthrough?.turn_id||null}:null;
    }catch{throw Error('澄清问题记录损坏');}
  }
  if(payload?.type==='message'&&Array.isArray(payload.content)){
    record={...record,payload:{...payload,content:payload.content.filter(c=>!/^<\/?image(?:\s[^>]*)?>$/.test((c.text||'').trim()))}};
  }
  const message=parseMessage(record,fallbackId);
  if(message&&/^<(?:codex_internal_context|external_codex_apps_open_page)(?:\s|>)/.test(message.text))return null;
  return message;
}
export class History {
  constructor(home,rpc){this.home=home;this.rpc=rpc;this.cache=new Map();this.fallback=new Set();this.turnCache=new Map();}
  async files(){
    const files=[];
    const walk=async dir=>{let entries;try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(e.isFile()&&e.name.endsWith('.jsonl'))files.push(p);}};
    await walk(path.join(this.home,'sessions'));await walk(path.join(this.home,'archived_sessions'));return files;
  }
  async meta(file){
    const handle=await fs.promises.open(file,'r');try{const buffer=Buffer.alloc(1024*1024);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);const end=buffer.subarray(0,bytesRead).indexOf(10);if(end<0)throw Error('会话元数据行过长或未完成');const r=JSON.parse(buffer.subarray(0,end).toString('utf8'));if(r.type!=='session_meta'||!uuid.test(r.payload?.id))throw Error('会话元数据无效');return r.payload;}finally{await handle.close();}
  }
  async list(cursor=null){
    try{return await this.rpc.call('thread/list',{limit:50,cursor,sourceKinds:[],modelProviders:[],sortKey:'updated_at'});}
    catch{
      if(cursor)throw Error('列表读取中断，请刷新列表后重试');
      const byId=new Map();
      for(const file of await this.files()){try{const meta=await this.meta(file),stat=await fs.promises.stat(file);const item={id:meta.id,name:meta.cwd?path.basename(meta.cwd):meta.id,cwd:meta.cwd,updatedAt:stat.mtimeMs/1000};if(!byId.has(item.id)||item.updatedAt>byId.get(item.id).updatedAt)byId.set(item.id,item);}catch{}}
      return {data:[...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt),nextCursor:null,source:'local-files'};
    }
  }
  async read(id){
    if(!uuid.test(id))throw Error('任务 ID 无效');
    if(!this.fallback.has(id)){
      try{
        const messages=await readNativeHistory((method,params)=>this.rpc.call(method,params),id,this.turnCache);
        return this.result(id,messages,'app-server');
      }catch{this.fallback.add(id);}
    }
    return this.local(id);
  }
  result(id,messages,source,extra={}){
    const occurrences=new Map();
    messages=messages.map(message=>{const key=message.role+'\0'+message.text,occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);return {...message,id:'source-'+createHash('sha256').update(key+'\0'+occurrence).digest('hex')};});
    return {status:'ok',kind:'canvas-messages',session_id:id,messages,content:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),source,...extra};
  }
  async local(id){
    const all=await this.files(),candidates=[];
    for(const file of all.filter(p=>path.basename(p).includes(id))){const meta=await this.meta(file);if(meta.id===id)candidates.push({file,meta,stat:await fs.promises.stat(file)});}
    if(!candidates.length)throw Error('未找到本机保存的会话；远程或云端任务需要在其所在主机提供读取服务');
    candidates.sort((a,b)=>(a.meta.history_base?.end_ordinal_exclusive??-1)-(b.meta.history_base?.end_ordinal_exclusive??-1)||a.stat.mtimeMs-b.stat.mtimeMs);
    const latest=candidates.at(-1),signature=candidates.map(c=>c.file+':'+c.stat.size+':'+c.stat.mtimeMs).join('|');
    if(this.cache.get(id)?.signature===signature)return this.cache.get(id).result;
    const messages=[],seen=new Set(),visited=new Set();let count=0,tailPending=false,previousOrdinal;
    const consume=async (segment,limit)=>{
      if(visited.has(segment.file))throw Error('会话片段存在循环，未提交不完整历史');visited.add(segment.file);
      const base=segment.meta.history_base;
      if(base){
        if(!uuid.test(base.thread_id)||!Number.isSafeInteger(base.end_byte_offset)||base.end_byte_offset<0||!Number.isSafeInteger(base.end_ordinal_exclusive)||base.end_ordinal_exclusive<0)throw Error('历史片段索引无效');
        let parents=base.thread_id===id?candidates:await Promise.all(all.filter(p=>path.basename(p).includes(base.thread_id)).map(async file=>({file,meta:await this.meta(file),stat:await fs.promises.stat(file)})));
        parents=parents.filter(p=>p.file!==segment.file&&p.meta.id===base.thread_id&&p.stat.size>=base.end_byte_offset&&(p.meta.history_base?.end_ordinal_exclusive??-1)<base.end_ordinal_exclusive);
        if(parents.length!==1)throw Error('无法唯一确认历史片段，未提交不完整对话');
        await consume(parents[0],base.end_byte_offset);
        if(previousOrdinal!==undefined&&previousOrdinal+1!==base.end_ordinal_exclusive)throw Error('历史片段编号不连续');
      }
      const bytes=limit??segment.stat.size;let pending=Buffer.alloc(0),lineNo=0;
      if(bytes>0)for await(const chunk of fs.createReadStream(segment.file,{start:0,end:bytes-1})){
        pending=Buffer.concat([pending,chunk]);let pos;
        while((pos=pending.indexOf(10))>=0){
          const line=pending.subarray(0,pos).toString('utf8');pending=pending.subarray(pos+1);lineNo++;if(!line.trim())continue;
          let r;try{r=JSON.parse(line);}catch{throw Error('会话包含损坏记录，未提交不完整历史');}

          if(r.ordinal!==undefined){
            if(!Number.isSafeInteger(r.ordinal)||(previousOrdinal!==undefined&&r.ordinal!==previousOrdinal+1))throw Error('会话记录编号缺失或重复');
            previousOrdinal=r.ordinal;
          }
          if(r.type==='session_meta')continue;
          const m=parseSavedMessage(r,`message-${segment.meta.id}-${r.ordinal??path.basename(segment.file)+':'+lineNo}`);
          if(m&&!seen.has(m.id)){seen.add(m.id);messages.push(m);}count++;
        }
      }
      if(pending.length){if(limit!==undefined)throw Error('历史片段边界不是完整记录');tailPending=true;}
    };
    await consume(latest);
    const result=this.result(id,messages,'local-files',{records:count,segments:visited.size,tailPending});
    this.cache.set(id,{signature,result});while(this.cache.size>5)this.cache.delete(this.cache.keys().next().value);return result;
  }
}
