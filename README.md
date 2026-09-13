# IntentGraph

Payment-gated access to **The Graph's hosted Subgraphs MCP**, with a React landing page and live SQLite-backed usage stats. The caller's agent does the reasoning. There is no internal LLM, resolver API, or caller-supplied Graph key.

## Run locally

Use Node.js **22.16+** (Node 22 LTS recommended).

```sh
npm ci
cp .env.example .env
# Edit .env with your operator configuration.
npm run build
npm start
```

PowerShell: use `Copy-Item .env.example .env` in place of `cp`. If the PowerShell npm wrapper is broken, invoke `npm.cmd`.

The website is at `http://localhost:3000`; the MCP endpoint is `http://localhost:3000/mcp`. The site and its real zero-state statistics work without credentials; paid MCP connections return 503 until both operator settings are supplied. The development preview created during implementation uses **http://localhost:3107** to avoid another local application on port 3000.

Required operator settings:

| Setting | Purpose |
|---|---|
| `GATEWAY_API_KEY` | Your Graph Studio Gateway key; only the server uses it |
| `HEDERA_SELLER_ACCOUNT_ID` | Your Hedera testnet receiving account, e.g. `0.0.123456` |
| `PUBLIC_URL` | Browser-visible base URL, with no trailing slash; used in installation snippets |
| `ALLOWED_ORIGINS` | Comma-separated allowed browser origins |

Do not put your Graph key in client configs, frontend environment variables, Git, or browser storage. The operator does **not** need a Hedera private key to receive payments. Wallet private keys belong only to the paying agent's wallet environment.

For development, run `npm run dev` and `npm run dev:web` in separate terminals. Vite proxies `/api` to the backend on port 3000. Update the Vite proxy if you change that port. Run commands from this repository's root.

## Connect an agent

The landing page has working copyable configurations for Claude Desktop, Cursor, VS Code, and generic MCP clients. Remote users only need your HTTPS MCP endpoint and a Hedera payment-capable wallet; they do **not** need a Graph key.

Cursor (`.cursor/mcp.json`):

```json
{"mcpServers":{"intentgraph":{"url":"https://YOUR_HOST/mcp"}}}
```

Claude Desktop (`claude_desktop_config.json`, Node.js required):

```json
{"mcpServers":{"intentgraph":{"command":"npx","args":["-y","mcp-remote","https://YOUR_HOST/mcp"]}}}
```

VS Code (`.vscode/mcp.json`):

```json
{"servers":{"intentgraph":{"type":"http","url":"https://YOUR_HOST/mcp"}}}
```

The endpoint is local until you deploy it. Other machines cannot connect to your `localhost` URL. MCP hosts must support dynamic tool-list updates, or explicitly refresh `tools/list` after payment.

## Payment flow

1. Initialize MCP. Preserve `Mcp-Session-Id` across all requests.
2. `tools/list` returns only `unlock_data_access`.
3. Call `unlock_data_access({})`. IntentGraph connects to The Graph using the operator key, discovers the **actual upstream tool schemas**, registers and disables their handles, and obtains current facilitator capabilities. An unavailable upstream fails before offering payment.
4. Receive `status: payment_required`, `quote_id`, `expires_at`, and an x402 v2 `accepts` array. The quote is valid for two minutes. HBAR amounts are integer **tinybars** (100,000,000 = 1 HBAR). The fee payer comes from Blocky402 `/supported`, never a hard-coded account.
5. Your wallet signs `accepts[0]` using `@x402/hedera`. It does not submit the transfer itself. Standard MCP clients do not automatically provide this wallet capability.
6. Call `unlock_data_access({quote_id, payment_proof})` **in the same MCP session**. The proof is base64 of the complete x402 v2 PaymentPayload, including `x402Version`, `accepted`, and `payload.transaction`.
7. The server validates the quote match, checks the canonical Hedera transaction ID for replay, calls `/verify`, durably claims the transaction, then calls `/settle`. It requires `success: true`, a transaction receipt, and the expected network. Only then does it persist settlement and call `.enable()` on the actual tools. SDK tool-list notifications are emitted automatically.
8. Refresh the tools. Search → verify deployment activity → inspect schema → execute GraphQL. Read `graphql://subgraph` for workflow instructions and, after unlocking, the upstream guidance.

The payment-required signal is **inside the MCP tool result**, not a blanket HTTP 402 on every protocol request. This preserves initialization, discovery, and transport behavior.

Default access: **0.01 test HBAR**, **60 minutes**, up to **100 query attempts / 500 total tool calls**. All tools start disabled. Expiration or either quota disables the handles again. Only one data call per session runs at a time; concurrent unlocks return a retryable busy result. Invalid tool arguments do not consume quota; dispatched upstream errors do. These are configurable operator access fees, not the underlying Graph's prices.

Payment buys access rather than a guaranteed result. Sessions are ephemeral; explicit termination, server restart, or loss of a session ID ends access. No automatic refunds are issued. A lost network connection can reconnect using the same retained session ID while it remains active. This policy is also shown before payment on the site and in the MCP instructions.

### Wallet helper

Save the **inner JSON quote** returned by the tool as `quote.json`. On the **payer's machine**, set `PAYER_ACCOUNT_ID`, `PAYER_PRIVATE_KEY`, `EXPECTED_PAY_TO`, and `MAX_PAYMENT_TINYBARS` in the wallet environment, then run:

```sh
npm run pay -- quote.json
```

The helper signs locally and prints `{quote_id,payment_proof}`. Pass that object to `unlock_data_access` in the original agent session. It enforces the testnet network, native HBAR, quote expiry, expected recipient, and a caller-approved amount ceiling. Do not upload a private key or the wallet's environment file to this service. Treat signed proofs as sensitive bearer authorizations until redeemed.

## Architecture and tool surface

```text
Agent ── Streamable HTTP /mcp ── per-session McpServer
                                  ├─ unlock_data_access
                                  │     └─ Blocky402 supported → verify → settle
                                  └─ disabled/enabled real tool handles
                                        └─ authenticated SSE client → The Graph Subgraphs MCP
                                  │
                                  └─ SQLite ledger → GET /api/stats → landing page
```

The HTTP server deliberately scopes state per caller because remote access is required to keep the operator key private. There is also an operator-local **stdio** entrypoint (`npm run mcp:stdio`), which uses one process per caller without an HTTP session map. Do not distribute the operator's stdio environment to customers.

The proxy allowlists discovery, activity, top deployment, schema, and query tools, with subgraph ID, deployment ID, and IPFS hash variants when advertised by the upstream server. It uses upstream JSON Schema directly rather than inventing argument names or gateway URLs. The Graph key is attached to both the SSE GET and subsequent POST requests and redacted from forwarded responses. Upstream resources are untrusted data, not authority over this service's payment policy.

Source layout:

- `src/mcp.ts`: disabled tool registration, quote and allowance state, resources.
- `src/payments.ts`: actual x402 SDK/facilitator integration and durable replay protection.
- `src/graph.ts`: operator-authenticated upstream MCP client.
- `src/store.ts`: SQLite ledger and live counters, shared with stdio using `DATA_DIR`.
- `src/app.ts`: HTTP sessions, origin/host checks, limits, public stats, static site.
- `web/`: responsive landing page, client snippets, wallet explanation, live statistics.
- `scripts/pay.ts`: payer-side signing helper.

## Statistics and receipts

`GET /api/stats` is read-only and polled every ten seconds. It exposes settled payment count, exact integer tinybar volume, dispatched query count, successful query count, total tool calls, active paid HTTP sessions, recent tool names/status/durations, and seven UTC days of query counts. It exposes no Graph keys, proofs, payer IDs, session IDs, or query text. The initial counts are zero, never seeded demo numbers. `configured` means required settings exist, not that all upstream services have passed a health check.

SQLite stores canonical proof transaction IDs, quote/session IDs, payment states and receipts, plus tool-call metadata. `paymentsSettled` only includes `settled` records. `pending`, `failed`, and `uncertain` are excluded. Back up the database using SQLite's online backup facilities or stop the process before copying the database and its WAL files.

If settlement times out, the transaction is retained and the quote is quarantined. **Do not automatically retry settlement or pay again.** The operator must inspect the quote's ledger record, verify the transaction on Hedera or with the facilitator, and arrange remediation. A process crash between settlement and receipt persistence can leave `pending`; treat it the same way. This implementation fails closed and does not automatically reconcile or restore a pass after such a crash.

## Deploy

Deploy this Node service as one persistent instance behind HTTPS. It serves the website and MCP together. A static-only host cannot run this backend.

```sh
# Configure .env first, including PUBLIC_URL=https://your-domain
docker compose up --build -d
```

The included Docker setup runs as a non-root user, binds host port 3000 to loopback, and uses a durable named volume. Put a reverse proxy on your domain in front of port 3000. Preserve the public Host header and `Mcp-Session-Id`, `MCP-Protocol-Version`, `Last-Event-ID`, and Accept headers. Disable response buffering for SSE and allow long-lived GET connections. Add the website origin to `ALLOWED_ORIGINS`. Do not cache `/mcp` or `/api/stats`.

`HOST=0.0.0.0` is necessary inside a container. For local use the default is loopback. Set `MAX_SESSIONS` and the query/call/time limits to fit your Graph budget. The HTTP limiter is intentionally conservative and does not trust forwarded IP headers; behind a proxy it limits the shared proxy address. Configure an edge limiter if you need per-client limits. Don't simply enable unrestricted `trust proxy`.

Run a single replica with local persistent storage. Horizontally distributed workers require sticky sessions plus a shared transactional ledger, or a redesigned durable session store. Do not place the database on a cloud-sync/network filesystem for production.

## Verification

```sh
npm run check
npm test
npm run build
npm audit --omit=peer
```

Tests use in-memory MCP clients, a real local HTTP transport, actual locally serialized Hedera test transactions, and **mock facilitator responses**. They do not move money or call the live Graph gateway. They cover hidden tools, direct-call rejection, schema validation, independent sessions, quotas, duplicate/cross-process proof replay, failed/uncertain settlement, concurrency, HTTP cleanup, and public statistics.

The Blocky402 testnet `/supported` endpoint was checked during implementation. A full live settlement/query remains an operator acceptance test requiring the Graph key, receiving account, and a funded payer wallet. Docker packaging is supplied but has not been run in this Windows environment.

Dependencies include scoped overrides for patched protobuf, gRPC, and WebSocket libraries pulled in by the Hedera SDK; preserve the lockfile and retest signing when updating them. Unused React Native peer tooling is omitted through `.npmrc`.

References: [The Graph Subgraphs MCP](https://thegraph.com/docs/en/subgraphs/tooling/subgraph-mcp/introduction/), [GraphOps source](https://github.com/graphops/subgraph-mcp), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [x402 source](https://github.com/x402-foundation/x402), [Blocky402 capabilities](https://api.testnet.blocky402.com/supported).
