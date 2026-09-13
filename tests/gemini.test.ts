import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiModel } from '../src/gemini.js';
const content = { role: 'model', parts: [{ functionCall: { name: 'search', args: {} }, thoughtSignature: 'signature' }] };
function setup(status = 200) {
 let now=100000; let calls=0; const starts:number[]=[];
 const model=new GeminiModel('secret','gemini-3.5-flash-lite',{now:()=>now,wait:async(ms,signal)=>{signal.throwIfAborted();now+=ms;},fetch:(async()=>{calls++;starts.push(now);return new Response(JSON.stringify({candidates:[{content}]}),{status});}) as typeof fetch});
 return {model,starts,get calls(){return calls;}};
}
test('pacing keeps request starts below 15 per rolling minute and preserves metadata',async()=>{
 const f=setup();for(let i=0;i<16;i++)assert.deepEqual(await f.model.generate([],[],'',new AbortController().signal),content);
 assert.equal(f.starts[1]-f.starts[0],4500);
 assert.ok(f.starts.filter(t=>t<f.starts[0]+60000).length<=15);
});
test('quota errors are clear and do not trigger automatic retries',async()=>{
 const f=setup(429);await assert.rejects(f.model.generate([],[],'',new AbortController().signal),/Gemini quota reached/);assert.equal(f.calls,1);
});
test('cancelled calls do not send a Gemini request',async()=>{
 const f=setup();const ctrl=new AbortController();ctrl.abort();await assert.rejects(f.model.generate([],[],'',ctrl.signal));assert.equal(f.calls,0);
});
