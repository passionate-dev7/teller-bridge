// What a wallet user's browser (or a script standing in for one) does around a desk quote. Isomorphic.
import { binToHex } from '@bitauth/libauth';
import { swapLock } from './bch.js';
import { lockId, LOCK_STATE } from './evm.js';
import { bchToBaseOut, baseToBchOut } from './amounts.js';
import { sha256Hex, MIN_LOCK_SATS } from './bch.js';

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

/** the desk's lock must still have this long to run when the secret is released, seconds */
export const REVEAL_MARGIN = 20 * 60;

/**
 * May the browser hand the secret to the desk? Only when the chain itself shows the desk's side of the swap:
 * the right lock, for the right party and amount, on the pinned contract, with the timeouts in the safe order.
 * ctx: { status, reads: { evmLock(id), provider, confirmations(txid) }, pin, expect, now }. Returns { ok, why }.
 */
export async function readyToReveal(swap, ctx) {
  const { status, reads, pin, expect, now } = ctx;
  const no = (why) => ({ ok: false, why });
  if (swap.state !== 'desk_locked') return no('the desk has not reported its lock');
  for (const k of ['hashlock', 'userEvm', 'userBchLock', 'sendUnits']) if (String(swap[k]).toLowerCase() !== String(expect[k]).toLowerCase()) return no('swap terms changed: ' + k);
  const recv = BigInt(swap.recvUnits);
  if (swap.dir === 'bch2base') {
    if (!swap.evmLockId || !swap.evmTimeout) return no('no Base lock id');
    const l = await reads.evmLock(swap.evmLockId);
    if (l.state !== LOCK_STATE.Open) return no('no open lock on Base');
    if (l.sender.toLowerCase() !== pin.deskEvm.toLowerCase()) return no('lock was not made by the desk account');
    if (l.recipient.toLowerCase() !== swap.userEvm.toLowerCase()) return no('lock does not pay your address');
    if (BigInt(l.amount) !== recv) return no('lock holds a different amount');
    if (l.hashlock.toLowerCase() !== '0x' + swap.hashlock) return no('lock uses a different hashlock');
    if (lockId({ sender: l.sender, recipient: l.recipient, hashlock: swap.hashlock, timeout: l.timeout, amount: l.amount }) !== swap.evmLockId) return no('lock id does not match its terms');
    if (l.timeout - now < REVEAL_MARGIN) return no('lock is too close to expiry to claim in time');
    if (l.timeout > swap.bchRefundTime - status.windows.overlap) return no('lock outlives the margin before your BCH refund opens');
    return { ok: true };
  }
  if (!swap.bchRefundTime || !swap.evmTimeout) return no('no BCH refund time');
  if (swap.bchRefundTime > swap.evmTimeout - status.windows.evmOverlap) return no('BCH refund opens too close to your Base refund');
  if (swap.bchRefundTime - now < REVEAL_MARGIN) return no('BCH lock is too close to opening for refund');
  const utxos = await bchContractFromQuote(swap, status, reads.provider).getUtxos();
  const u = utxos.find((x) => x.token && x.token.category === swap.category && x.token.amount >= recv && x.satoshis >= MIN_LOCK_SATS);
  if (!u) return no('no BCH lock for the full amount at the address derived from the terms');
  if ((await reads.confirmations(u.txid)) < 1) return no('BCH lock is not confirmed yet');
  return { ok: true };
}
