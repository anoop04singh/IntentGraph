import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Graph } from './graph.js';
import { newQuote, PaymentError, type Payments, type Quote } from './payments.js';
import type { Store } from './store.js';

export const workflow = `Call unlock_data_access without a proof to get an x402 v2 quote. Have your Hedera wallet sign its exact requirements, then call unlock_data_access with quote_id and base64 payment_proof in THIS MCP session. Never request or supply a Graph API key. After successful settlement, refresh tools/list if your host does not handle notifications/tools/list_changed. Search by protocol, verify candidate deployment activity with get_deployment_30day_query_counts, inspect the selected schema, then execute GraphQL. Clarify chain/version when ambiguous. Read graphql://subgraph for upstream instructions. The calling agent performs all reasoning; there is no internal LLM. Payment buys time-limited toolkit access with disclosed usage limits, not a guaranteed data result. Upstream errors consume an attempt; no automatic refunds. Do not retry payment after an uncertain settlement.`;
const reply = (value: Record<string, unknown>, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], isError });

export function buildSession(id: string, config: Config, graph: Graph, payments: Payments, store: Store) {
  const server = new McpServer({ name: 'intentgraph', version: '1.0.0' }, { instructions: workflow });
  const tools = new Map<string, RegisteredTool>();
  let quote: Quote | undefined;
  let expiresAt = 0;
  let calls = 0;
  let queries = 0;
  let busy = false;
  let inFlight = false;
  let disposed = false;
  let disposing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lock = () => { expiresAt = 0; tools.forEach(tool => tool.disable()); };
  const active = () => !disposed && expiresAt > Date.now() && calls < config.TOOL_CALL_LIMIT && queries < config.QUERY_LIMIT;

  async function registerRealTools() {
    if (tools.size) return;
    const discovered = await graph.tools();
    // Convert upstream JSON Schema directly. No guessed parameter names or Graph gateway routes.
    const schemas = discovered.map(tool => ({ tool, schema: z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]) }));
    for (const { tool, schema } of schemas) {
      const handle = server.registerTool(tool.name, {
        description: tool.description, inputSchema: schema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      }, async (args: unknown) => {
        if (!active()) { lock(); return reply({ status: 'locked', message: 'Call unlock_data_access for a new access pass.' }, true); }
        if (inFlight) return reply({ status: 'busy', message: 'Wait for your current Graph tool call to finish.' }, true);
        inFlight = true;
        calls++;
        if (tool.name.startsWith('execute_query_')) queries++;
        const start = performance.now();
        let success = false;
        try {
          const result = await graph.call(tool.name, args as Record<string, unknown>);
          success = !result.isError;
          return result;
        } catch {
          return reply({ status: 'upstream_error', message: 'The Graph could not complete this call. Your access remains available within its time and usage limits.' }, true);
        } finally {
          inFlight = false;
          store.recordCall(tool.name, success, performance.now() - start);
          if (!active()) lock();
        }
      });
      handle.disable();
      tools.set(tool.name, handle);
    }
  }
  server.registerTool('unlock_data_access', {
    description: 'Get a quote, then submit a signed x402 Hedera testnet payment to unlock The Graph tools. No Graph API key required. Keep the same MCP session.',
    inputSchema: {
      quote_id: z.string().uuid().optional(),
      payment_proof: z.string().min(1).max(64000).optional().describe('Base64-encoded x402 v2 PaymentPayload from your wallet. Never send a private key.'),
    },
  }, async ({ quote_id, payment_proof }) => {
    if (disposed) return reply({ status: 'session_closed', message: 'Initialize a new MCP session.' }, true);
    if (active()) return reply({ status: 'unlocked', expires_at: new Date(expiresAt).toISOString(), queries_remaining: config.QUERY_LIMIT - queries, calls_remaining: config.TOOL_CALL_LIMIT - calls, tools: [...tools.keys()] });
    if (busy) return reply({ status: 'busy', message: 'An unlock request is already running. Wait before retrying.' }, true);
    busy = true;
    try {
      if (quote?.uncertain) return reply({ status: 'settlement_uncertain', quote_id: quote.id, message: 'Do not pay again. Contact the operator for reconciliation.' }, true);
      if (!payment_proof) {
        await registerRealTools(); // Confirm upstream/schema availability before offering payment.
        if (!quote || quote.consumed || Date.now() >= quote.expiresAt) quote = newQuote(await payments.requirements());
        return reply({ status: 'payment_required', quote_id: quote.id, expires_at: new Date(quote.expiresAt).toISOString(),
          x402Version: 2, resource: { url: `${config.PUBLIC_URL}/mcp`, description: 'IntentGraph toolkit access', mimeType: 'application/json' },
          accepts: [quote.requirements], access: { seconds: config.ACCESS_SECONDS, queries: config.QUERY_LIMIT, tool_calls: config.TOOL_CALL_LIMIT },
          instructions: 'Sign accepts[0] with an x402 Hedera wallet, then submit quote_id and base64 payment_proof in this same MCP session.' });
      }
      if (!quote || quote.id !== quote_id || quote.consumed || Date.now() >= quote.expiresAt) return reply({ status: 'quote_invalid', message: 'Request a fresh quote in this session before signing.' }, true);
      const settlement = await payments.redeem(payment_proof, quote, id);
      quote.consumed = true;
      if (disposed) return reply({ status: 'session_closed', quote_id: quote.id, message: 'Payment settled after session closure. Contact the operator with the quote ID.' }, true);
      expiresAt = Date.now() + config.ACCESS_SECONDS * 1000; calls = 0; queries = 0;
      tools.forEach(tool => tool.enable());
      clearTimeout(timer);
      timer = setTimeout(lock, config.ACCESS_SECONDS * 1000); timer.unref();
      return reply({ status: 'unlocked', settlement, expires_at: new Date(expiresAt).toISOString(), tools: [...tools.keys()], instructions: workflow });
    } catch (error) {
      return reply({ status: error instanceof PaymentError ? error.code : 'service_unavailable', quote_id: quote?.id,
        message: error instanceof PaymentError ? error.message : 'The upstream service is unavailable or operator configuration is incomplete. No access was granted.' }, true);
    } finally { busy = false; }
  });
  server.registerResource('subgraph-instructions', 'graphql://subgraph', { description: 'Required Graph tool sequence', mimeType: 'text/plain' }, async uri => {
    let text = workflow;
    if (active()) { try { text += '\n\n' + await graph.instructions(); } catch { text += '\nUpstream instructions temporarily unavailable.'; } }
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] };
  });
  return { server, active, get working() { return busy || inFlight; }, dispose: () => {
    if (disposing) return disposing;
    disposed = true; clearTimeout(timer); lock();
    disposing = (async () => {
      // Keep the ledger alive until any in-progress payment/call has recorded its outcome.
      while (busy || inFlight) await new Promise(resolve => setTimeout(resolve, 25));
      await server.close();
    })();
    return disposing;
  } };
}
