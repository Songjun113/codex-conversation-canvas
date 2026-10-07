import {resolveCodex} from './server.mjs';
import {AppServer} from './app-server.mjs';
import {History} from './history.mjs';
import os from 'node:os';import path from 'node:path';
const resolved=resolveCodex(),rpc=new AppServer(resolved.command,resolved.args);
try{await rpc.start();const history=new History(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),rpc);const result=await history.read(process.argv[2]);console.log(JSON.stringify({source:result.source,messages:result.messages.length,characters:result.messages.reduce((n,m)=>n+m.text.length,0),segments:result.segments,records:result.records,tailPending:result.tailPending}));}finally{rpc.close();}
