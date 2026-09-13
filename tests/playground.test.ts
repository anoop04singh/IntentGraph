import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playground, publicValue, type DemoMcp, type DemoEvent } from '../src/playground.js';
import { config } from '../src/config.js';
import { Store } from '../src/store.js';
import type { ModelContent } from '../src/gemini.js';
const cfg = { ...config, GEMINI_API_KEY: 'gemini-secret', GATEWAY_API_KEY: 'graph-secret', HEDERA_SELLER_ACCOUNT_ID: '0.0.123', DEMO_ENABLED: true, DEMO_DAILY_RUN_LIMIT: 2 };
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const tool = (name: string) => ({ name, inputSchema: { type: 'object' as const } });
const quote = { status: 'payment_required', quote_id: 'quote', expires_at: new Date(Date.now()+60000).toISOString(), accepts: [{ amount: '1000000' }] };

test('playground pays once, refreshes actual tools, returns query data and keeps proof out of model and public trace', async () => {
 const store = new Store(':memory:'); let paid = false; let closed = false; let signatures = 0; let step = 0;
 const mcp: DemoMcp = { list: async () => paid ? [tool('unlock_data_access'), tool('search_subgraphs_by_keyword'), tool('get_deployment_30day_query_counts'), tool('get_schema_by_subgraph_id'), tool('execute_query_by_subgraph_id')] : [tool('unlock_data_access')], instructions: async () => 'Schema first', close: async () => { closed = true; }, call: async (name,args) => { if(name !== 'unlock_data_access') return json({ data: { swaps: [{ id: 'real-fixture' }] } }); if(args.payment_proof) { assert.equal(args.payment_proof,'signed-secret'); paid=true; return json({status:'unlocked',settlement:{transaction:'tx'}}); } return json(quote); } };
 const model = { generate: async (history: ModelContent[]) => { assert.ok(!JSON.stringify(history).includes('signed-secret')); return [{role:'model',parts:[{functionCall:{name:'unlock_data_access',args:{}}}]},{role:'model',parts:[{functionCall:{name:'search_subgraphs_by_keyword',args:{keyword:'Uniswap'}}}]},{role:'model',parts:[{functionCall:{name:'get_deployment_30day_query_counts',args:{ipfs_hashes:['hash']}}}]},{role:'model',parts:[{functionCall:{name:'get_schema_by_subgraph_id',args:{subgraph_id:'selected'}}}]},{role:'model',parts:[{functionCall:{name:'execute_query_by_subgraph_id',args:{subgraph_id:'selected',query:'{ swaps { id } }'}}}]},{role:'model',parts:[{thought:true,text:'private reasoning'},{text:'Query result received.'}]}][step++] as ModelContent; } };
 const pg = new Playground(cfg,store,async()=>mcp,{status:async()=>({ready:true,funded:true,message:'ready',address:'0x123',accountId:'0.0.123',balanceTinybars:'10000000',explorerUrl:'https://hashscan.io',faucetUrl:'https://portal.hedera.com/faucet'}),sign:async()=>{signatures++;return 'signed-secret';}},model);
 const events: DemoEvent[]=[];
 await pg.run('Show swaps on Ethereum',e=>events.push(e),new AbortController().signal);
 assert.equal(signatures,1); assert.equal(closed,true); assert.equal(events.find(e=>e.type==='done')?.querySucceeded,true);
 assert.match(String(events.find(e=>e.type==='answer')?.text),/^Query result received\./);
 assert.match(String(events.find(e=>e.type==='answer')?.text),/Source note:/);
 assert.ok(!JSON.stringify(events).includes('signed-secret')); assert.ok(!JSON.stringify(events).includes('private reasoning'));
 assert.equal(store.demoRunsToday(),1); store.close();
});
test('failed settlement is not retried and does not announce unlock', async()=>{
 const store=new Store(':memory:');let signatures=0;
 const pg=new Playground(cfg,store,async()=>({list:async()=>[tool('unlock_data_access')],instructions:async()=>'',close:async()=>{},call:async(_n,args)=>json(args.payment_proof?{status:'payment_invalid',message:'Rejected'}:quote)}),{status:async()=>({ready:true,funded:true,message:'ready',address:'0x123',accountId:'0.0.123',balanceTinybars:'10000000',explorerUrl:'https://hashscan.io',faucetUrl:'https://portal.hedera.com/faucet'}),sign:async()=>{signatures++;return 'proof';}},{generate:async()=>({role:'model',parts:[{functionCall:{name:'unlock_data_access',args:{}}}]})});
 const events:DemoEvent[]=[];await pg.run('Show swaps',e=>events.push(e),new AbortController().signal);
 assert.equal(signatures,1);assert.equal(events.some(e=>e.type==='payment_settled'),false);assert.equal(events.find(e=>e.type==='done')?.status,'failed');store.close();
});
test('persistent daily quota and recursive event redaction',()=>{
 const store=new Store(':memory:');assert.equal(store.reserveDemoRun('one',1),true);assert.equal(store.reserveDemoRun('two',1),false);store.finishDemoRun('one','failed');assert.equal(store.reserveDemoRun('three',1),false);store.close();
 assert.deepEqual(publicValue({nested:{payment_proof:'p',privateKey:'k'},message:'key secret'},['secret']),{nested:{payment_proof:'[REDACTED]',privateKey:'[REDACTED]'},message:'key [REDACTED]'});
});



