// The WizardConnect request our app builds, checked by a stand-in wallet that signs from it alone and by the BCH VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MockNetworkProvider, randomUtxo } from 'cashscript';
import { secp256k1, hash160, decodeTransaction, encodeTransaction, hexToBin, binToHex, generateSigningSerializationBch, SigningSerializationFlag, encodeDataPush, sha256 } from '@bitauth/libauth';
import { MemoryChain } from '../desk/chains.js';
import { scanWallet, signBuilder, deriveAddress } from '../lib/wizard.js';
import { swapLock, lockBuilder, lockingBytecodeOf, sha256Hex } from '../lib/bch.js';
import { CATEGORY } from './helpers.js';

// Stand-in wallet: one key per (path, index), child 0 = receive, 1 = change. It knows nothing but what the sign request tells it.
const seed = randomBytes(32);
const keyAt = (path, index) => ({ privateKey: sha256.hash(Uint8Array.from([...seed, path === 'receive' ? 0 : 1, index])) });
const pm = {
  getPubkey: (child, index) => secp256k1.derivePublicKeyCompressed(keyAt(child === 0 ? 'receive' : 'change', Number(index)).privateKey),
  signTransaction: (request) => walletSigner(request),
};

const unrelay = (s) => {
  const o = { ...s };
  for (const k of ['outpointTransactionHash', 'unlockingBytecode', 'lockingBytecode']) o[k] = hexToBin(s[k]);
  o.valueSatoshis = BigInt(String(s.valueSatoshis).replace(/^<bigint: (\d+)n>$/, '$1'));
  if (s.token) o.token = { ...s.token, category: hexToBin(s.token.category), amount: BigInt(String(s.token.amount).replace(/^<bigint: (\d+)n>$/, '$1')) };
  return o;
};

/** What a wallet does with a sign request: sign each listed P2PKH input with the key at its path. */
async function walletSigner(request) {
  const tx = decodeTransaction(hexToBin(request.transaction.transaction));
  assert.ok(typeof tx !== 'string', 'transaction decodes');
  const sources = request.transaction.sourceOutputs.map(unrelay);
  assert.equal(sources.length, tx.inputs.length);
  const inputs = tx.inputs.map((i) => ({ ...i }));
  for (const [n, path, index] of request.inputPaths) {
    const node = keyAt(path, index);
    const pub = secp256k1.derivePublicKeyCompressed(node.privateKey);
    const covered = sources[n].lockingBytecode;
    assert.equal(binToHex(covered), '76a914' + binToHex(hash160(pub)) + '88ac', 'path ' + path + '/' + index + ' owns input ' + n);
    const sigSer = generateSigningSerializationBch({ transaction: tx, sourceOutputs: sources, inputIndex: n }, { coveredBytecode: covered, signingSerializationType: new Uint8Array([SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId]) });
    const sig = secp256k1.signMessageHashSchnorr(node.privateKey, sha256.hash(sha256.hash(sigSer)));
    const full = Uint8Array.from([...sig, SigningSerializationFlag.allOutputs | SigningSerializationFlag.forkId]);
    inputs[n].unlockingBytecode = Uint8Array.from([...encodeDataPush(full), ...encodeDataPush(pub)]);
  }
  return { signedTransaction: binToHex(encodeTransaction({ ...tx, inputs })) };
}

const PREFIX = 'bchtest';
const addrOf = (p, i) => deriveAddress(pm, p, i, PREFIX);

test('lock transaction from an HD wallet: coins spread over receive and change addresses are signed by the wallet and accepted by the VM', async () => {
  const chain = new MemoryChain();
  const a0 = addrOf('receive', 0), a3 = addrOf('receive', 3), c1 = addrOf('change', 1);
  chain.addUtxo(a0.address, { ...randomUtxo(), satoshis: 40_000n, token: undefined });
  chain.addUtxo(a3.address, { ...randomUtxo(), satoshis: 1000n, token: { category: CATEGORY, amount: 400n } });
  chain.addUtxo(c1.address, { ...randomUtxo(), satoshis: 1000n, token: { category: CATEGORY, amount: 300n } });
  const scan = await scanWallet(pm, chain, PREFIX);
  assert.equal(scan.inputs.length, 3);
  const deskLock = lockingBytecodeOf(addrOf('receive', 9).address);
  const contract = swapLock({ hashlock: sha256Hex(randomBytes(32).toString('hex')), recipientLock: deskLock, refundLock: lockingBytecodeOf(a0.address), refundTime: 1_900_000_000 }, chain);
  const builder = lockBuilder({ provider: chain, contract, category: CATEGORY, tokenAmount: 500n, inputs: scan.inputs, changeTo: scan.receive.tokenAddress });
  const signedHex = await signBuilder(pm, builder, scan.inputs, 'Lock 5.00 PUSD', undefined);
  const size = signedHex.length / 2;
  const tx = decodeTransaction(hexToBin(signedHex));
  const fee = tx.inputs.reduce((s, i, n) => s + BigInt(builder.inputs[n].satoshis), 0n) - tx.outputs.reduce((s, o) => s + o.valueSatoshis, 0n);
  assert.ok(Number(fee) / size >= 1.0, 'fee rate ' + Number(fee) / size + ' sat/B covers the real signed size');
  await chain.sendRawTransaction(signedHex); // VM validation with token data
  const locked = (await contract.getUtxos())[0];
  assert.equal(locked.token.amount, 500n);
  assert.equal((await chain.getUtxos(scan.receive.address)).reduce((s, u) => s + (u.token?.amount ?? 0n), 0n), 200n, 'token change returns to the wallet');
});

test('signing refuses an input the paired wallet does not own', async () => {
  const chain = new MemoryChain();
  const stranger = addrOf('receive', 5);
  const u = chain.addUtxo(stranger.address, { ...randomUtxo(), satoshis: 40_000n });
  const scan = await scanWallet(pm, chain, PREFIX);
  const alien = [{ ...scan.inputs[0], utxo: { ...scan.inputs[0].utxo, txid: '00'.repeat(32) } }];
  const contract = swapLock({ hashlock: sha256Hex('11'.repeat(32)), recipientLock: lockingBytecodeOf(stranger.address), refundLock: lockingBytecodeOf(stranger.address), refundTime: 1_900_000_000 }, chain);
  chain.addUtxo(stranger.address, { ...randomUtxo(), satoshis: 1000n, token: { category: CATEGORY, amount: 10n } });
  const scan2 = await scanWallet(pm, chain, PREFIX);
  const builder = lockBuilder({ provider: chain, contract, category: CATEGORY, tokenAmount: 10n, inputs: scan2.inputs, changeTo: scan2.receive.tokenAddress });
  await assert.rejects(signBuilder(pm, builder, [], 'x'), /not a coin of the connected wallet/);
});
