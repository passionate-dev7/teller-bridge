// Mutation check for the desk engine: each mutant breaks one money-path rule (a refund, a timeout, a margin, a guard)
// and the desk test suite must go red. Runs on a throwaway copy of the repo, so the working tree is never touched.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'desk-mut-'));
for (const d of ['desk', 'lib', 'contracts', 'test', 'package.json']) cpSync(join(root, d), join(work, d), { recursive: true, filter: (p) => !p.includes('/contracts/evm/lib') && !p.includes('/contracts/evm/out') });
symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'));
const ENGINE = join(work, 'desk/engine.js');
const original = readFileSync(ENGINE, 'utf8');

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
  ['quotes reserve no inventory', "const RESERVING = ['quoted', 'user_locked'];", 'const RESERVING = [];'],
  ['quotes never expire', "if (s.state === 'quoted' && now > s.quoteExpiry) return this.#move(s, 'expired');", ''],
  ['hashlock reuse allowed', "if (this.store.byHashlock(hashlock)) throw", 'if (false) throw'],
  ['minimum swap not enforced', "if (cents < minCents)", 'if (false)'],
];

const rows = [];
const run = () => spawnSync('node', ['--test', 'test/desk.test.js'], { cwd: work, encoding: 'utf8' });
const base = run();
rows.push({ mutant: 'ORIGINAL', verdict: base.status === 0 ? 'green' : 'RED (unexpected)', failed: '' });
for (const [name, from, to] of M) {
  if (!original.includes(from)) { rows.push({ mutant: name, verdict: 'ANCHOR MISSING', failed: '' }); continue; }
  writeFileSync(ENGINE, original.replace(from, () => to));
  const r = run();
  rows.push({ mutant: name, verdict: r.status === 0 ? 'SURVIVED' : 'killed', failed: (r.stdout.match(/^ℹ fail (\d+)/m) ?? [])[1] });
}
console.table(rows);
if (rows.some((r) => ['SURVIVED', 'ANCHOR MISSING'].includes(r.verdict) || r.verdict.startsWith('RED'))) process.exit(1);
