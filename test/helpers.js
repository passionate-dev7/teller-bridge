import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MockNetworkProvider, TransactionBuilder, randomUtxo } from 'cashscript';
import { addressesOf } from '../lib/keys.js';
import { lockingBytecodeOf, swapLock, LOCK_SATS, sha256Hex } from '../lib/bch.js';

export const CATEGORY = randomBytes(32).toString('hex');
export const key = () => randomBytes(32).toString('hex');
export const wallet = () => { const k = key(); return { k, ...addressesOf(k) }; };
export const SOURCE = readFileSync(new URL('../contracts/bch/SwapLock.cash', import.meta.url), 'utf8').split('\n');
/** 1-based source line of the first line containing `needle` at or after `from` (guards are looked up by text, so a test names the exact require it targets) */
export const lineOf = (needle, from = 1) => SOURCE.findIndex((l, i) => i + 1 >= from && l.includes(needle)) + 1;
export const CLAIM_FN = lineOf('function claim');
export const REFUND_FN = lineOf('function refund');

export const REFUND_TIME = 1_800_000_000;
export const AMOUNT = 5000n;

/** A swap UTXO of AMOUNT tokens locked for `recipient` with refund to `refunder`. */
export function setup(secretHex = randomBytes(32).toString('hex'), hashlock = sha256Hex(secretHex)) {
  const provider = new MockNetworkProvider();
  const recipient = wallet();
  const refunder = wallet();
  const attacker = wallet();
  const contract = swapLock({ hashlock, recipientLock: lockingBytecodeOf(recipient.chipnet), refundLock: lockingBytecodeOf(refunder.chipnet), refundTime: REFUND_TIME }, provider);
  const utxo = provider.addUtxo(contract.address, { ...randomUtxo(), satoshis: LOCK_SATS, token: { category: CATEGORY, amount: AMOUNT } });
  return { provider, recipient, refunder, attacker, contract, utxo, secretHex };
}

export const tb = (provider, o = {}) => new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true, ...o });
