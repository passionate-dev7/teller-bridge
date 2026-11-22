// WizardConnect glue: wallet addresses from the paired HD wallet, its coins, and signing a lock transaction.
// Plain functions over a DappConnectionManager so they run (and are tested) without React.
import { hash160, encodeCashAddress, CashAddressType, binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth';
import { placeholderP2PKHUnlocker } from 'cashscript';
import { sourceOutputToRelay } from '@wizardconnect/core/hdwalletv1-serialize';

const CHILD = { receive: 0, change: 1 };
/** addresses scanned per path; a wallet that has used more than this many receive addresses needs a larger window */
export const SCAN_WINDOW = 25;

export function deriveAddress(manager, path, index, prefix) {
  const pubkey = manager.getPubkey(CHILD[path], BigInt(index));
  if (!pubkey) return undefined;
  const payload = hash160(pubkey);
  const enc = (type) => encodeCashAddress({ prefix, type, payload }).address;
  return { path, index, address: enc(CashAddressType.p2pkh), tokenAddress: enc(CashAddressType.p2pkhWithTokens) };
}

/** Every coin on the first SCAN_WINDOW addresses of both paths, as lock-builder inputs with the wallet path to sign with. */
export async function scanWallet(manager, provider, prefix) {
  const addrs = [];
  for (const path of ['receive', 'change']) for (let i = 0; i < SCAN_WINDOW; i++) { const a = deriveAddress(manager, path, i, prefix); if (a) addrs.push(a); }
  const lists = await Promise.all(addrs.map((a) => provider.getUtxos(a.address)));
  const inputs = [];
  addrs.forEach((a, i) => lists[i].forEach((utxo) => inputs.push({ utxo, unlocker: placeholderP2PKHUnlocker(a.address), path: a.path, index: a.index })));
  return { addresses: addrs, inputs, receive: addrs.find((a) => a.path === 'receive' && a.index === 0), change: addrs.find((a) => a.path === 'change' && a.index === 0) };
}

/**
 * Ask the wallet to sign every input of `builder` (all of them are wallet coins) and return the signed hex.
 * `inputs` is the scan result list, used to look up the signing path of each spent coin.
 */
export async function signBuilder(manager, builder, inputs, userPrompt, signal) {
  const meta = new Map(inputs.map((i) => [i.utxo.txid + ':' + i.utxo.vout, i]));
  const unsignedHex = builder.build();
  const wc = builder.generateWcTransactionObject({ broadcast: false, userPrompt });
  const sourceOutputs = wc.sourceOutputs.map((so) => sourceOutputToRelay(so));
  const decoded = decodeTransaction(hexToBin(unsignedHex));
  if (typeof decoded === 'string') throw new Error('unsigned transaction unreadable: ' + decoded);
  const inputPaths = decoded.inputs.map((inp, n) => {
    const m = meta.get(binToHex(inp.outpointTransactionHash) + ':' + inp.outpointIndex);
    if (!m) throw new Error('input ' + n + ' is not a coin of the connected wallet');
    return [n, m.path, m.index];
  });
  const res = await manager.signTransaction({ transaction: { transaction: unsignedHex, sourceOutputs, broadcast: false, userPrompt }, inputPaths }, signal ? { signal } : undefined);
  if (res.error) throw new Error(res.error);
  return res.signedTransaction;
}
