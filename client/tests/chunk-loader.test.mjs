import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const compile = (s) => stripTypeScriptTypes(s, {mode:'transform'});
const url = (s) => 'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const cache = url(compile(await readFile(new URL('../src/world/ChunkCache.ts',import.meta.url),'utf8')));
const source = compile(await readFile(new URL('../src/world/ChunkLoader.ts',import.meta.url),'utf8')).replace('"./ChunkCache"',JSON.stringify(cache));
const { ChunkLoader } = await import(url(source));
const manifest={worldBytes:100,chunks:[{id:'a',residentBytes:6},{id:'b',residentBytes:4},{id:'c',residentBytes:5},{id:'unused',residentBytes:85}]};

test('reserves under 10%, evicts LRU and disposes resources',async()=>{
 const destroyed=[]; let l;
 l=new ChunkLoader(manifest,async x=>{assert.ok(l.usedBytes<=l.limitBytes);assert.ok(l.usedBytes>=x.residentBytes);return x.id},x=>destroyed.push(x));
 await l.setDesired(['a','b']); assert.equal(l.usedBytes,10);
 await l.setDesired(['c']); assert.ok(l.usedBytes<=10); assert.ok(destroyed.length); assert.deepEqual(l.activeIds,['c']);
 await l.dispose(); assert.equal(l.usedBytes,0);
});
test('oversized entries do not reach allocator',async()=>{
 let n=0;const l=new ChunkLoader(manifest,async()=>{n++;return {}},()=>{});
 await l.setDesired(['unused']);assert.equal(n,0);assert.equal(l.usedBytes,0);await l.dispose();
});
test('superseded in-flight work cannot become active',async()=>{
 let finish;const destroyed=[];const l=new ChunkLoader(manifest,x=>x.id==='a'?new Promise(r=>{finish=r}):Promise.resolve(x.id),x=>destroyed.push(x));
 const first=l.setDesired(['a']);await new Promise(r=>setImmediate(r));assert.equal(l.usedBytes,6);
 const second=l.setDesired(['b']);finish('a');await Promise.all([first,second]);
 assert.deepEqual(l.activeIds,['b']);assert.ok(l.usedBytes<=10);await l.dispose();assert.deepEqual(new Set(destroyed),new Set(['a','b']));
});
test('rejects incorrect total and unknown ids',async()=>{
 assert.throws(()=>new ChunkLoader({...manifest,worldBytes:101},async()=>0,()=>{}));
 const l=new ChunkLoader(manifest,async()=>0,()=>{});await assert.rejects(l.setDesired(['missing']));await l.dispose();
});

