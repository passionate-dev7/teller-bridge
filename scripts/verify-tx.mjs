// Reads chipnet or mainnet transactions back from Electrum and prints their outputs and confirmations.
// usage: node scripts/verify-tx.mjs [--mainnet] <txid>...
import { Network } from 'cashscript';
import { decodeTransaction, hexToBin, binToHex, lockingBytecodeToCashAddress } from '@bitauth/libauth';
import { ElectrumChain } from '../desk/chains.js';

const args = process.argv.slice(2);
const main = args.includes('--mainnet');
const chain = new ElectrumChain(main ? Network.MAINNET : Network.CHIPNET);
const prefix = main ? 'bitcoincash' : 'bchtest';
for (const txid of args.filter((a) => /^[0-9a-f]{64}$/.test(a))) {
  const raw = await chain.getRawTransaction(txid);
  const info = await chain.performRequest('blockchain.transaction.get', txid, true);
  const tx = decodeTransaction(hexToBin(raw));
  console.log(JSON.stringify({
    txid, confirmations: info.confirmations ?? 0, locktime: tx.locktime, bytes: raw.length / 2,
    outputs: tx.outputs.map((o) => ({ to: lockingBytecodeToCashAddress({ bytecode: o.lockingBytecode, prefix, tokenSupport: true }).address ?? binToHex(o.lockingBytecode), sats: String(o.valueSatoshis), tokens: o.token ? String(o.token.amount) : null })),
  }));
}
process.exit(0);
