/** Wallet-side helper: signs a saved quote. It never submits a transaction itself. */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import type { PaymentRequirements } from '@x402/core/types';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run pay -- path/to/quote.json. Set PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY in YOUR wallet environment.');
const quote = JSON.parse(await readFile(file, 'utf8'));
const account = process.env.PAYER_ACCOUNT_ID;
const key = process.env.PAYER_PRIVATE_KEY;
if (!account || !key) throw new Error('PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY are required locally. Never share them with IntentGraph.');
const requirements: PaymentRequirements = quote.accepts?.[0];
if (quote.status !== 'payment_required' || quote.x402Version !== 2 || !quote.quote_id || !requirements || requirements.network !== 'hedera:testnet' || requirements.asset !== '0.0.0') throw new Error('Expected an IntentGraph x402 v2 HBAR testnet quote.');
if (!Number.isFinite(Date.parse(quote.expires_at)) || Date.now() >= Date.parse(quote.expires_at)) throw new Error('Quote expired or expiry is invalid. Request a fresh quote.');
if (!/^[1-9]\d*$/.test(requirements.amount)) throw new Error('Quote amount must be positive integer tinybars.');
// Explicit amount ceiling prevents a malicious/replaced quote from asking for more.
const max = process.env.MAX_PAYMENT_TINYBARS;
if (!max || !/^[1-9]\d*$/.test(max) || BigInt(requirements.amount) > BigInt(max)) throw new Error('Set MAX_PAYMENT_TINYBARS to the maximum amount you authorize for this quote.');
if (process.env.EXPECTED_PAY_TO !== requirements.payTo) throw new Error('Set EXPECTED_PAY_TO to the operator receiving account you intend to pay.');
console.error(`Signing ${requirements.amount} tinybars to ${requirements.payTo} on Hedera testnet.`);
const signer = createClientHederaSigner(account, PrivateKey.fromString(key), { network: 'hedera:testnet' });
const signed = await new ExactHederaScheme(signer).createPaymentPayload(2, requirements);
const payload = { x402Version: 2, accepted: requirements, payload: signed.payload, resource: quote.resource };
console.log(JSON.stringify({ quote_id: quote.quote_id, payment_proof: Buffer.from(JSON.stringify(payload)).toString('base64') }, null, 2));
