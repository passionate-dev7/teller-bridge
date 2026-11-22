// The checks a browser runs on a desk quote before it signs anything. A quote that fails any of them must be refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './harness.js';
import { checkQuote, randomSecret } from '../lib/client.js';
import { lockingBytecodeOf } from '../lib/bch.js';

const rigs = [];
after(() => rigs.forEach((r) => r.stop()));

async function quoteOf(dir) {
  const r = await rig();
  rigs.push(r);
  r.user.fundBch(10_000n);
  const { hashlock } = randomSecret();
  const sendUnits = dir === 'bch2base' ? '500' : '5000000';
  const req = { dir, pair: 'PUSD', sendUnits, hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address };
  const q = await r.desk.createSwap(req);
  if (dir === 'bch2base') q.bchLockAddress = r.user.bchContract(q).tokenAddress;
  const status = JSON.parse(JSON.stringify(await r.desk.status()));
  const now = Math.floor(Date.now() / 1000);
  const pin = { chainId: status.evm.chainId, deskLock: r.deskLock, token: r.token, deskEvm: r.evm.address, deskBchLock: r.bch.lockingHex };
  return { r, q: JSON.parse(JSON.stringify(q)), req: { ...req, userBchLock: lockingBytecodeOf(r.user.bch.chipnet) }, status, now, pin };
}
const check = ({ r, q, req, status, now, pin }, tweak = (x) => x) => checkQuote(tweak({ ...q }), req, status, now, r.chain, pin);

test('an honest quote passes in both directions', async () => {
  for (const dir of ['bch2base', 'base2bch']) assert.deepEqual(check(await quoteOf(dir)), [], dir);
});

test('a quote with a different hashlock, amount, wallet script or Base address is refused', async () => {
  const c = await quoteOf('bch2base');
  assert.match(check(c, (q) => ({ ...q, hashlock: 'ab'.repeat(32) })).join(), /hashlock/);
  assert.match(check(c, (q) => ({ ...q, sendUnits: '501' })).join(), /send amount/);
  assert.match(check(c, (q) => ({ ...q, userBchLock: '76a914' + '00'.repeat(20) + '88ac' })).join(), /refund\/recipient script/);
  assert.match(check(c, (q) => ({ ...q, userEvm: '0x000000000000000000000000000000000000dEaD' })).join(), /Base address/);
});

test('a quote that is not the advertised rate is refused', async () => {
  const c = await quoteOf('bch2base');
  assert.match(check(c, (q) => ({ ...q, recvUnits: String(BigInt(q.recvUnits) - 1n) })).join(), /advertised rate/);
  const d = await quoteOf('base2bch');
  assert.match(check(d, (q) => ({ ...q, recvUnits: String(BigInt(q.recvUnits) - 1n) })).join(), /advertised rate/);
});

test('a refund time that comes too soon is refused in both directions', async () => {
  const c = await quoteOf('bch2base');
  assert.match(check(c, (q) => ({ ...q, bchRefundTime: c.now + 60 })).join(), /refund time is too soon/);
  const d = await quoteOf('base2bch');
  assert.match(check(d, (q) => ({ ...q, evmTimeout: d.now + 60 })).join(), /refund time is too soon/);
});

test('a lock address or Base lock id that does not follow from the terms is refused', async () => {
  const c = await quoteOf('bch2base');
  assert.match(check(c, (q) => ({ ...q, bchLockAddress: 'bchtest:zpk40ajqg0a2kxxrnqn3xgha6taycv0gussthrqt0w' })).join(), /derived from the terms/);
  const d = await quoteOf('base2bch');
  assert.match(check(d, (q) => ({ ...q, evmLockId: '0x' + '11'.repeat(32) })).join(), /lock id/);
});

test('a desk that swapped its own script into the lock is caught by deriving the address from the terms', async () => {
  const c = await quoteOf('bch2base');
  // the desk claims the lock pays the desk, but the status it publishes names a different desk script
  const status = { ...c.status, bch: { ...c.status.bch, deskLock: '76a914' + '11'.repeat(20) + '88ac' } };
  const problems = checkQuote({ ...c.q }, c.req, status, c.now, c.r.chain, c.pin);
  assert.match(problems.join(), /derived from the terms/);
});
