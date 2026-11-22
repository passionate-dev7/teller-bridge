// Findings of the security review, each as a test that failed against the code that had the hole.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './harness.js';
import * as client from '../lib/client.js';
import { readLock } from '../lib/evm.js';

const rigs = [];
const fresh = async (o) => { const r = await rig(o); rigs.push(r); return r; };
after(() => rigs.forEach((r) => r.stop()));
const clone = (x) => JSON.parse(JSON.stringify(x));

/** what a browser holds after it asked for a quote: the desk's view of the swap, the desk status, and its own chain reads */
async function revealCtx(r, q, { pinned } = {}) {
  const status = clone(await r.desk.status());
  const swap = clone(r.swap(q.id));
  const reads = { evmLock: (id) => readLock(r.publicClient, r.deskLock, id), provider: r.chain, confirmations: (txid) => r.chain.confirmations(txid) };
  const pin = pinned ?? { deskEvm: r.evm.address, deskLock: r.deskLock, token: r.token };
  const expect = { userEvm: swap.userEvm, userBchLock: swap.userBchLock, hashlock: swap.hashlock, sendUnits: swap.sendUnits };
  return { status, swap, reads, pin, expect, now: r.clock() };
}
const ready = (ctx, tweak = {}) => client.readyToReveal({ ...ctx.swap, ...tweak }, { ...ctx, ...(tweak.__ctx ?? {}) });

// ---------------------------------------------------------------- 1. the browser reads the desk's lock itself before it reveals

test('1 bch2base: the secret is not released on the desk\'s word, only when Base shows the right lock', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  const ctx = await revealCtx(r, q);
  assert.equal(ctx.swap.state, 'desk_locked');
  assert.equal((await ready(ctx)).ok, true, 'honest lock passes');
  // the server claims a lock that does not exist on chain
  assert.equal((await ready(ctx, { evmLockId: '0x' + '11'.repeat(32) })).ok, false, 'empty lock');
  // lock exists but is for less than the quote
  assert.equal((await ready(ctx, { recvUnits: String(BigInt(ctx.swap.recvUnits) + 1n) })).ok, false, 'wrong amount');
  assert.equal((await ready(ctx, { hashlock: 'ab'.repeat(32) })).ok, false, 'wrong hashlock');
  assert.equal((await ready(ctx, { userEvm: '0x000000000000000000000000000000000000dEaD' })).ok, false, 'wrong recipient');
  // the desk lock must run out well before the user's own BCH refund opens
  assert.equal((await ready(ctx, { bchRefundTime: ctx.swap.evmTimeout + 60 })).ok, false, 'timeout ordering');
  // a lock that is about to expire cannot be claimed in time
  assert.equal((await ready({ ...ctx, now: ctx.swap.evmTimeout - 60 })).ok, false, 'too close to expiry');
  // locked by someone other than the pinned desk account
  assert.equal((await ready({ ...ctx, pin: { ...ctx.pin, deskEvm: '0x000000000000000000000000000000000000dEaD' } })).ok, false, 'not the pinned desk');
});

test('1 base2bch: the secret is not released until the BCH lock is on chain, confirmed, for the right amount and with safe timing', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const ctx = await revealCtx(r, q);
  assert.equal(ctx.swap.state, 'desk_locked');
  assert.equal((await ready(ctx)).ok, false, 'a mempool lock is not enough');
  r.chain.confirmed.add(ctx.swap.txs.deskLock);
  assert.equal((await ready(ctx)).ok, true, 'confirmed honest lock passes');
  assert.equal((await ready(ctx, { recvUnits: String(BigInt(ctx.swap.recvUnits) + 1n) })).ok, false, 'lock holds less than the quote');
  assert.equal((await ready(ctx, { bchRefundTime: ctx.swap.evmTimeout })).ok, false, 'BCH refund must open well before the Base refund');
  assert.equal((await ready(ctx, { bchRefundTime: ctx.now + 60 })).ok, false, 'BCH lock about to open for refund');
  assert.equal((await ready(ctx, { userBchLock: '76a914' + '00'.repeat(20) + '88ac' })).ok, false, 'pays someone else');
});

// ---------------------------------------------------------------- 2. the browser pins the desk's contract, token and accounts

test('2 a status that names another DeskLock, token or desk account is refused, and so is a quote built on it', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const status = clone(await r.desk.status());
  const pin = { chainId: status.evm.chainId, deskLock: r.deskLock, token: r.token, deskEvm: r.evm.address, deskBchLock: r.bch.lockingHex };
  assert.deepEqual(client.checkStatus(status, pin), [], 'honest status');
  const evil = '0x000000000000000000000000000000000000dEaD';
  const bad = (f) => { const s = clone(status); f(s); return client.checkStatus(s, pin).join(); };
  assert.match(bad((s) => { s.evm.deskLock = evil; }), /DeskLock/);
  assert.match(bad((s) => { s.evm.token = evil; }), /token/);
  assert.match(bad((s) => { s.evm.deskAddress = evil; }), /desk account/);
  assert.match(bad((s) => { s.bch.deskLock = '76a914' + '11'.repeat(20) + '88ac'; }), /Bitcoin Cash desk/);
  assert.match(bad((s) => { s.evm.chainId = 1; }), /chain/);
  assert.match(client.checkStatus(status, undefined).join(), /no pinned desk/);
  // a quote is refused when the status it was built on differs from the pin
  const { hashlock } = r.user.secret();
  const req = { dir: 'bch2base', pair: 'PUSD', sendUnits: '500', hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address };
  const q = clone(await r.desk.createSwap(req));
  q.bchLockAddress = r.user.bchContract(q).tokenAddress;
  const forged = clone(status); forged.evm.deskLock = evil;
  const problems = client.checkQuote(q, { ...req, userBchLock: q.userBchLock }, forged, r.clock(), r.chain, pin);
  assert.match(problems.join(), /DeskLock/);
  assert.deepEqual(client.checkQuote(q, { ...req, userBchLock: q.userBchLock }, status, r.clock(), r.chain, pin), []);
});

// ---------------------------------------------------------------- 3. 0-conf exposure is small, and a vanished user lock is never booked as done

test('3 the 0-conf limit is at most one dollar', async () => {
  const { DEFAULT_RULES } = await import('../lib/config.js');
  assert.ok(DEFAULT_RULES.zeroConfMaxCents <= 100n, 'limit is ' + DEFAULT_RULES.zeroConfMaxCents);
});

test('3 the user lock vanishes (double-spent) after the desk paid: the swap is a loss, not done', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '500', hashlock });
  const lockTx = await r.user.lockBch(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked');
  // the conflicting spend wins: the lock output never exists
  r.chain.utxoSet = r.chain.utxoSet.filter(([, u]) => u.txid !== lockTx);
  await r.desk.reveal(q.id, secret);
  assert.notEqual(r.swap(q.id).state, 'done');
  assert.equal(r.swap(q.id).state, 'loss');
  assert.equal(r.desk.recentDone().length, 0, 'not listed as a completed swap');
});

test('3 an honest claim is still booked done only once the chain shows the lock spent by a claim with the secret', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  await r.desk.reveal(q.id, secret);
  assert.equal(r.swap(q.id).state, 'done');
  assert.equal(await r.bch.findSecret(r.store.get(q.id)), secret);
});

test('3 base2bch: if the user USDC lock is gone when the desk goes to claim it, that is a loss, not done', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch();
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const real = r.evm.lockState.bind(r.evm);
  r.evm.lockState = async (id) => ({ ...(await real(id)), state: 3 }); // refunded under the desk's feet
  await r.desk.reveal(q.id, secret);
  assert.equal(r.swap(q.id).state, 'loss');
});

// ---------------------------------------------------------------- 4. refund_wait keeps reading the BCH lock

test('4 base2bch: the desk\'s BCH refund is lost in the first-seen race and the user claims instead: the desk claims the USDC, and never relays the user a refund', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch();
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const locked = r.swap(q.id);
  assert.equal(locked.state, 'desk_locked');
  const deskUsdc0 = await r.evm.usdcBalance();
  // the refund the desk believes it sent never reaches a miner
  r.bch.refund = async () => 'ab'.repeat(32);
  await r.warp(locked.bchRefundTime - r.chain.mtp + 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  // the user's claim is the one that gets mined
  await r.user.claimBchSelf(locked, secret);
  assert.equal(await r.user.bchTokens(), 99n);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'done', 'the desk saw the claim and took the USDC');
  assert.equal(await r.evm.usdcBalance(), deskUsdc0 + 1_000_000n);
  await r.warp(q.evmTimeout - r.clock() + 5);
  await r.tick();
  assert.equal(await r.user.usdc(), 4_000_000n, 'the user did not also get the USDC back');
});

test('4 base2bch: a claim seen only after the Base lock expired is a loss and the desk does not refund the user on top', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch();
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const locked = r.swap(q.id);
  r.bch.refund = async () => 'ab'.repeat(32);
  await r.warp(locked.bchRefundTime - r.chain.mtp + 5);
  await r.tick();
  await r.user.claimBchSelf(locked, secret);
  await r.warp(q.evmTimeout - r.clock() + 5); // the desk was down until now
  await r.tick();
  assert.equal(r.swap(q.id).state, 'loss');
  assert.equal(await r.user.usdc(), 4_000_000n, 'no refund relayed for a lock whose BCH side was claimed');
});

// ---------------------------------------------------------------- 5. a quote is free, so it reserves nothing

test('5 one client quoting the whole inventory does not lock everyone else out', async () => {
  const r = await fresh();
  const max = BigInt((await r.desk.status()).pairs[0].maxSend.bch2base);
  const a = r.user.secret(), b = r.user.secret();
  const first = await r.desk.createSwap({ dir: 'bch2base', pair: 'PUSD', sendUnits: max.toString(), hashlock: a.hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address }, '1.1.1.1');
  assert.equal(first.state, 'quoted');
  assert.equal(BigInt((await r.desk.status()).pairs[0].maxSend.bch2base), max, 'a quote reserves nothing');
  const second = await r.desk.createSwap({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock: b.hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address }, '2.2.2.2');
  assert.equal(second.state, 'quoted', 'a second client still gets a quote');
});

test('5 quotes live one minute, and one client address holds at most three open swaps', async () => {
  const { DEFAULT_RULES } = await import('../lib/config.js');
  assert.ok(DEFAULT_RULES.quoteTtl <= 60, 'ttl ' + DEFAULT_RULES.quoteTtl);
  const r = await fresh();
  const mk = () => ({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock: r.user.secret().hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address });
  for (let i = 0; i < 3; i++) await r.desk.createSwap(mk(), '9.9.9.9');
  await assert.rejects(r.desk.createSwap(mk(), '9.9.9.9'), (e) => e.code === 'busy');
  await r.desk.createSwap(mk(), '8.8.8.8'); // another address is unaffected
});

test('5 inventory is reserved when a lock is seen on chain, not when a quote is asked for', async () => {
  const r = await fresh({ rules: { zeroConfMaxCents: 100n } });
  r.user.fundBch(10_000n);
  const max = BigInt((await r.desk.status()).pairs[0].maxSend.bch2base);
  const a = r.user.secret(), b = r.user.secret();
  const qa = await r.user.request({ dir: 'bch2base', sendUnits: (max - 100n).toString(), hashlock: a.hashlock });
  await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock: b.hashlock });
  assert.equal((await r.desk.status()).pairs[0].available.usdcUnits, '10000000', 'two open quotes reserve nothing');
  // the first lock is above the 0-conf limit and unconfirmed: the desk sees it and holds its payout back
  await r.user.lockBch(qa);
  await r.tick();
  assert.equal(r.swap(qa.id).state, 'user_locked');
  assert.equal(BigInt((await r.desk.status()).pairs[0].available.usdcUnits), 10_000_000n - BigInt(qa.recvUnits), 'the seen lock reserves its payout');
});

// ---------------------------------------------------------------- 6. client addresses, the Base log cursor, the peg, and the deployed token

test('6 a forwarded-for header is believed only from a loopback proxy and only at the configured hop count', async () => {
  const { clientIp } = await import('../desk/server.js');
  const req = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } });
  assert.equal(clientIp(req('5.6.7.8', 'evil'), undefined), '5.6.7.8', 'no proxy configured');
  assert.equal(clientIp(req('5.6.7.8', 'evil'), '1'), '5.6.7.8', 'peer is not the proxy');
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9'), '1'), '9.9.9.9', 'one proxy hop');
  assert.equal(clientIp(req('127.0.0.1', 'evil, 9.9.9.9'), '1'), '9.9.9.9', 'the proxy appends, the client prefix is ignored');
  assert.equal(clientIp(req('127.0.0.1', 'evil, 9.9.9.9, 10.0.0.1'), '2'), '9.9.9.9', 'two proxy hops');
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9'), 'yes'), '127.0.0.1', 'TRUST_PROXY must be a hop count');
  assert.equal(clientIp(req('127.0.0.1', undefined), '1'), '127.0.0.1', 'no header');
});

test('6 the rate limiter forgets old clients and cannot grow without bound', async () => {
  const { rateLimiter } = await import('../desk/server.js');
  const limited = rateLimiter({ limit: 3, windowMs: 60_000, maxKeys: 1000 });
  const t = 1_000_000;
  assert.deepEqual([1, 2, 3, 4].map(() => limited('a', t)), [false, false, false, true]);
  for (let i = 0; i < 20_000; i++) limited('ip' + i, t + i);
  assert.ok(limited.size() <= 1000, 'map holds ' + limited.size());
  assert.equal(limited('a', t + 61_000 + 20_000), false, 'window passed');
  const small = rateLimiter({ limit: 3, windowMs: 60_000, maxKeys: 1000 });
  [1, 2, 3, 4].forEach(() => small('b', t));
  assert.equal(small('b', t + 61_000), false, 'a client is forgiven once its window has passed');
});

test('6 a Base RPC error during the desk lock does not lose the log cursor', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await r.user.lockBch(q);
  await r.warp(5);
  // the lock lands on Base, then the desk's call fails (receipt timeout, restart)
  const orig = r.evm.lock.bind(r.evm);
  r.evm.lock = async (a) => { await orig(a); throw new Error('rpc blip'); };
  await r.tick();
  r.evm.lock = orig;
  await r.warp(5);
  const mid = r.swap(q.id);
  assert.ok(mid.evmLockId, 'lock id was recorded');
  // the public RPC refuses a log scan from genesis
  const getLogs = r.evm.publicClient.getLogs.bind(r.evm.publicClient);
  r.evm.publicClient.getLogs = async (p) => { if (!p.fromBlock || p.fromBlock === 0n) throw new Error('query returned more than 10000 results'); return getLogs(p); };
  await r.user.claimUsdcSelf({ evmLockId: mid.evmLockId }, secret);
  await r.tick(2);
  assert.equal(r.swap(q.id).state, 'done');
});

test('6 quotes are refused when the PUSD price is more than one percent off par, and when the price cannot be read', async () => {
  const r = await fresh();
  const mk = () => ({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock: r.user.secret().hashlock, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address });
  r.desk.peg = async () => 0.95;
  await assert.rejects(r.desk.createSwap(mk()), (e) => e.code === 'peg');
  await r.warp(61); // the price is cached for a minute
  r.desk.peg = async () => 1.02;
  await assert.rejects(r.desk.createSwap(mk()), (e) => e.code === 'peg');
  await r.warp(61);
  r.desk.peg = async () => { throw new Error('router down'); };
  await assert.rejects(r.desk.createSwap(mk()), (e) => e.code === 'peg');
  await r.warp(61);
  r.desk.peg = async () => 1.004;
  assert.equal((await r.desk.createSwap({ ...mk(), dir: 'base2bch', sendUnits: '500000' })).state, 'quoted');
  assert.equal((await r.desk.createSwap(mk())).state, 'quoted');
});

test('6 the desk refuses to start against a DeskLock that holds a different token', async () => {
  const r = await fresh();
  await r.evm.verifyDeployment(); // the rig deployed DeskLock with the token the desk uses
  const { EvmDesk } = await import('../desk/chains.js');
  const wrong = new EvmDesk({ publicClient: r.publicClient, walletClient: r.evm.walletClient, account: r.evm.account, deskLock: r.deskLock, token: '0x000000000000000000000000000000000000dEaD' });
  await assert.rejects(wrong.verifyDeployment(), /token/);
  const nowhere = new EvmDesk({ publicClient: r.publicClient, walletClient: r.evm.walletClient, account: r.evm.account, deskLock: '0x000000000000000000000000000000000000dEaD', token: r.token });
  await assert.rejects(nowhere.verifyDeployment());
});

// ---------------------------------------------------------------- gaps the mutation run found in the tests above

test('5 the per-address cap counts swaps past the quote stage too', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const mk = (h) => ({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock: h, userBchAddress: r.user.bch.chipnet, userEvm: r.user.evm.account.address });
  const keep = r.user.secret();
  const first = await r.desk.createSwap(mk(keep.hashlock), '7.7.7.7');
  await r.desk.createSwap(mk(r.user.secret().hashlock), '7.7.7.7');
  await r.desk.createSwap(mk(r.user.secret().hashlock), '7.7.7.7');
  await r.user.lockBch(first);
  await r.tick();
  assert.equal(r.swap(first.id).state, 'desk_locked');
  await assert.rejects(r.desk.createSwap(mk(r.user.secret().hashlock), '7.7.7.7'), (e) => e.code === 'busy');
});

test('1 each field of the desk lock is checked on its own, not just through the others', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  const ctx = await revealCtx(r, q);
  const dead = '0x000000000000000000000000000000000000dEaD';
  // the browser's own record agrees with the (wrong) swap fields, so only the chain can say no
  const agree = (k, v) => ({ ...ctx, expect: { ...ctx.expect, [k]: v } });
  assert.equal((await ready(agree('userEvm', dead), { userEvm: dead })).ok, false, 'lock pays someone else');
  assert.equal((await ready(agree('hashlock', 'ab'.repeat(32)), { hashlock: 'ab'.repeat(32) })).ok, false, 'lock uses another hashlock');
  // a lock that exists with every field right but is already claimed
  await r.user.claimUsdcSelf(ctx.swap, secret);
  assert.equal((await ready(ctx)).ok, false, 'a claimed lock is not an open lock');
});

test('1 base2bch: a BCH refund time that opens too close to the Base refund is refused even when a lock exists at that address', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const ctx = await revealCtx(r, q);
  const { swapLock } = await import('../lib/bch.js');
  const { randomUtxo } = await import('cashscript');
  const refundTime = ctx.swap.evmTimeout - ctx.status.windows.evmOverlap + 60;
  const contract = swapLock({ hashlock, recipientLock: ctx.swap.userBchLock, refundLock: r.bch.lockingHex, refundTime }, r.chain);
  const u = r.chain.addUtxo(contract.address, { ...randomUtxo(), satoshis: 3000n, token: { category: ctx.swap.category, amount: BigInt(ctx.swap.recvUnits) } });
  r.chain.confirmed.add(u.txid);
  const honest = await ready(ctx, { bchRefundTime: ctx.swap.evmTimeout - ctx.status.windows.evmOverlap - 600 });
  assert.equal(honest.ok, false, 'no lock at that other address');
  assert.equal((await ready(ctx, { bchRefundTime: refundTime })).ok, false, 'a funded lock at the unsafe time');
});
