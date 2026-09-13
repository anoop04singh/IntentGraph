import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransferTransaction, TransactionId, Hbar, PrivateKey, AccountId } from '@x402/hedera';
import { Store } from '../src/store.js';
import { HederaPayments, newQuote } from '../src/payments.js';
import { config } from '../src/config.js';

const requirements = { scheme: 'exact', network: 'hedera:testnet' as const, amount: '1000000', asset: '0.0.0', payTo: '0.0.123', maxTimeoutSeconds: 120, extra: { feePayer: '0.0.456' } };
async function signedProof() {
  // Locally constructed test transaction. Never submitted to a real network.
  const tx = new TransferTransaction().setTransactionId(TransactionId.generate('0.0.456'))
    .setNodeAccountIds([AccountId.fromString('0.0.3')]).addHbarTransfer('0.0.789', Hbar.fromTinybars(-1000000))
    .addHbarTransfer('0.0.123', Hbar.fromTinybars(1000000)).freeze();
  await tx.sign(PrivateKey.generateED25519());
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: requirements, payload: { transaction: Buffer.from(tx.toBytes()).toString('base64') } })).toString('base64');
}
function facilitator(success = true) {
  let settlements = 0;
  return {
    get count() { return settlements; },
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'hedera:testnet' as const, extra: { feePayer: '0.0.456' } }], extensions: [], signers: {} }),
    verify: async () => ({ isValid: true, payer: '0.0.789' }),
    settle: async () => { settlements++; return { success, transaction: crypto.randomUUID(), network: 'hedera:testnet' as const }; },
  };
}
test('native HBAR quote uses live facilitator fee payer and tinybar units', async () => {
  const store = new Store(':memory:');
  try {
    const p = new HederaPayments({ ...config, HEDERA_SELLER_ACCOUNT_ID: '0.0.123' }, store, facilitator());
    const req = await p.requirements();
    assert.equal(req.amount, '1000000'); assert.equal(req.asset, '0.0.0'); assert.equal(req.extra.feePayer, '0.0.456');
  } finally { store.close(); }
});
test('settled receipts are durable; re-encoded proof cannot be redeemed in another session or process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intentgraph-test-'));
  let store = new Store(dir);
  try {
    const f = facilitator();
    const p = new HederaPayments(config, store, f);
    const proof = await signedProof();
    await p.redeem(proof, newQuote(requirements), 'session-a');
    assert.equal(store.stats().paymentsSettled, 1); assert.equal(store.stats().volumeTinybars, '1000000');
    const reencoded = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(proof, 'base64').toString()), null, 2)).toString('base64');
    await assert.rejects(p.redeem(reencoded, newQuote(requirements), 'session-b'), /already been submitted/);
    assert.equal(f.count, 1);
    store.close(); store = new Store(dir);
    await assert.rejects(new HederaPayments(config, store, f).redeem(proof, newQuote(requirements), 'session-c'), /already been submitted/);
    assert.equal(store.stats().paymentsSettled, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('invalid, failed, malformed, and wrong-amount proofs never count as settlement', async () => {
  const store = new Store(':memory:');
  try {
    const f = facilitator(false); const p = new HederaPayments(config, store, f);
    await assert.rejects(p.redeem('not-base64', newQuote(requirements), 'a'), /Malformed/);
    const proof = await signedProof();
    await assert.rejects(p.redeem(proof, newQuote({ ...requirements, amount: '2000000' }), 'a'), /Malformed/);
    assert.equal(f.count, 0);
    await assert.rejects(p.redeem(proof, newQuote(requirements), 'a'), /did not settle/);
    assert.equal(store.stats().paymentsSettled, 0);
    const invalid = { ...facilitator(), verify: async () => ({ isValid: false, invalidReason: 'bad_signature' }) };
    await assert.rejects(new HederaPayments(config, store, invalid).redeem(await signedProof(), newQuote(requirements), 'b'), /rejected/);
    assert.equal(store.stats().paymentsSettled, 0);
  } finally { store.close(); }
});
test('uncertain settlement stays locked and cannot be automatically retried', async () => {
  const store = new Store(':memory:');
  try {
    const p = new HederaPayments(config, store, { ...facilitator(), settle: async () => { throw new Error('Timeout'); } });
    const quote = newQuote(requirements); const proof = await signedProof();
    await assert.rejects(p.redeem(proof, quote, 'a'), /Do not pay again/);
    assert.equal(quote.uncertain, true); assert.equal(store.stats().paymentsSettled, 0);
    await assert.rejects(p.redeem(proof, newQuote(requirements), 'b'), /already been submitted/);
  } finally { store.close(); }
});
test('concurrent redemption of one transaction only settles once', async () => {
  const store = new Store(':memory:');
  try {
    const f = facilitator(); const p = new HederaPayments(config, store, f); const proof = await signedProof();
    const results = await Promise.allSettled([p.redeem(proof, newQuote(requirements), 'a'), p.redeem(proof, newQuote(requirements), 'b')]);
    assert.equal(results.filter(r=>r.status === 'fulfilled').length, 1); assert.equal(f.count, 1);
  } finally { store.close(); }
});
