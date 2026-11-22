// Desk engine against a real EVM (anvil) and the BCH VM. Every refund and timeout branch of both directions is walked.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rig, CATEGORY } from './harness.js';
import { LOCK_STATE } from '../lib/evm.js';

const H = 3600;
const rigs = [];
const fresh = async (o) => { const r = await rig(o); rigs.push(r); return r; };
after(() => rigs.forEach((r) => r.stop()));

// ---------------------------------------------------------------- BCH stable -> USDC

test('bch2base happy path: user reveals the secret to the desk, gets USDC, desk claims the BCH stable', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '500', hashlock }); // 5.00 PUSD
  assert.equal(q.recvUnits, '4985000'); // 5.00 * 0.997 = 4.985 USDC
  assert.equal(q.state, 'quoted');
  await r.user.lockBch(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked');
  assert.equal(await r.user.usdc(), 0n);
  await r.desk.reveal(q.id, secret);
  const s = r.swap(q.id);
  assert.equal(s.state, 'done');
  assert.equal(await r.user.usdc(), 4_985_000n);
  assert.equal(await r.deskTokens(), 100_000n + 500n);
  assert.ok(s.txs.deskLock && s.txs.userPayout && s.txs.deskClaim);
  assert.equal(r.user.bch && (await r.user.bchTokens()), 9_500n);
});

test('bch2base: user claims the USDC himself, desk reads the secret from Base and claims the BCH stable', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  const locked = r.swap(q.id);
  assert.equal(locked.state, 'desk_locked');
  await r.user.claimUsdcSelf(locked, secret);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'done');
  assert.equal(r.swap(q.id).secretVia, 'evm');
  assert.equal(await r.deskTokens(), 100_000n + 100n);
  assert.equal(r.swap(q.id).txs.userPayout, undefined);
});

test('bch2base: user vanishes, desk takes its USDC back at the Base timeout, then releases the BCH stable to the user after the BCH refund time', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const deskUsdc0 = await r.evm.usdcBalance();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  const locked = r.swap(q.id);
  assert.equal(locked.state, 'desk_locked');
  assert.ok((await r.evm.usdcBalance()) < deskUsdc0);
  await r.warp(locked.evmTimeout - r.clock() - 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked', 'one lap before the timeout nothing is refunded');
  assert.equal(r.swap(q.id).lastError, null);
  await r.warp(10);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.evm.usdcBalance(), deskUsdc0, 'desk USDC fully restored');
  assert.equal((await r.evm.lockState(locked.evmLockId)).state, LOCK_STATE.Refunded);
  // the BCH lock is still the user's money, locked until refundTime
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(r.swap(q.id).lastError, null, 'no premature BCH refund attempted');
  assert.equal(await r.user.bchTokens(), 9_700n, 'the 3.00 is still locked');
  await r.warp(q.bchRefundTime - r.clock() + 3600);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refunded');
  assert.equal(await r.user.bchTokens(), 10_000n, 'user got every unit back');
  assert.equal(await r.deskTokens(), 100_000n, 'desk never touched the user lock');
});

test('bch2base: above the 0-conf limit the desk waits for one confirmation before locking USDC', async () => {
  const r = await fresh({ rules: { zeroConfMaxCents: 100n } });
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const deskUsdc0 = await r.evm.usdcBalance();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '300', hashlock }); // 3.00 > 1.00 limit
  const lockTx = await r.user.lockBch(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'user_locked', 'unconfirmed lock is not answered');
  assert.equal(await r.evm.usdcBalance(), deskUsdc0);
  r.chain.confirmed.add(lockTx);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked');
  assert.ok((await r.evm.usdcBalance()) < deskUsdc0);
  // under the limit a mempool lock is answered at once
  const small = r.user.secret();
  const q2 = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock: small.hashlock });
  await r.user.lockBch(q2);
  await r.tick();
  assert.equal(r.swap(q2.id).state, 'desk_locked');
});

test('bch2base: a quote nobody funds expires and reserves nothing afterwards', async () => {
  const r = await fresh();
  const { hashlock } = r.user.secret();
  const before = (await r.desk.status()).pairs[0].available.usdcUnits;
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '1000', hashlock });
  assert.notEqual((await r.desk.status()).pairs[0].available.usdcUnits, before, 'quote reserves inventory');
  await r.warp(r.rules.quoteTtl + 1);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'expired');
  assert.equal((await r.desk.status()).pairs[0].available.usdcUnits, before, 'reservation released');
});

test('bch2base: a lock that lands after the quote expired is never answered on Base, and the user is refunded', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const deskUsdc0 = await r.evm.usdcBalance();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '200', hashlock });
  await r.warp(r.rules.quoteTtl + 1);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'expired');
  await r.user.lockBch(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.evm.usdcBalance(), deskUsdc0, 'no Base lock was made');
  await r.warp(q.bchRefundTime - r.clock() + 3600);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refunded');
  assert.equal(await r.user.bchTokens(), 10_000n);
});

test('bch2base: a lock too close to the BCH refund time is not answered (the desk could not claim in time)', async () => {
  const r = await fresh({ rules: { quoteTtl: 6 * H } });
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const deskUsdc0 = await r.evm.usdcBalance();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '200', hashlock });
  await r.warp(r.rules.userBchWindow - r.rules.overlap - 10 * 60); // inside overlap + margin
  await r.user.lockBch(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.evm.usdcBalance(), deskUsdc0);
});

test('bch2base: the desk refuses to lock USDC it does not hold', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '500', hashlock });
  await r.user.lockBch(q);
  // inventory vanishes between quote and answer
  const sink = '0x000000000000000000000000000000000000dEaD';
  await r.publicClient.waitForTransactionReceipt({ hash: await r.evm.walletClient.writeContract({ address: r.token, abi: (await import('../lib/evm.js')).ERC20_ABI, functionName: 'transfer', args: [sink, await r.evm.usdcBalance()] }) });
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(r.swap(q.id).txs.deskLock, undefined);
});

// ---------------------------------------------------------------- USDC -> BCH stable

test('base2bch happy path: user locks USDC, desk locks the BCH stable, user reveals, desk pays and claims', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch(); // wallet to receive
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '2000000', hashlock }); // 2 USDC
  assert.equal(q.recvUnits, '199'); // 1.99 PUSD
  await r.user.lockUsdc(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked');
  assert.equal(await r.deskTokens(), 100_000n - 199n);
  await r.desk.reveal(q.id, secret);
  const s = r.swap(q.id);
  assert.equal(s.state, 'done');
  assert.equal(await r.user.bchTokens(), 199n);
  assert.equal(await r.user.usdc(), 3_000_000n);
  assert.equal(await r.evm.usdcBalance(), 10_000_000n + 2_000_000n);
  assert.ok(s.txs.deskLock && s.txs.userPayout && s.txs.deskClaim);
});

test('base2bch: user claims the BCH stable himself, desk reads the secret from BCH and claims the USDC', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch();
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const locked = r.swap(q.id);
  assert.equal(locked.state, 'desk_locked');
  await r.user.claimBchSelf(locked, secret);
  assert.equal(await r.user.bchTokens(), 99n);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'done');
  assert.equal(r.swap(q.id).secretVia, 'bch');
  assert.equal(await r.evm.usdcBalance(), 11_000_000n);
});

test('base2bch: user never claims: desk takes its BCH stable back after the BCH refund time, then relays the user USDC refund after the Base timeout', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  r.user.fundBch();
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1500000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const locked = r.swap(q.id);
  assert.equal(locked.state, 'desk_locked');
  assert.equal(await r.user.usdc(), 3_500_000n);
  await r.warp(locked.bchRefundTime - r.chain.mtp - 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'desk_locked');
  assert.equal(r.swap(q.id).lastError, null, 'no premature BCH refund attempted');
  assert.equal(await r.deskTokens(), 100_000n - 149n);
  await r.warp(10);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.deskTokens(), 100_000n, 'desk stable fully restored');
  // user's USDC is still locked until the Base timeout
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(r.swap(q.id).lastError, null, 'no premature Base refund attempted');
  assert.equal(await r.user.usdc(), 3_500_000n);
  await r.warp(q.evmTimeout - r.clock() + 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refunded');
  assert.equal(await r.user.usdc(), 5_000_000n, 'user got every USDC unit back');
});

test('base2bch: the user claim window outlives the desk refund by the configured overlap (the desk never pays twice)', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  await r.tick();
  const s = r.swap(q.id);
  assert.ok(q.evmTimeout - s.bchRefundTime >= r.rules.evmOverlap, 'Base timeout at least evmOverlap after the BCH refund time');
});

test('base2bch: a lock that lands after the quote expired is never answered on BCH, and the user is refunded', async () => {
  const r = await fresh();
  await r.user.fundUsdc(5_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.warp(r.rules.quoteTtl + 1);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'expired');
  await r.user.lockUsdc(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.deskTokens(), 100_000n, 'no BCH lock was made');
  await r.warp(q.evmTimeout - r.clock() + 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refunded');
  assert.equal(await r.user.usdc(), 5_000_000n);
});

test('base2bch: a lock that is too close to the Base timeout is not answered', async () => {
  const r = await fresh({ rules: { quoteTtl: 6 * H } });
  await r.user.fundUsdc(5_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.warp(r.rules.userEvmWindow - r.rules.evmOverlap - 10 * 60);
  await r.user.lockUsdc(q);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.equal(await r.deskTokens(), 100_000n, 'no BCH lock was made');
  await r.warp(q.evmTimeout - r.clock() + 5);
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refunded');
  assert.equal(await r.user.usdc(), 5_000_000n);
});

test('base2bch: the desk refuses to lock a BCH stable it does not hold', async () => {
  const r = await fresh();
  await r.user.fundUsdc(50_000_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'base2bch', sendUnits: '1000000', hashlock });
  await r.user.lockUsdc(q);
  // inventory vanishes between quote and answer
  const tokens = await r.deskTokens();
  const utxos = (await r.chain.getUtxos(r.bch.address)).filter((u) => u.token);
  assert.equal(utxos.length > 0, true);
  r.chain.reset();
  await r.tick();
  assert.equal(r.swap(q.id).state, 'refund_wait');
  assert.ok(tokens > 0n);
});

// ---------------------------------------------------------------- guards at the door

test('quotes: over capacity is refused with the live maximum and an overflow flag', async () => {
  const r = await fresh();
  const st = await r.desk.status();
  const max = BigInt(st.pairs[0].maxSend.bch2base);
  assert.equal(max, 1003n); // 10 USDC of inventory / (0.01 USDC per unit * 0.997)
  const { hashlock } = r.user.secret();
  await assert.rejects(r.user.request({ dir: 'bch2base', sendUnits: (max + 1n).toString(), hashlock }), (e) => e.code === 'over_capacity' && e.extra.overflow === true && e.extra.maxSend === max.toString());
  const ok = await r.user.request({ dir: 'bch2base', sendUnits: max.toString(), hashlock });
  assert.equal(ok.state, 'quoted');
  const again = r.user.secret();
  await assert.rejects(r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock: again.hashlock }), (e) => e.code === 'over_capacity', 'inventory is fully reserved by the first quote');
});

test('quotes: below minimum, bad address, reused hashlock, fractional cents are refused', async () => {
  const r = await fresh();
  const { hashlock } = r.user.secret();
  await assert.rejects(r.user.request({ dir: 'bch2base', sendUnits: '10', hashlock }), (e) => e.code === 'below_min');
  await assert.rejects(r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock: 'zz' }), (e) => e.code === 'bad_request');
  await assert.rejects(r.desk.createSwap({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock, userBchAddress: 'bitcoincash:qpk40ajqg0a2kxxrnqn3xgha6taycv0gusnnq6v6hp', userEvm: r.user.evm.account.address }), (e) => e.code === 'bad_request');
  await assert.rejects(r.desk.createSwap({ dir: 'bch2base', pair: 'PUSD', sendUnits: '100', hashlock, userBchAddress: r.user.bch.chipnet, userEvm: '0x123' }), (e) => e.code === 'bad_request');
  await assert.rejects(r.user.request({ dir: 'base2bch', sendUnits: '1000005', hashlock }), (e) => e.code === 'bad_request');
  await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await assert.rejects(r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock }), (e) => e.code === 'bad_request' && /already used/.test(e.message));
});

test('reveal: a wrong secret is rejected, and a secret before the desk has locked is refused', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await assert.rejects(r.desk.reveal(q.id, secret), (e) => e.code === 'conflict');
  await r.user.lockBch(q);
  await r.tick();
  await assert.rejects(r.desk.reveal(q.id, 'ab'.repeat(32)), (e) => e.code === 'bad_request');
  assert.equal(r.swap(q.id).state, 'desk_locked');
  assert.equal(r.swap(q.id).secretRevealed, false);
});

test('idempotence: repeated ticks never lock twice, and a restarted desk on the same store resumes', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { secret, hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await r.user.lockBch(q);
  await r.tick(3);
  const logs = await r.publicClient.getLogs({ address: r.deskLock, fromBlock: 0n, event: { type: 'event', name: 'Locked', inputs: [{ type: 'bytes32', indexed: true, name: 'id' }, { type: 'address', indexed: true, name: 'sender' }, { type: 'address', indexed: true, name: 'recipient' }, { type: 'bytes32', name: 'hashlock' }, { type: 'uint64', name: 'timeout' }, { type: 'uint256', name: 'amount' }] } });
  assert.equal(logs.length, 1);
  const { Desk } = await import('../desk/engine.js');
  const desk2 = new Desk({ cfg: r.cfg, bch: r.bch, evm: r.evm, store: r.store, clock: r.clock });
  await desk2.reveal(q.id, secret);
  assert.equal(desk2.getSwap(q.id).state, 'done');
});

test('the desk id of a Base lock matches the contract (lockId mirrors keccak(abi.encode(...)))', async () => {
  const r = await fresh();
  r.user.fundBch(10_000n);
  const { hashlock } = r.user.secret();
  const q = await r.user.request({ dir: 'bch2base', sendUnits: '100', hashlock });
  await r.user.lockBch(q);
  await r.tick();
  const s = r.swap(q.id);
  const l = await r.evm.lockState(s.evmLockId);
  assert.equal(l.state, LOCK_STATE.Open);
  assert.equal(l.amount, BigInt(s.recvUnits));
  assert.equal(l.recipient, s.userEvm);
});
