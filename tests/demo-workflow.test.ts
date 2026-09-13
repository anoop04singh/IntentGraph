import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoWorkflow } from '../src/demo-workflow.js';
const names=['unlock_data_access','search_subgraphs_by_keyword','get_deployment_30day_query_counts','get_schema_by_subgraph_id','execute_query_by_subgraph_id'];
const tools=names.map(name=>({name,inputSchema:{type:'object' as const}}));
const result=(value:unknown,isError=false)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],isError});
function advance(w:DemoWorkflow,name:string,args:Record<string,unknown>,value:unknown,isError=false){assert.equal(w.validate(name,args,tools),'');w.record(name,args,result(value,isError));}
function schemaReady(){const w=new DemoWorkflow();advance(w,names[0],{},{status:'unlocked'});advance(w,names[1],{keyword:'Uniswap V3 Ethereum'},{returned:2});advance(w,names[2],{ipfs_hashes:['hash']},{deployments:[{total_query_count:0}]});advance(w,names[3],{subgraph_id:'selected'},'type LiquidityPool { id: ID! }');return w;}
test('trace regression: a successful pool query forces answer, never renewed discovery',()=>{
 const w=schemaReady();advance(w,names[4],{subgraph_id:'selected',query:'{ liquidityPools { id } }'},{data:{liquidityPools:[{id:'pool',totalValueLockedUSD:'94517131347'}]}});
 assert.equal(w.stage,'answer');assert.deepEqual(w.available(tools),[]);assert.equal(w.querySucceeded,true);
 assert.match(w.validate(names[1],{keyword:'uniswap-v3'},tools),/unavailable/);
});
test('a query cannot use a different deployment without its schema',()=>{
 const w=schemaReady();assert.match(w.validate(names[4],{subgraph_id:'different',query:'{}'},tools),/same identifier/);
 assert.equal(w.stage,'query');
});
test('GraphQL errors allow one corrected query; identical errors are not dispatched again',()=>{
 const w=schemaReady();const args={subgraph_id:'selected',query:'{ badField }'};
 advance(w,names[4],args,{errors:[{message:'Unknown field'}]});assert.equal(w.querySucceeded,false);assert.equal(w.stage,'query');
 assert.match(w.validate(names[4],{query:'{ badField }',subgraph_id:'selected'},tools),/identical/);
 advance(w,names[4],{subgraph_id:'selected',query:'{ corrected }'},{errors:[{message:'Still unavailable'}]});assert.equal(w.stage,'answer');
});
test('empty successful data ends tool calls rather than looping',()=>{
 const w=schemaReady();advance(w,names[4],{subgraph_id:'selected',query:'{ pools { id } }'},{data:{pools:[]}});assert.equal(w.stage,'answer');
});
