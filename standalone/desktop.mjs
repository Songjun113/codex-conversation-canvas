import {startServer} from './server.mjs';import {watchDesktop} from './desktop-bridge.mjs';
const server=await startServer({desktop:true}),watcher=watchDesktop({origin:server.origin,token:server.token,port:Number(process.env.CANVAS_DEBUG_PORT||9229),onStatus:console.log});
console.log('画布后台已启动；在 Codex 右上角点击分支图标。');
for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{await watcher.close();await server.close();process.exit();});
