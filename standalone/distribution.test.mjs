import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
test('standalone bundle builds without private desktop loaders',()=>{
 execFileSync(process.execPath,['standalone/build.mjs'],{cwd:new URL('../',import.meta.url)});
 const script=fs.readFileSync(new URL('../public/canvas.standalone.js',import.meta.url),'utf8');
 assert.doesNotMatch(script,/app-(?:initial|shared)-[a-f0-9]+|async function nativeContext|import\s*\(/);
 assert.match(script,/canvasStandalone/);assert.match(script,/readApiResponse/);
});


test('desktop bundle contains no version-bound runtime or iframe transport',()=>{const script=fs.readFileSync(new URL('../public/canvas.desktop.user.js',import.meta.url),'utf8');assert.doesNotMatch(script,/app-(?:initial|shared)-[a-f0-9]+|import\s*\(|createElement\(['\"]iframe/);assert.match(script,/conversationCanvasBridge/);});
