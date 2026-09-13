import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface Graph {
  tools(): Promise<Tool[]>;
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  instructions(): Promise<string>;
  close(): Promise<void>;
}
export const allowedTools = new Set([
  'search_subgraphs_by_keyword', 'get_deployment_30day_query_counts', 'get_top_subgraph_deployments',
  'get_schema_by_subgraph_id', 'get_schema_by_deployment_id', 'get_schema_by_ipfs_hash',
  'execute_query_by_subgraph_id', 'execute_query_by_deployment_id', 'execute_query_by_ipfs_hash',
]);

export class SubgraphProxy implements Graph {
  private client?: Client;
  private connecting?: Promise<Client>;
  constructor(private url: string, private key: string) {}
  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.key) throw new Error('Operator configuration required.');
    if (!this.connecting) this.connecting = (async () => {
      const headers = { Authorization: `Bearer ${this.key}` };
      const client = new Client({ name: 'intentgraph-upstream', version: '1.0.0' });
      const transport = new SSEClientTransport(new URL(this.url), {
        requestInit: { headers },
        // SSE GET needs authorization too; requestInit alone only covers POSTs.
        eventSourceInit: { fetch: (url, init) => {
          const requestHeaders = new Headers(init?.headers);
          requestHeaders.set('Authorization', `Bearer ${this.key}`);
          return fetch(url, { ...init, headers: requestHeaders });
        } },
      });
      client.onclose = () => { if (this.client === client) this.client = undefined; };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(transport, { timeout: 20000 }),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Connection timed out')), 20000); timeout.unref(); }),
        ]);
      }
      catch { await transport.close().catch(() => {}); throw new Error('The Graph connection is unavailable.'); }
      finally { clearTimeout(timeout); }
      this.client = client;
      return client;
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  async tools() {
    const client = await this.connect();
    const all: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools({ cursor });
      all.push(...result.tools.filter(t => allowedTools.has(t.name)));
      cursor = result.nextCursor;
    } while (cursor);
    if (!all.length) throw new Error('No supported Subgraph tools are available.');
    return all;
  }
  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!allowedTools.has(name)) throw new Error('Unsupported tool.');
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 45000 });
    // Strip any accidental credential echo from upstream responses, including URLs.
    return JSON.parse(JSON.stringify(result).split(this.key).join('[REDACTED]')) as CallToolResult;
  }
  async instructions() {
    const client = await this.connect();
    const result = await client.readResource({ uri: 'graphql://subgraph' });
    return result.contents.map(c => 'text' in c ? c.text : '').join('\n').split(this.key).join('[REDACTED]');
  }
  async close() { await this.client?.close(); }
}
