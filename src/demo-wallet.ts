import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrivateKey, createClientHederaSigner } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import type { PaymentRequirements } from '@x402/core/types';
import type { Config } from './config.js';

type WalletFile = { privateKey: string; evmAddress: string; createdAt: string };
export type WalletStatus = { address: string; accountId: string | null; balanceTinybars: string; funded: boolean; ready: boolean; message: string; explorerUrl: string; faucetUrl: string };
export class DemoWallet {
  private wallet?: WalletFile;
  private cached?: { at: number; value: WalletStatus };
  constructor(private config: Config) {}
  generate() {
    if (this.wallet) return this.wallet.evmAddress;
    mkdirSync(this.config.DATA_DIR, { recursive: true });
    const file = join(this.config.DATA_DIR, 'demo-wallet.json');
    if (existsSync(file)) this.wallet = JSON.parse(readFileSync(file, 'utf8'));
    else {
      const key = PrivateKey.generateECDSA();
      this.wallet = { privateKey: key.toStringDer(), evmAddress: '0x' + key.publicKey.toEvmAddress().replace(/^0x/, ''), createdAt: new Date().toISOString() };
      writeFileSync(file, JSON.stringify(this.wallet), { flag: 'wx', mode: 0o600 });
    }
    return this.wallet!.evmAddress;
  }
  async status(force = false): Promise<WalletStatus> {
    const address = this.generate();
    if (!force && this.cached && Date.now() - this.cached.at < 15000) return this.cached.value;
    const base = { address, accountId: null, balanceTinybars: '0', funded: false, ready: false,
      explorerUrl: `https://hashscan.io/testnet/account/${address}`, faucetUrl: 'https://portal.hedera.com/faucet' };
    const response = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${address}`, { signal: AbortSignal.timeout(10000) });
    if (response.status === 404) {
      const value = { ...base, message: 'The shared wallet needs its first testnet faucet funding.' }; this.cached = { at: Date.now(), value }; return value;
    }
    if (!response.ok) throw new Error('Wallet balance is temporarily unavailable.');
    const data = await response.json() as { account: string; deleted: boolean; key: unknown; balance: { balance: number } };
    const balance = BigInt(data.balance.balance);
    const ready = !data.deleted && Boolean(data.key) && balance >= BigInt(this.config.PRICE_TINYBARS);
    const value = { ...base, accountId: data.account, balanceTinybars: balance.toString(), funded: balance > 0n, ready,
      message: ready ? 'Shared testnet wallet is ready.' : !data.key ? 'Faucet funded. Run wallet:setup to activate the account.' : 'The shared wallet needs more testnet HBAR.' };
    this.cached = { at: Date.now(), value }; return value;
  }
  async sign(requirements: PaymentRequirements) {
    if (requirements.scheme !== 'exact' || requirements.network !== 'hedera:testnet' || requirements.asset !== '0.0.0' ||
      requirements.payTo !== this.config.HEDERA_SELLER_ACCOUNT_ID || requirements.amount !== this.config.PRICE_TINYBARS || requirements.maxTimeoutSeconds > 120) throw new Error('The demo wallet rejected unexpected payment requirements.');
    const status = await this.status(true);
    if (!status.ready || !status.accountId) throw new Error(status.message);
    const signer = createClientHederaSigner(status.accountId, PrivateKey.fromStringDer(this.wallet!.privateKey), { network: 'hedera:testnet' });
    const signed = await new ExactHederaScheme(signer).createPaymentPayload(2, requirements);
    return Buffer.from(JSON.stringify({ x402Version: 2, accepted: requirements, payload: signed.payload })).toString('base64');
  }
}
