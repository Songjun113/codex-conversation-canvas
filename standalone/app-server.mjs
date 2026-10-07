import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export class AppServer {
  constructor(command,args=[]){this.command=command;this.args=args;this.requests=new Map();this.seq=0;}
  async start(){
    this.child=spawn(this.command,[...this.args,'app-server'],{stdio:['pipe','pipe','ignore'],windowsHide:true});
    const fail=()=>{this.dead=true;for(const {reject,timer} of this.requests.values()){clearTimeout(timer);reject(Error('Codex 读取服务已断开，请重试'));}this.requests.clear();};
    this.child.on('error',fail);this.child.on('exit',fail);this.child.stdin.on('error',fail);
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}const pending=this.requests.get(m.id);if(!pending)return;this.requests.delete(m.id);clearTimeout(pending.timer);if(m.error)pending.reject(Object.assign(Error(m.error.message),{code:m.error.code}));else pending.resolve(m.result);});
    await this.call('initialize',{clientInfo:{name:'conversation_canvas',version:'0.4.0'},capabilities:{experimentalApi:true}});
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return this;
  }
  call(method,params){
    if(!['initialize','thread/list','thread/read','thread/turns/list','thread/items/list'].includes(method))throw Error('只允许读取对话');
    if(this.dead)return Promise.reject(Error('Codex 读取服务已断开'));
    return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.requests.delete(id);reject(Error('读取对话超时，请重试'));},60000);this.requests.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.requests.delete(id);reject(Error('读取服务写入失败'));}});});
  }
  close(){this.lines?.close();this.child?.stdin.end();this.child?.kill();}
}
