// Requests chipnet sats (and optionally a freshly minted test token) from the public chipnet.bch.ninja faucet.
// usage: node scripts/chipnet-faucet.mjs <bchtest:z-address> <sats> [mintAmount]
import { createHash } from 'node:crypto';
const [address, sats, mintAmount] = process.argv.slice(2);
const base = 'https://chipnet.bch.ninja/api';
const post = async (p, body) => {
  const r = await fetch(base + '/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(p + ': ' + (j.error ?? r.status));
  return j;
};
const body = { address, sats: String(sats) };
if (mintAmount) body.mint = { amount: String(mintAmount), capability: null, commitment: '' };
const ch = await post('challenge', body);
const target = BigInt('0x' + ch.target);
let nonce = 0n;
while (BigInt('0x' + createHash('sha256').update(ch.payload + ':' + nonce).digest('hex')) > target) {
  nonce++;
  if (Date.now() > ch.expires) throw new Error('challenge expired');
}
const res = await post('claim', { payload: ch.payload, signature: ch.signature, nonce: nonce.toString() });
console.log(JSON.stringify(res));
