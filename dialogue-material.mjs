// Filtering changes model input, never the original text or its character offsets.
export const materialVersion=1;
export function dialogueRanges(message){
 const text=message.text,excluded=[];
 const omit=(start,end)=>excluded.push([start,end]);
 for(const m of text.matchAll(/^# Files mentioned by the user:[\s\S]*?(?=^## My request:)/gm))omit(m.index,m.index+m[0].length);
 for(const m of text.matchAll(/<image\b[^>]*>[\s\S]*?<\/image>/g))omit(m.index,m.index+m[0].length);
 let fenceEnd=0;
 for(const m of text.matchAll(/^[ \t]*(`{3,}|~{3,})([^\r\n]*)\r?\n/gm)){
  if(m.index<fenceEnd||excluded.some(([a,b])=>m.index>=a&&m.index<b))continue;
  const start=m.index,bodyStart=start+m[0].length;
  const close=new RegExp('^[ \\t]*'+m[1][0]+'{'+m[1].length+',}[ \\t]*(?:\\r?\\n|$)','gm');close.lastIndex=bodyStart;
  const match=close.exec(text),bodyEnd=match?.index??text.length,end=match?bodyEnd+match[0].length:text.length;fenceEnd=end;
  const body=text.slice(bodyStart,bodyEnd),language=m[2].trim().toLowerCase();
  const implementation=/^(?:javascript|js|typescript|ts|tsx|jsx|python|py|json|jsonl|html|css|xml|yaml|yml|sql|diff|patch|c|cpp|java|rust|go|bash|sh|powershell|ps1)\b/.test(language);
  if(body.length>800||body.split('\n').length>12||message.role==='assistant'&&implementation){
   // Error lines remain useful evidence for failed attempts and changes of plan.
   let cursor=start;
   for(const line of body.matchAll(/^.*(?:\berror\b|\w*Error:|\bexception\b|\bfailed\b|\bfailure\b|traceback|错误|失败|超时).*$/gim)){
    const a=bodyStart+line.index,b=a+line[0].length;omit(cursor,a);cursor=b;
   }
   omit(cursor,end);
  }
 }
 // Bare deliverable links only; explanations of changes/results are retained.
 for(const m of text.matchAll(/^[ \t]*(?:[-*+]\s+|\d+\.\s+)?(?:\[[^\]\r\n]+\]\((?:<[^>\r\n]+>|[^)\r\n]+)\)|`(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/)[^`\r\n]+`)[ \t]*$/gm)){
  // Preserve external reference links; only local file entries are artifacts.
  if(/\]\((?:<?(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/))/.test(m[0])||m[0].includes('`'))omit(m.index,m.index+m[0].length);
 }
 excluded.sort((a,b)=>a[0]-b[0]);
 const ranges=[];let cursor=0;
 for(const [a,b]of excluded){if(a>cursor)ranges.push([cursor,a]);cursor=Math.max(cursor,b);}
 if(cursor<text.length)ranges.push([cursor,text.length]);
 return ranges.filter(([a,b])=>text.slice(a,b).trim());
}
export function dialogueExcerpt(message,start=0,end=message.text.length){
 return dialogueRanges(message).map(([a,b])=>{a=Math.max(a,start);b=Math.min(b,end);return b>a?message.text.slice(a,b):'';}).filter(Boolean).join('\n');
}
