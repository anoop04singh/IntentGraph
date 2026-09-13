import { config } from './config.js';
import { Store } from './store.js';
import { SubgraphProxy } from './graph.js';
import { HederaPayments } from './payments.js';
import { createApp } from './app.js';
const store = new Store(config.DATA_DIR);
const runtime = createApp(config, new SubgraphProxy(config.SUBGRAPH_MCP_URL, config.GATEWAY_API_KEY), new HederaPayments(config, store), store);
const http = runtime.app.listen(config.PORT, config.HOST, () => console.error(`IntentGraph listening on ${config.PUBLIC_URL}`));
http.on('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use. Choose another PORT and PUBLIC_URL.` : 'HTTP server could not start.');
  void runtime.close().finally(() => { store.close(); process.exitCode = 1; });
});
let closing = false;
async function close() {
  if (closing) return; closing = true;
  http.close(); await runtime.close(); store.close();
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
