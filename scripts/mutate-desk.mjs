// Mutation check for the desk engine: each mutant breaks one money-path rule (a refund, a timeout, a margin, a guard)
// and the desk test suite must go red. Runs on a throwaway copy of the repo, so the working tree is never touched.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const WORKERS = Number(process.env.MUTATE_WORKERS ?? 4);
const TESTS = ['test/desk.test.js', 'test/client.test.js', 'test/wizard.test.js', 'test/security.test.js'];
const REL = { engine: 'desk/engine.js', client: 'lib/client.js', bch: 'lib/bch.js', wizard: 'lib/wizard.js', config: 'lib/config.js', chains: 'desk/chains.js', server: 'desk/server.js' };

/** a throwaway copy of the repo: the working tree is never touched, and each worker mutates its own copy */
function copy() {
  const work = mkdtempSync(join(tmpdir(), 'desk-mut-'));
  for (const d of ['desk', 'lib', 'contracts', 'test', 'package.json']) cpSync(join(root, d), join(work, d), { recursive: true, filter: (p) => !p.includes('/contracts/evm/lib') && !p.includes('/contracts/evm/out') });
  symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'));
  const originals = Object.fromEntries(Object.entries(REL).map(([k, f]) => [k, readFileSync(join(work, f), 'utf8')]));
  return { work, originals };
}
const run = (work) => new Promise((resolve) => {
  let out = '';
  const p = spawn('node', ['--test', ...TESTS], { cwd: work });
  p.stdout.on('data', (d) => { out += d; });
  // a mutant that makes the engine wait forever counts as caught, but only after the suite has had ten minutes
  const timer = setTimeout(() => { out += '\nℹ fail 1 (timed out)\n'; p.kill('SIGKILL'); }, 600_000);
  p.on('close', (code) => { clearTimeout(timer); resolve({ status: code ?? 1, stdout: out }); });
});

const M = [
  ['bch2base: desk never refunds its USDC at the Base timeout', "if (l.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {", 'if (false) {'],
  ['bch2base: desk refunds its USDC before the Base timeout', "if (l.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {", 'if (l.state === LOCK_STATE.Open && evmNow >= s.evmTimeout - 4000) {'],
  ['bch2base: user BCH refund relayed before the median time reaches refundTime', "if ((await this.bch.mtp()) >= s.bchRefundTime) {", 'if (true) {'],
  ['bch2base: user BCH refund never relayed', "if ((await this.bch.mtp()) >= s.bchRefundTime) {", 'if (false) {'],
  ['bch2base: lock after quote expiry is answered anyway', "if (s.state === 'expired' || now > s.quoteExpiry) { s.note = 'funded after the quote expired; refund is released at '", "if (false) { s.note = 'funded after the quote expired; refund is released at '"],
  ['bch2base: no safety margin before the BCH refund time', "if (s.bchRefundTime - evmNow < this.rules.overlap + MIN_LEFT)", 'if (false)'],
  ['bch2base: large mempool locks are answered before a confirmation', "if (BigInt(s.sendUnits) > this.rules.zeroConfMaxCents && (await this.bch.confirmations(s.txs.userLock)) < 1) return;", ''],
  ['bch2base: desk locks USDC it does not hold', "if (usdc < BigInt(s.recvUnits)) {", 'if (false) {'],
  ['bch2base: the user is never paid on reveal', "evmNow < s.evmTimeout && s.secretVia === 'reveal')", "evmNow < s.evmTimeout && false)"],
  ['base2bch: no safety margin before the Base timeout', "if (s.evmTimeout - evmNow < this.rules.evmOverlap + MIN_LEFT)", 'if (false)'],
  ['base2bch: desk locks a stable it does not hold', "if ((await this.bch.tokenBalance(s.category)) < BigInt(s.recvUnits))", 'if (false)'],
  ['base2bch: desk refunds its BCH lock before the refund time', "if (utxos.length && (await this.bch.mtp()) >= s.bchRefundTime)", 'if (utxos.length)'],
  ['base2bch: desk never refunds its BCH lock', "if (utxos.length && (await this.bch.mtp()) >= s.bchRefundTime)", 'if (false)'],
  ['base2bch: user USDC refund relayed before the Base timeout', "if (userLock.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {", 'if (userLock.state === LOCK_STATE.Open) {'],
  ['base2bch: user USDC refund never relayed', "if (userLock.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {", 'if (false) {'],
  ['base2bch: the user is never paid on reveal', "if (utxos.length && s.secretVia === 'reveal') {", 'if (false) {'],
  ['base2bch: lock after quote expiry is answered anyway', "if (s.state === 'expired' || now > s.quoteExpiry) { s.note = 'funded after the quote expired; refund is released at ' + s.evmTimeout;", "if (false) { s.note = 'funded after the quote expired; refund is released at ' + s.evmTimeout;"],
  ['reveal accepts any secret', "sha256Hex(sec) !== s.hashlock", 'false'],
  ['reveal accepted before the desk has locked', "if (s.state !== 'desk_locked') throw", "if (false) throw"],
  ['quotes ignore desk capacity', "if (!cap.ready || send > max)", 'if (false)'],
  ['a seen lock reserves no inventory', "const RESERVING = ['user_locked'];", 'const RESERVING = [];'],
  ['quotes reserve inventory again', "const RESERVING = ['user_locked'];", "const RESERVING = ['quoted', 'user_locked'];"],
  ['quote lifetime back to ten minutes', "quoteTtl: 60,", 'quoteTtl: 600,', 'config'],
  ['per-address cap counts only open quotes', "if (active.filter((s) => s.ip === ip).length >= this.rules.maxActivePerIp) throw", "if (active.filter((s) => s.ip === ip && s.state === 'quoted').length >= this.rules.maxActivePerIp) throw"],
  ['quotes never expire', "if (s.state === 'quoted' && now > s.quoteExpiry) return this.#move(s, 'expired');", ''],
  ['hashlock reuse allowed', "if (this.store.byHashlock(hashlock)) throw", 'if (false) throw'],
  ['minimum swap not enforced', "if (cents < minCents)", 'if (false)'],
  ['wallet transactions priced below the relay minimum fee rate', "export const FEE_RATE = 1.2;", 'export const FEE_RATE = 0.5;', 'bch'],
  ['wallet is asked to sign without the token data of its coins', "const sourceOutputs = wc.sourceOutputs.map((so) => sourceOutputToRelay(so));", 'const sourceOutputs = wc.sourceOutputs.map((so) => sourceOutputToRelay({ ...so, token: undefined }));', 'wizard'],
  ['wallet signs inputs it cannot map to its own paths', "if (!m) throw new Error('input ' + n + ' is not a coin of the connected wallet');", '', 'wizard'],
  ['reveal gate: no check that the desk Base lock is open', "if (l.state !== LOCK_STATE.Open) return no('no open lock on Base');", '', 'client'],
  ['reveal gate: lock may be made by anyone', "if (l.sender.toLowerCase() !== pin.deskEvm.toLowerCase()) return no('lock was not made by the desk account');", '', 'client'],
  ['reveal gate: lock may pay another recipient', "if (l.recipient.toLowerCase() !== swap.userEvm.toLowerCase()) return no('lock does not pay your address');", '', 'client'],
  ['reveal gate: lock may hold less than the quote', "if (BigInt(l.amount) !== recv) return no('lock holds a different amount');", '', 'client'],
  ['reveal gate: lock may use another hashlock', "if (l.hashlock.toLowerCase() !== '0x' + swap.hashlock) return no('lock uses a different hashlock');\n    if (lockId({ sender: l.sender, recipient: l.recipient, hashlock: swap.hashlock, timeout: l.timeout, amount: l.amount }) !== swap.evmLockId) return no('lock id does not match its terms');", '', 'client'],
  ['reveal gate: Base lock may outlive the BCH refund margin', "if (l.timeout > swap.bchRefundTime - status.windows.overlap) return no('lock outlives the margin before your BCH refund opens');", '', 'client'],
  ['reveal gate: Base lock may be about to expire', "if (l.timeout - now < REVEAL_MARGIN) return no('lock is too close to expiry to claim in time');", '', 'client'],
  ['reveal gate: BCH refund may open right before the Base refund', "if (swap.bchRefundTime > swap.evmTimeout - status.windows.evmOverlap) return no('BCH refund opens too close to your Base refund');", '', 'client'],
  ['reveal gate: BCH lock may be unconfirmed', "if ((await reads.confirmations(u.txid)) < 1) return no('BCH lock is not confirmed yet');", '', 'client'],
  ['reveal gate: BCH lock may be for less than the quote', "x.token.amount >= recv &&", 'true &&', 'client'],
  ['pin: a different DeskLock is accepted', "if (!eq(status.evm.deskLock, pin.deskLock)) bad.push", 'if (false) bad.push', 'client'],
  ['pin: a different token is accepted', "if (!eq(status.evm.token, pin.token)) bad.push", 'if (false) bad.push', 'client'],
  ['pin: a different desk account is accepted', "if (!eq(status.evm.deskAddress, pin.deskEvm)) bad.push", 'if (false) bad.push', 'client'],
  ['pin: a different BCH desk script is accepted', "if (!eq(status.bch.deskLock, pin.deskBchLock)) bad.push", 'if (false) bad.push', 'client'],
  ['pin: an unpinned build trusts the server', "if (!pin) return ['this build has no pinned desk for chain ' + status?.evm?.chainId];", '', 'client'],
  ['0-conf limit raised above what the desk can afford to lose', "zeroConfMaxCents: 100n,", 'zeroConfMaxCents: 2500n,', 'config'],
  ['bch2base: swap booked done although the user lock vanished', "if (await this.bch.findSecret(s)) return this.#move(s, 'done', 'done');", "return this.#move(s, 'done', 'done');"],
  ['base2bch: swap booked done although the user USDC lock is gone', "return this.#move(s, 'loss', 'usdc_lock_gone');", "return this.#move(s, 'done', 'done');"],
  ['base2bch: refund_wait stops reading the BCH lock', "      if (s.txs.deskLock) {\n        if (!s.secret) {", "      if (false) {\n        if (!s.secret) {"],
  ['base2bch: a claim seen too late is not booked as a loss', "          this.log('LOSS', s.id, s.note);\n          return this.#move(s, 'loss', 'usdc_lock_gone');", "          s.txs.skipped = 1;"],
  ['forwarded-for believed from any peer', ".test(peer)) return peer;", ".test(peer) && false) return peer;", 'server'],
  ['forwarded-for: the client-chosen entry is used', "list[list.length - hops]", "list[0]", 'server'],
  ['rate limiter map grows without bound', "if (hits.size > maxKeys) for", "if (false) for", 'server'],
  ['rate limiter never forgets a client', "now - t < windowMs", "true", 'server'],
  ['Base log cursor is not kept before broadcasting', "        s.evmLockBlock = await this.evm.blockNumber();\n        this.store.save(s);\n", ""],
  ['peg: a price more than 1 percent off par is quoted', "if (!(Math.abs(hit.usd - 1) <= 0.01))", "if (false)"],
  ['peg: an unreadable price is quoted (fails open)', "catch { throw new DeskError('peg', 'the ' + symbol + ' price cannot be read right now, try again shortly'); }", "catch { hit = { at: now, usd: 1 }; }"],
  ['startup: a DeskLock holding another token is accepted', "if (held.toLowerCase() !== this.token.toLowerCase()) throw", "if (false) throw", 'chains'],
  ['client accepts a different hashlock', "if (q.hashlock !== req.hashlock) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts a different send amount', "if (q.sendUnits !== String(req.sendUnits)) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts a refund or recipient script that is not the wallet', "if (q.userBchLock !== req.userBchLock) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts another Base address', "if (q.userEvm.toLowerCase() !== req.userEvm.toLowerCase()) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts an off-rate receive amount', "if (BigInt(q.recvUnits) !== want) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts a short BCH refund time', "if (q.bchRefundTime < minRefund) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts a short Base refund time', "if (q.evmTimeout < nowSec + status.windows.userEvmWindow - 10 * 60) bad.push", 'if (false) bad.push', 'client'],
  ['client trusts the desk lock address string', "if (bchContractFromQuote(q, status, provider).tokenAddress !== q.bchLockAddress) bad.push", 'if (false) bad.push', 'client'],
  ['client accepts a Base lock id that does not follow from the terms', "if (id !== q.evmLockId) bad.push", 'if (false) bad.push', 'client'],
];


// MUTATE_LOG keeps each finished mutant on disk, so an interrupted run resumes where it stopped
const LOG = process.env.MUTATE_LOG;
const rows = new Array(M.length + 1);
const done = new Set();
if (LOG && existsSync(LOG)) for (const l of readFileSync(LOG, 'utf8').split('\n').filter(Boolean)) { const { i, row } = JSON.parse(l); if (M[i - 1]?.[0] === row.mutant || i === 0) { rows[i] = row; done.add(i); } }
const record = (i, row) => { rows[i] = row; if (LOG) appendFileSync(LOG, JSON.stringify({ i, row }) + '\n'); };
if (!done.has(0)) {
  const base = copy();
  const b = await run(base.work);
  record(0, { mutant: 'ORIGINAL', verdict: b.status === 0 ? 'green' : 'RED (unexpected)', failed: '' });
}
let next = 0;
const worker = async () => {
  const { work, originals } = copy();
  for (;;) {
    const i = next++;
    if (i >= M.length) return;
    if (done.has(i + 1)) continue;
    const [name, from, to, which = 'engine'] = M[i];
    const original = originals[which];
    if (!original.includes(from)) { record(i + 1, { mutant: name, verdict: 'ANCHOR MISSING', failed: '' }); continue; }
    writeFileSync(join(work, REL[which]), original.replace(from, () => to));
    const r = await run(work);
    writeFileSync(join(work, REL[which]), original);
    record(i + 1, { mutant: name, verdict: r.status === 0 ? 'SURVIVED' : 'killed', failed: (r.stdout.match(/^ℹ fail (\d+)/m) ?? [])[1] });
  }
};
await Promise.all(Array.from({ length: WORKERS }, worker));
console.table(rows);
if (rows.some((r) => ['SURVIVED', 'ANCHOR MISSING'].includes(r.verdict) || r.verdict.startsWith('RED'))) process.exit(1);
