// What a wallet user's browser (or a script standing in for one) does around a desk quote. Isomorphic.
import { binToHex } from '@bitauth/libauth';
import { swapLock } from './bch.js';
import { lockId } from './evm.js';
import { bchToBaseOut, baseToBchOut } from './amounts.js';
import { sha256Hex } from './bch.js';

export function randomSecret() {
  const secret = binToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return { secret, hashlock: sha256Hex(secret) };
}

export function deskApi(base) {
  const call = async (path, body) => {
    const r = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message ?? j.error ?? 'desk error ' + r.status), { status: r.status, body: j });
    return j;
  };
  return {
    status: () => call('/api/status'),
    quote: (b) => call('/api/swaps', b),
    swap: (id) => call('/api/swaps/' + id),
    reveal: (id, secret) => call('/api/swaps/' + id + '/reveal', { secret }),
    replays: () => call('/api/replays'),
    overflow: (p) => call('/api/overflow/quote?' + new URLSearchParams(p)),
    peg: () => call('/api/peg'),
  };
}

/** The BCH swap lock of a quote, derived from public terms only (never trusting the desk's own address string). */
export function bchContractFromQuote(q, status, provider) {
  const out = q.dir === 'bch2base';
  return swapLock({ hashlock: q.hashlock, recipientLock: out ? status.bch.deskLock : q.userBchLock, refundLock: out ? q.userBchLock : status.bch.deskLock, refundTime: q.bchRefundTime }, provider);
}

/** Problems with a quote that make it unsafe to lock funds against. Empty array means go. */
export function checkQuote(q, req, status, nowSec, provider) {
  const bad = [];
  if (q.hashlock !== req.hashlock) bad.push('hashlock differs from the one sent');
  if (q.sendUnits !== String(req.sendUnits)) bad.push('send amount differs');
  if (q.userBchLock !== req.userBchLock) bad.push('refund/recipient script differs from your wallet');
  if (q.userEvm.toLowerCase() !== req.userEvm.toLowerCase()) bad.push('Base address differs');
  const fee = BigInt(status.feeBps);
  const want = q.dir === 'bch2base' ? bchToBaseOut(q.sendUnits, fee) : baseToBchOut(q.sendUnits, fee);
  if (BigInt(q.recvUnits) !== want) bad.push('receive amount is not the advertised rate');
  if (q.dir === 'bch2base') {
    const minRefund = nowSec + status.windows.userBchWindow - 10 * 60;
    if (q.bchRefundTime < minRefund) bad.push('your refund time is too soon');
    if (bchContractFromQuote(q, status, provider).tokenAddress !== q.bchLockAddress) bad.push('lock address is not derived from the terms');
  } else {
    if (q.evmTimeout < nowSec + status.windows.userEvmWindow - 10 * 60) bad.push('your refund time is too soon');
    const id = lockId({ sender: q.userEvm, recipient: status.evm.deskAddress, hashlock: q.hashlock, timeout: q.evmTimeout, amount: q.sendUnits });
    if (id !== q.evmLockId) bad.push('Base lock id does not match the terms');
  }
  return bad;
}
