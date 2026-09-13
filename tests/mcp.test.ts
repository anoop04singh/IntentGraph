import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildSession } from '../src/mcp.js';
import { Store } from '../src/store.js';
import { config } from '../src/config.js';
import { PaymentError, type Payments } from '../src/payments.js';
import type { Graph } from '../src/graph.js';
const requirements = { scheme: 'exact', network: 'hedera:testnet' as const, amount: '1000000', asset: '0.0.0', payTo: '0.0.123', maxTimeoutSeconds: 120, extra: { feePayer: '0.0.456' } };
const graph: Graph = {
  tools: async (): Promise<Tool[]> => [{ name: 'execute_query_by_subgraph_id', description: 'Execute GraphQL', inputSchema: { type: 'object', properties: { subgraph_id: { type: 'string' }, query: { type: 'string' } }, required: ['subgraph_id', 'query'], additionalProperties: false } }, { name: 'search_subgraphs_by_keyword', inputSchema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] } }],
  call: async (_name, args) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }),
  instructions: async () => 'Always verify deployment activity.', close: async () => {},
};
const payments: Payments = { requirements: async () => requirements, redeem: async proof => { if (proof !== 'valid') throw new PaymentError('payment_invalid', 'Rejected'); return { success: true, transaction: 'test-transaction', network: 'hedera:testnet' }; } };
const parse = (r: any) => JSON.parse(r.content[0].text);
async function setup(options = {}) {
  const store = new Store(':memory:');
  const session = buildSession(crypto.randomUUID(), { ...config, ...options }, graph, payments, store);
  const client = new Client({ name: 'test-agent', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await session.server.connect(a); await client.connect(b);
  return { client, session, store, close: async () => { await client.close(); await session.dispose(); store.close(); } };
}
test('real tools are hidden and direct calls rejected before payment; settled unlock is isolated', async () => {
  const a = await setup(); const b = await setup();
  try {
    assert.deepEqual((await a.client.listTools()).tools.map(t=>t.name), ['unlock_data_access']);
    const quote = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: {} }));
    assert.equal(quote.status, 'payment_required');
    assert.deepEqual((await a.client.listTools()).tools.map(t=>t.name), ['unlock_data_access']);
    const denied = await a.client.callTool({ name: 'execute_query_by_subgraph_id', arguments: { subgraph_id: 'id', query: '{}' } });
    assert.equal(denied.isError, true);
    const invalid = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'bad' } }));
    assert.equal(invalid.status, 'payment_invalid');
    assert.equal((await a.client.listTools()).tools.length, 1);
    const unlocked = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'valid' } }));
    assert.equal(unlocked.status, 'unlocked');
    assert.equal((await a.client.listTools()).tools.length, 3);
    assert.equal((await b.client.listTools()).tools.length, 1);
    const tools = (await a.client.listTools()).tools;
    assert.deepEqual(tools.find(t=>t.name === 'execute_query_by_subgraph_id')?.inputSchema.required, ['subgraph_id', 'query']);
  } finally { await a.close(); await b.close(); }
});
test('query limit re-locks handles; replay cannot refill allowance; counters reflect real calls', async () => {
  const a = await setup({ QUERY_LIMIT: 1 });
  try {
    const quote = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: {} }));
    await a.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'valid' } });
    assert.equal((await a.client.callTool({ name: 'execute_query_by_subgraph_id', arguments: { subgraph_id: 'id', query: '{ swaps { id } }' } })).isError, undefined);
    assert.equal((await a.client.listTools()).tools.length, 1);
    assert.equal(a.store.stats().queriesMade, 1);
    assert.equal(a.store.stats().queriesSucceeded, 1);
    const replay = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'valid' } }));
    assert.equal(replay.status, 'quote_invalid');
  } finally { await a.close(); }
});
test('wrong-session quote is rejected and missing schema parameters do not call upstream', async () => {
  const a = await setup(); const b = await setup();
  try {
    const quote = parse(await a.client.callTool({ name: 'unlock_data_access', arguments: {} }));
    await b.client.callTool({ name: 'unlock_data_access', arguments: {} });
    const result = parse(await b.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'valid' } }));
    assert.equal(result.status, 'quote_invalid');
    await a.client.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'valid' } });
    assert.equal((await a.client.callTool({ name: 'execute_query_by_subgraph_id', arguments: {} })).isError, true);
    assert.equal(a.store.stats().toolCalls, 0);
  } finally { await a.close(); await b.close(); }
});

test('short packages bind quote expiry, access duration and query limits', async () => {
 const a=await setup();
 try {
  const start=Date.now();
  const q=parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'quick'}}));
  assert.equal(q.package.id,'quick');assert.equal(q.access.seconds,300);assert.equal(q.access.queries,5);
  assert.ok(Date.parse(q.expires_at)-start<=61000);
  const again=parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'quick'}}));assert.equal(again.quote_id,q.quote_id);
  const unlocked=parse(await a.client.callTool({name:'unlock_data_access',arguments:{quote_id:q.quote_id,payment_proof:'valid'}}));
  assert.equal(unlocked.package.id,'quick');assert.ok(Date.parse(unlocked.expires_at)-Date.now()<=300000);
  for(let i=0;i<5;i++)await a.client.callTool({name:'execute_query_by_subgraph_id',arguments:{subgraph_id:'id',query:'{}'}});
  assert.equal((await a.client.listTools()).tools.length,1);
 }finally{await a.close();}
});
test('changing an unpaid package invalidates its old quote; paid access cannot be upgraded for free',async()=>{
 const a=await setup();try{
  const q=parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'quick'}}));
  const next=parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'explore'}}));
  assert.notEqual(q.quote_id,next.quote_id);
  assert.equal(parse(await a.client.callTool({name:'unlock_data_access',arguments:{quote_id:q.quote_id,payment_proof:'valid'}})).status,'quote_invalid');
  assert.equal(parse(await a.client.callTool({name:'unlock_data_access',arguments:{quote_id:next.quote_id,payment_proof:'valid',package_id:'standard'}})).status,'quote_invalid');
  await a.client.callTool({name:'unlock_data_access',arguments:{quote_id:next.quote_id,payment_proof:'valid'}});
  assert.equal(parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'standard'}})).package.id,'explore');
 }finally{await a.close();}
});
test('expired short quote cannot settle or enable data tools',async(t)=>{
 const a=await setup();try{
  const q=parse(await a.client.callTool({name:'unlock_data_access',arguments:{package_id:'quick'}}));
  const now=Date.parse(q.expires_at)+1;t.mock.method(Date,'now',()=>now);
  assert.equal(parse(await a.client.callTool({name:'unlock_data_access',arguments:{quote_id:q.quote_id,payment_proof:'valid'}})).status,'quote_invalid');
  assert.equal((await a.client.listTools()).tools.length,1);
 }finally{t.mock.restoreAll();await a.close();}
});
