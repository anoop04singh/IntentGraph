import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';
import type { Graph } from './graph.js';
import type { Payments } from './payments.js';
import type { Store } from './store.js';
import { buildSession } from './mcp.js';
import { Playground } from './playground.js';
import { z } from 'zod';

export function createApp(config: Config, graph: Graph, payments: Payments, store: Store) {
  const app = express();
  const ready = Boolean(config.GATEWAY_API_KEY && config.HEDERA_SELLER_ACCOUNT_ID);
  const sessions = new Map<string, { session: ReturnType<typeof buildSession>; transport: StreamableHTTPServerTransport; touched: number }>();
  const allSessions = new Set<ReturnType<typeof buildSession>>();
  let shuttingDown = false;
  const playground = new Playground(config, store);
  const origins = new Set(config.ALLOWED_ORIGINS.split(',').map(s => s.trim()));
  const publicHost = new URL(config.PUBLIC_URL).host;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"], 'connect-src': ["'self'"], 'img-src': ["'self'", 'data:'] } } }));
  app.use((req, res, next) => {
    if (!new Set([publicHost, `localhost:${config.PORT}`, `127.0.0.1:${config.PORT}`]).has(req.headers.host ?? '')) return res.status(403).json({ error: 'Unrecognized host.' });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.vary('Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use('/mcp', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.get('/api/stats', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...store.stats(), activeSessions: [...sessions.values()].filter(s => s.session.active()).length,
      service: ready ? 'configured' : 'setup_required', network: 'hedera:testnet',
      priceTinybars: config.PRICE_TINYBARS, accessSeconds: config.ACCESS_SECONDS, queryLimit: config.QUERY_LIMIT, toolCallLimit: config.TOOL_CALL_LIMIT });
  });
  app.get('/api/config', (_req, res) => res.json({ mcpUrl: `${config.PUBLIC_URL}/mcp`, network: 'hedera:testnet', transport: 'streamable-http' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', paymentsConfigured: ready }));
  app.get('/api/playground/status', rateLimit({ windowMs: 60000, limit: 60 }), async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await playground.status()); } catch { res.status(503).json({ ready: false, message: 'Playground status unavailable.' }); }
  });
  app.post('/api/playground/run', rateLimit({ windowMs: 600000, limit: 6 }), async (req, res) => {
    if (shuttingDown) return res.status(503).json({ error: 'Server is shutting down.' });
    const parsed = z.object({ prompt: z.string().trim().min(8).max(1500) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter an on-chain data request between 8 and 1500 characters.' });
    const controller = new AbortController();
    res.status(200).set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.on('close', () => controller.abort());
    const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    const heartbeat = setInterval(() => emit({ type: 'heartbeat', at: new Date().toISOString() }), 15000);
    try { await playground.run(parsed.data.prompt, emit, controller.signal); }
    catch { emit({ type: 'error', at: new Date().toISOString(), message: 'The playground is busy or not configured. Check its status and try again.' }); emit({ type: 'done', at: new Date().toISOString(), status: 'failed' }); }
    finally { clearInterval(heartbeat); res.end(); }
  });
  app.all('/mcp', async (req, res) => {
    if (shuttingDown) return res.status(503).json({ error: 'Server is shutting down.' });
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).set('Allow', 'GET, POST, DELETE').end();
    const header = req.headers['mcp-session-id'];
    if (header && typeof header !== 'string') return res.status(400).json({ error: 'Invalid session ID.' });
    let entry = typeof header === 'string' ? sessions.get(header) : undefined;
    if (header && !entry) return res.status(404).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session expired. Initialize a new session.' } });
    if (!entry) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Initialize an MCP session first.' } });
      if (!ready) return res.status(503).json({ error: 'The operator must configure Graph access and the Hedera receiving account.' });
      if (sessions.size >= config.MAX_SESSIONS) return res.status(503).json({ error: 'Session capacity reached. Retry later.' });
      const id = randomUUID();
      const session = buildSession(id, config, graph, payments, store);
      allSessions.add(session);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => id });
      entry = { session, transport, touched: Date.now() };
      sessions.set(id, entry); // Reserve capacity before asynchronous work.
      try { await session.server.connect(transport); }
      catch { sessions.delete(id); await session.dispose(); allSessions.delete(session); return res.status(503).json({ error: 'Could not initialize session.' }); }
      const onclose = transport.onclose;
      transport.onclose = () => { onclose?.(); sessions.delete(id); void session.dispose().finally(() => allSessions.delete(session)); };
    }
    entry.touched = Date.now();
    try { await entry.transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP transport error.' }); }
  });
  app.use(express.static(resolve('web-dist')));
  app.get('/', (_req, res) => res.sendFile(resolve('web-dist/index.html')));
  app.get('/playground', (_req, res) => res.sendFile(resolve('web-dist/index.html')));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Request could not be processed.' });
  });
  const sweep = setInterval(() => {
    for (const [id, entry] of sessions) {
      if (!entry.session.working && !entry.session.active() && Date.now() - entry.touched > 600000) {
        sessions.delete(id); void entry.session.dispose();
      }
    }
  }, 60000); sweep.unref();
  return { app, close: async () => { shuttingDown = true; clearInterval(sweep); await playground.close(); await Promise.all([...allSessions].map(s => s.dispose())); await graph.close(); } };
}
