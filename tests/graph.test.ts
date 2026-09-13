import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { SubgraphProxy } from '../src/graph.js';

test('upstream SSE GET and tool POSTs use the operator key, actual schemas are discovered, and echoes are redacted', async () => {
  const app = express(); app.use(express.json());
  const seen: string[] = [];
  app.use((req, res, next) => { res.on('finish', () => { if (res.statusCode >= 400) console.error('Upstream fixture HTTP error', req.method, req.path, res.statusCode); }); next(); });
  app.use((req, res, next) => { seen.push(req.headers.authorization ?? ''); if (req.headers.authorization !== 'Bearer operator-test-key') return res.sendStatus(401); next(); });
  const upstream = new McpServer({ name: 'fake-graph', version: '1' });
  upstream.registerTool('search_subgraphs_by_keyword', { inputSchema: { keyword: z.string() } }, async args => ({ content: [{ type: 'text', text: `${args.keyword}: operator-test-key` }] }));
  upstream.registerResource('guide', 'graphql://subgraph', {}, async uri => ({ contents: [{ uri: uri.href, text: 'Verify activity first.' }] }));
  let transport: SSEServerTransport;
  app.get('/sse', async (_req, res) => { transport = new SSEServerTransport('/messages', res); await upstream.connect(transport); });
  app.post('/messages', async (req, res) => { await transport.handlePostMessage(req, res, req.body); });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise<void>(r=>listener.once('listening',r));
  const address = listener.address(); assert(address && typeof address === 'object');
  const proxy = new SubgraphProxy(`http://127.0.0.1:${address.port}/sse`, 'operator-test-key');
  try {
    const tools = await proxy.tools(); assert.equal(tools[0].name, 'search_subgraphs_by_keyword'); assert.deepEqual(tools[0].inputSchema.required, ['keyword']);
    const result = await proxy.call('search_subgraphs_by_keyword', { keyword: 'Uniswap' });
    assert(JSON.stringify(result).includes('Uniswap')); assert(!JSON.stringify(result).includes('operator-test-key'));
    assert.equal(await proxy.instructions(), 'Verify activity first.');
    assert(seen.length >= 4); assert(seen.every(h=>h === 'Bearer operator-test-key'));
  } finally { await proxy.close(); await upstream.close(); await new Promise<void>(r=>listener.close(()=>r())); }
});
