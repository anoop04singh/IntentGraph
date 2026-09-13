import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { Store } from '../src/store.js';
import type { Graph } from '../src/graph.js';
import type { Payments } from '../src/payments.js';
test('HTTP supports isolated MCP clients, public stats, origin rejection, and session termination', async () => {
  const store = new Store(':memory:');
  const graph: Graph = { tools: async () => [{ name: 'search_subgraphs_by_keyword', inputSchema: { type: 'object', properties: { keyword: { type: 'string' } } } }], call: async () => ({ content: [{ type: 'text', text: 'real fixture result' }] }), instructions: async () => 'verify activity', close: async () => {} };
  const payments: Payments = { requirements: async () => ({ scheme: 'exact', network: 'hedera:testnet', asset: '0.0.0', amount: '1000000', payTo: '0.0.123', maxTimeoutSeconds: 120, extra: { feePayer: '0.0.456' } }), redeem: async () => ({ success: true, transaction: 'fixture', network: 'hedera:testnet' }) };
  const cfg = { ...config, GATEWAY_API_KEY: 'operator-secret', HEDERA_SELLER_ACCOUNT_ID: '0.0.123', PUBLIC_URL: 'http://localhost', PORT: 80 };
  const runtime = createApp(cfg, graph, payments, store);
  const listener = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>(r=>listener.once('listening',r));
  const address = listener.address(); assert(address && typeof address === 'object');
  cfg.PORT = address.port;
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { host: 'localhost' };
  const transportA = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers } });
  const transportB = new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers } });
  const a = new Client({ name: 'a', version: '1' }); const b = new Client({ name: 'b', version: '1' });
  try {
    await a.connect(transportA); await b.connect(transportB);
    const q: any = await a.callTool({ name: 'unlock_data_access', arguments: {} });
    const quote = JSON.parse(q.content[0].text);
    await a.callTool({ name: 'unlock_data_access', arguments: { quote_id: quote.quote_id, payment_proof: 'test' } });
    assert.equal((await a.listTools()).tools.length, 2); assert.equal((await b.listTools()).tools.length, 1);
    await a.callTool({ name: 'search_subgraphs_by_keyword', arguments: { keyword: 'Uniswap' } });
    const response = await fetch(base + '/api/stats', { headers }); const stats = await response.json();
    assert.equal(stats.toolCalls, 1); assert.equal(stats.activeSessions, 1);
    assert(!JSON.stringify(stats).includes('operator-secret'));
    assert.equal((await fetch(base + '/mcp', { headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base + '/mcp', { headers: { ...headers, 'mcp-session-id': 'missing' } })).status, 404);
    await transportA.terminateSession();
    assert.equal((await (await fetch(base + '/api/stats', { headers })).json()).activeSessions, 0);
  } finally {
    await a.close(); await b.close(); await runtime.close();
    await new Promise<void>(r=>listener.close(()=>r())); store.close();
  }
});
