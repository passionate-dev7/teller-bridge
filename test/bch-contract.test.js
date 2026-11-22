// Covenant guards of SwapLock.cash. Every attack must fail at the exact require it targets (matched by source line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUtxo } from 'cashscript';
import { hexToBin, binToHex } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { CATEGORY, AMOUNT, REFUND_TIME, setup, tb, lineOf, CLAIM_FN, REFUND_FN, wallet } from './helpers.js';
import { claimBuilder, refundBuilder, LOCK_SATS, MAX_FEE, sha256Hex, lockingBytecodeOf, swapLock } from '../lib/bch.js';

const fnLine = { claim: CLAIM_FN, refund: REFUND_FN };
const unlock = (s, fn) => (fn === 'claim' ? s.contract.unlock.claim(hexToBin(s.secretHex)) : s.contract.unlock.refund());
const target = (s, fn) => (fn === 'claim' ? s.recipient : s.refunder);
const spend = (s, fn, outputs, { inputs = [s.utxo], locktime } = {}) => {
  const b = tb(s.provider);
  for (const u of inputs) b.addInput(u, unlock(s, fn));
  b.addOutputs(outputs);
  if (fn === 'refund' || locktime) b.setLocktime(locktime ?? REFUND_TIME);
  return b;
};
const good = (s, fn) => ({ to: target(s, fn).chipnetTokens, amount: LOCK_SATS - 800n, token: { category: CATEGORY, amount: AMOUNT } });
/** rejects with a VM failure located on the require whose text contains `needle`, searched inside function `fn` */
const failsAt = (promise, fn, needle) => assert.rejects(promise, (e) => {
  const want = lineOf(needle, fnLine[fn]);
  assert.ok(want > 0, 'guard text not found: ' + needle);
  assert.match(e.message, new RegExp('line ' + want + '\\b'), 'wrong guard failed: ' + e.message.slice(0, 300));
  return true;
});

for (const fn of ['claim', 'refund']) {
  test(fn + ': honest spend pays the whole token amount to the right party, no signature involved', async () => {
    const s = setup();
    const tx = await spend(s, fn, [good(s, fn)]).send();
    const got = await s.provider.getUtxos(target(s, fn).chipnet);
    assert.equal(got.length, 1);
    assert.equal(got[0].token.amount, AMOUNT);
    assert.equal(got[0].token.category, CATEGORY);
    assert.ok(tx.txid);
  });

  test(fn + ': a second input is refused', async () => {
    const s = setup();
    const extra = s.provider.addUtxo(s.contract.address, { ...randomUtxo(), satoshis: LOCK_SATS, token: { category: CATEGORY, amount: 1n } });
    const o = { ...good(s, fn), token: { category: CATEGORY, amount: AMOUNT + 1n } };
    await failsAt(spend(s, fn, [o], { inputs: [s.utxo, extra] }).send(), fn, 'tx.inputs.length == 1');
  });

  test(fn + ': an extra output is refused', async () => {
    const s = setup();
    const o = { ...good(s, fn), amount: 1000n };
    await failsAt(spend(s, fn, [o, { to: s.attacker.chipnet, amount: 1000n }]).send(), fn, 'tx.outputs.length == 1');
  });

  test(fn + ': an output to anyone else is refused', async () => {
    const s = setup();
    await failsAt(spend(s, fn, [{ ...good(s, fn), to: s.attacker.chipnetTokens }]).send(), fn, 'lockingBytecode');
  });

  test(fn + ': fewer tokens than locked is refused', async () => {
    const s = setup();
    await failsAt(spend(s, fn, [{ ...good(s, fn), token: { category: CATEGORY, amount: AMOUNT - 1n } }]).send(), fn, 'tokenAmount');
  });

  test(fn + ': a different token category is refused', async () => {
    const s = setup();
    const other = randomBytes(32).toString('hex');
    await failsAt(spend(s, fn, [{ ...good(s, fn), token: { category: other, amount: AMOUNT } }]).send(), fn, 'tokenCategory');
  });

  test(fn + ': stripping the token is refused', async () => {
    const s = setup();
    await failsAt(spend(s, fn, [{ to: target(s, fn).chipnet, amount: LOCK_SATS - 800n }]).send(), fn, 'tokenCategory');
  });

  test(fn + ': burning more than maxFee to miners is refused, exactly maxFee is allowed', async () => {
    const s = setup();
    await failsAt(spend(s, fn, [{ ...good(s, fn), amount: LOCK_SATS - MAX_FEE - 1n }]).send(), fn, 'tx.outputs[0].value');
    const s2 = setup();
    await spend(s2, fn, [{ ...good(s2, fn), amount: LOCK_SATS - MAX_FEE }]).send();
  });
}

test('claim: a wrong secret is refused', async () => {
  const s = setup();
  s.secretHex = randomBytes(32).toString('hex');
  await failsAt(spend(s, 'claim', [good(s, 'claim')]).send(), 'claim', 'sha256(secret)');
});

test('claim: a secret that is not 32 bytes is refused even when its hash matches', async () => {
  const short = randomBytes(31).toString('hex');
  const s = setup(short, sha256Hex(short));
  await failsAt(spend(s, 'claim', [good(s, 'claim')]).send(), 'claim', 'secret.length');
});

test('claim: still works after refundTime (no deadline on the BCH side)', async () => {
  const s = setup();
  await spend(s, 'claim', [good(s, 'claim')], { locktime: REFUND_TIME + 1000 }).send();
});

test('refund: refused before refundTime', async () => {
  const s = setup();
  const b = tb(s.provider).addInput(s.utxo, s.contract.unlock.refund()).addOutput(good(s, 'refund')).setLocktime(REFUND_TIME - 1);
  await failsAt(b.send(), 'refund', 'tx.time');
});

test('refund: allowed exactly at refundTime', async () => {
  const s = setup();
  await spend(s, 'refund', [good(s, 'refund')], { locktime: REFUND_TIME }).send();
});

test('production builders: claim and refund of a real-sized lock produce a valid, relayable spend', async () => {
  const s = setup();
  const claimed = await claimBuilder({ provider: s.provider, contract: s.contract, utxo: s.utxo, secretHex: s.secretHex, recipientLock: lockingBytecodeOf(s.recipient.chipnet), prefix: 'bchtest' }).send();
  assert.ok(claimed.txid);
  const t = setup();
  const refunded = await refundBuilder({ provider: t.provider, contract: t.contract, utxo: t.utxo, refundLock: lockingBytecodeOf(t.refunder.chipnet), refundTime: REFUND_TIME, prefix: 'bchtest' }).send();
  assert.ok(refunded.txid);
});
