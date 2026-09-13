import { randomUUID } from 'node:crypto';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import { inspectHederaTransaction } from '@x402/hedera';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import type { Config } from './config.js';
import type { Store } from './store.js';

export interface Payments {
  requirements(): Promise<PaymentRequirements>;
  redeem(proof: string, quote: Quote, session: string): Promise<SettleResponse>;
}
export type Quote = {
  id: string; expiresAt: number; requirements: PaymentRequirements;
  consumed?: boolean; uncertain?: boolean;
};
export function newQuote(requirements: PaymentRequirements): Quote {
  return { id: randomUUID(), expiresAt: Date.now() + 120000, requirements };
}
export class PaymentError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export class HederaPayments implements Payments {
  private facilitator: Pick<HTTPFacilitatorClient, 'getSupported' | 'verify' | 'settle'>;
  private scheme = new ExactHederaScheme();
  constructor(private config: Config, private store: Store, facilitator?: Pick<HTTPFacilitatorClient, 'getSupported' | 'verify' | 'settle'>) {
    this.facilitator = facilitator ?? new HTTPFacilitatorClient({ url: config.FACILITATOR_URL, timeoutMs: 30000 });
  }
  async requirements(): Promise<PaymentRequirements> {
    if (!this.config.HEDERA_SELLER_ACCOUNT_ID) throw new PaymentError('not_configured', 'The operator must configure a receiving account.');
    const supported = await this.facilitator.getSupported();
    const kind = supported.kinds.find(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === 'hedera:testnet');
    if (!kind || typeof kind.extra?.feePayer !== 'string') throw new PaymentError('unavailable', 'The facilitator is not advertising Hedera testnet payments.');
    return this.scheme.enhancePaymentRequirements({
      scheme: 'exact', network: 'hedera:testnet', asset: '0.0.0',
      amount: this.config.PRICE_TINYBARS, payTo: this.config.HEDERA_SELLER_ACCOUNT_ID,
      maxTimeoutSeconds: 120, extra: {},
    }, kind, supported.extensions);
  }
  async redeem(proof: string, quote: Quote, session: string): Promise<SettleResponse> {
    let payload: PaymentPayload;
    let proofId: string;
    try {
      if (proof.length > 64000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(proof)) throw new Error();
      payload = JSON.parse(Buffer.from(proof, 'base64').toString('utf8'));
      const a = payload.accepted;
      const b = quote.requirements;
      if (payload.x402Version !== 2 || !a || ['scheme','network','asset','amount','payTo','maxTimeoutSeconds']
        .some(key => a[key as keyof typeof a] !== b[key as keyof typeof b]) || a.extra?.feePayer !== b.extra.feePayer) throw new Error();
      const transaction = payload.payload?.transaction;
      if (typeof transaction !== 'string') throw new Error();
      // Transaction ID, rather than JSON/base64 bytes, prevents re-encoding/re-signing replay.
      proofId = 'hedera:testnet:' + inspectHederaTransaction(transaction).transactionId;
      if (proofId.endsWith(':')) throw new Error();
    } catch { throw new PaymentError('payment_invalid', 'Malformed proof or payment requirements do not match this quote.'); }

    if (this.store.payment(proofId)) throw new PaymentError('payment_replayed', 'This transaction has already been submitted. Do not pay again if settlement is pending; contact the operator with your quote ID.');
    const verified = await this.facilitator.verify(payload, quote.requirements);
    if (!verified.isValid) throw new PaymentError('payment_invalid', 'The facilitator rejected the signed payment.');
    if (!this.store.claim(proofId, session, quote.id, quote.requirements.amount)) throw new PaymentError('payment_replayed', 'This transaction has already been submitted.');
    let result: SettleResponse;
    try { result = await this.facilitator.settle(payload, quote.requirements); }
    catch {
      this.store.fail(proofId, 'uncertain'); quote.uncertain = true;
      throw new PaymentError('settlement_uncertain', 'Settlement could not be confirmed. Do not pay again. Ask the operator to reconcile this quote ID.');
    }
    if (!result.success) {
      this.store.fail(proofId, 'failed');
      throw new PaymentError('settlement_failed', 'The facilitator did not settle the payment. Access remains locked.');
    }
    if (!result.transaction || result.network !== 'hedera:testnet') {
      this.store.fail(proofId, 'uncertain'); quote.uncertain = true;
      throw new PaymentError('settlement_uncertain', 'The settlement response needs operator reconciliation. Do not pay again.');
    }
    try { this.store.settle(proofId, result.transaction); }
    catch {
      quote.uncertain = true;
      throw new PaymentError('settlement_uncertain', 'Payment settled but its receipt could not be saved. Contact the operator with your quote ID.');
    }
    return result;
  }
}
