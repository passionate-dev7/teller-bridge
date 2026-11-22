// BCH side: SwapLock contract instances, lock / claim / refund transactions, chain clock.
// Isomorphic (node and browser). Chain access goes through a cashscript NetworkProvider.
import { Contract, TransactionBuilder, SignatureTemplate, placeholderP2PKHUnlocker, gatherBchUtxos, gatherFungibleTokenUtxos } from 'cashscript';
import { binToHex, hexToBin, sha256 as libauthSha256, cashAddressToLockingBytecode, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import artifact from '../contracts/bch/SwapLock.artifact.json' with { type: 'json' };

/** sats parked in a swap UTXO: pays the claim or refund miner fee, the rest rides along with the tokens */
export const LOCK_SATS = 3000n;
/** the covenant refuses a spend that burns more than this to fees */
export const MAX_FEE = 2000n;
/** lowest swap UTXO the desk accepts as funded: dust-safe output after the largest allowed fee */
export const MIN_LOCK_SATS = 2600n;
export const FEE_RATE = 1.2;

export const sha256Hex = (hex) => binToHex(libauthSha256.hash(hexToBin(hex)));

export function lockingBytecodeOf(address) {
  const r = cashAddressToLockingBytecode(address);
  if (typeof r === 'string') throw new Error('bad BCH address: ' + r);
  return binToHex(r.bytecode);
}

export function tokenAddressOf(lockingHex, prefix) {
  const r = lockingBytecodeToCashAddress({ bytecode: hexToBin(lockingHex), prefix, tokenSupport: true });
  if (typeof r === 'string') throw new Error(r);
  return r.address;
}

export const prefixOf = (network) => (network === 'mainnet' ? 'bitcoincash' : 'bchtest');

/** The SwapLock instance for one swap. All parameters are public and recomputed by both parties. */
export function swapLock({ hashlock, recipientLock, refundLock, refundTime }, provider) {
  return new Contract(artifact, [hashlock, recipientLock, refundLock, BigInt(refundTime), MAX_FEE], { provider });
}

/** Funded swap UTXOs at the lock address that carry at least the expected tokens and enough sats. */
export async function fundedLocks(contract, category, tokenAmount) {
  const utxos = await contract.getUtxos();
  return utxos.filter((u) => u.token && u.token.category === category && u.token.amount >= BigInt(tokenAmount) && u.satoshis >= MIN_LOCK_SATS);
}

const sigUnlocker = (keyHex) => new SignatureTemplate(hexToBin(keyHex)).unlockP2PKH();

/** Spendable coins of one P2PKH address paired with the unlocker that will sign them. signer: { keyHex } or { placeholder: true } (a wallet signs later). */
export async function addressInputs(provider, address, signer) {
  const unlocker = signer.placeholder ? placeholderP2PKHUnlocker(address) : sigUnlocker(signer.keyHex);
  return (await provider.getUtxos(address)).map((utxo) => ({ utxo, unlocker }));
}

/**
 * Builder paying `tokenAmount` of `category` from `inputs` ([{ utxo, unlocker }], possibly spread over many wallet
 * addresses) into the swap lock. Change (tokens and BCH) goes to `changeTo`, a token-aware address.
 */
export function lockBuilder({ provider, contract, category, tokenAmount, inputs, changeTo }) {
  const byOutpoint = new Map(inputs.map((i) => [i.utxo.txid + ':' + i.utxo.vout, i]));
  const utxos = inputs.map((i) => i.utxo);
  const tokens = gatherFungibleTokenUtxos(utxos, category, BigInt(tokenAmount));
  const bch = gatherBchUtxos(utxos, LOCK_SATS + 3000n);
  const chosen = [...tokens.utxos, ...bch.utxos].map((u) => byOutpoint.get(u.txid + ':' + u.vout));
  return new TransactionBuilder({ provider })
    .addInputs(chosen.map((c) => ({ ...c.utxo, unlocker: c.unlocker })))
    .addOutput({ to: contract.tokenAddress, amount: LOCK_SATS, token: { category, amount: BigInt(tokenAmount) } })
    .addTokenChangeOutputIfNeeded({ category, to: changeTo })
    .addBchChangeOutputIfNeeded({ to: changeTo, feeRate: FEE_RATE });
}

function spendBuilder({ provider, contract, utxo, unlocker, toLock, prefix }) {
  const build = (fee) => new TransactionBuilder({ provider })
    .addInput(utxo, unlocker)
    .addOutput({ to: tokenAddressOf(toLock, prefix), amount: utxo.satoshis - fee, token: utxo.token });
  const size = build(1000n).getTransactionSize();
  return { build, size };
}

/** claim: reveal the secret, pay the recipient. Anyone may broadcast. */
export function claimBuilder({ provider, contract, utxo, secretHex, recipientLock, prefix }) {
  const { build, size } = spendBuilder({ provider, contract, utxo, unlocker: contract.unlock.claim(hexToBin(secretHex)), toLock: recipientLock, prefix });
  return build(BigInt(Math.ceil(Number(size) * FEE_RATE)));
}

/** refund: after refundTime, pay the refund address. locktime = refundTime, sequence non-final so the locktime binds. */
export function refundBuilder({ provider, contract, utxo, refundLock, refundTime, prefix }) {
  const { build, size } = spendBuilder({ provider, contract, utxo, unlocker: contract.unlock.refund(), toLock: refundLock, prefix });
  return build(BigInt(Math.ceil(Number(size) * FEE_RATE))).setLocktime(Number(refundTime));
}

/** Median time past of the chain tip: the clock BCH uses to judge a time-based locktime. */
export async function medianTimePast(provider) {
  const tip = await provider.getBlockHeight();
  const r = await provider.performRequest('blockchain.block.headers', tip - 10, 11);
  const hex = r.hex;
  const times = [];
  for (let i = 0; i < 11; i++) {
    const h = hexToBin(hex.slice(i * 160, (i + 1) * 160));
    times.push(new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(68, true));
  }
  return times.sort((a, b) => a - b)[5];
}

/** Secret revealed by a claim of this swap lock, read from the spending tx's input script. */
export function secretFromClaimTx(txHex, secretHashHex) {
  const bin = hexToBin(txHex);
  // the 32-byte secret is pushed as 0x20 <32 bytes> in the claim unlocking script
  const hex = binToHex(bin);
  for (let i = 0; i + 66 <= hex.length; i += 2) {
    if (hex.slice(i, i + 2) === '20') {
      const cand = hex.slice(i + 2, i + 66);
      if (cand.length === 64 && sha256Hex(cand) === secretHashHex) return cand;
    }
  }
  return null;
}
