import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, PrivateKey, TransferTransaction, Hbar } from '@x402/hedera';
import { config } from '../src/config.js';
import { DemoWallet } from '../src/demo-wallet.js';

const wallet = new DemoWallet(config);
const address = wallet.generate();
console.log(`Shared testnet wallet: ${address}`);
let status = await wallet.status(true);
if (!status.funded && config.HEDERA_PAT && process.argv.includes('--fund')) {
  const response = await fetch('https://portal.hedera.com/api/disbursement/cli', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.HEDERA_PAT}` },
    body: JSON.stringify({ address, amount: 10, network: 'testnet' }), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Faucet returned HTTP ${response.status}. Use the web faucet or check your Portal PAT.`);
  const funded = await response.json() as { transactionId: string };
  console.log(`Faucet transaction: ${funded.transactionId}`);
  for (let i = 0; i < 10; i++) { await new Promise(r => setTimeout(r, 2000)); status = await wallet.status(true); if (status.funded) break; }
}
if (!status.funded) {
  console.log(`Fund this address at https://portal.hedera.com/faucet, then rerun npm run wallet:setup. Or set HEDERA_PAT and run npm run wallet:setup -- --fund.`);
  process.exit(0);
}
if (!status.ready && status.accountId && process.argv.includes('--activate')) {
  // Complete the hollow ECDSA account by using it as fee payer once. This only spends test HBAR.
  const saved = JSON.parse(readFileSync(join(config.DATA_DIR, 'demo-wallet.json'), 'utf8'));
  const client = Client.forTestnet().setOperator(status.accountId, PrivateKey.fromStringDer(saved.privateKey));
  try {
    const tx = await new TransferTransaction().addHbarTransfer(status.accountId, Hbar.fromTinybars(-1))
      .addHbarTransfer(config.HEDERA_SELLER_ACCOUNT_ID, Hbar.fromTinybars(1)).setMaxTransactionFee(new Hbar(1)).execute(client);
    const receipt = await tx.getReceipt(client);
    console.log(`Account activation: ${receipt.status.toString()} (${tx.transactionId.toString()})`);
  } finally { client.close(); }
}
console.log(JSON.stringify(await wallet.status(true), null, 2));
