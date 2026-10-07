import fs from 'node:fs';
const root=new URL('../',import.meta.url),read=file=>fs.readFileSync(new URL(file,root),'utf8'),portable=file=>read(file).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const model=['dialogue-material.mjs','model.mjs','tree-markup.mjs','bridge-data.mjs','organize.mjs','tree-review.mjs','parallel-briefs.mjs','global-arranger.mjs','long-organizer.mjs','view-pages.mjs','src/canvas-store.js'].map(portable).join('\n');
const api=portable('external-api.mjs')+'\nasync function nativeApiRequest(url,options){return readApiResponse(await window.canvasStandalone.model(url,options),options.signal,options.onProgress);}';
const output=read('src/canvas-panel.js').replace('/* canvas-model */',()=>model).replace('/* canvas-api */',()=>api).replace('/* canvas-interaction */',()=>portable('tree-canvas.mjs')+'\n'+read('src/tree-canvas-view.js')).replace('/* canvas-style */',()=>read('src/tree-canvas.css')).replace('/* canvas-annotations */','const annotationIndex={};');
fs.writeFileSync(new URL('public/canvas.standalone.js',root),output.replace(/^[ \t]+$/gm,''));
console.log('Built standalone canvas without private runtime imports');


const header=output.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/)[0];
const desktop=header+'\n'+read('standalone/desktop-host.js')+'\n'+output.replace(header,'');
fs.writeFileSync(new URL('public/canvas.desktop.user.js',root),desktop.replace(/^[ \\t]+$/gm,''));
