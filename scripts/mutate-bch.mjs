// Mutation check for SwapLock.cash: neutralise each require in turn, recompile, run the contract tests, expect red.
// Restores the real artifact when done. Exit 1 if any mutant survives.
import { compileString } from 'cashc';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SRC = new URL('../contracts/bch/SwapLock.cash', import.meta.url).pathname;
const ART = new URL('../contracts/bch/SwapLock.artifact.json', import.meta.url).pathname;
const original = readFileSync(ART, 'utf8');
const lines = readFileSync(SRC, 'utf8').split('\n');
const rows = [];
try {
  const base = spawnSync('node', ['--test', 'test/bch-contract.test.js'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
  rows.push({ mutant: 'ORIGINAL', exit: base.status, verdict: base.status === 0 ? 'green' : 'RED (unexpected)' });
  lines.forEach((line, i) => {
    if (!/^\s*require\(/.test(line)) return;
    const mutated = lines.map((l, j) => (j === i ? l.replace(/require\(.*\);/, 'require(true);') : l)).join('\n');
    writeFileSync(ART, JSON.stringify(compileString(mutated), null, 2));
    const r = spawnSync('node', ['--test', 'test/bch-contract.test.js'], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' });
    const failed = (r.stdout.match(/^ℹ fail (\d+)/m) ?? [])[1];
    rows.push({ mutant: 'line ' + (i + 1) + ': ' + line.trim(), exit: r.status, failedTests: failed, verdict: r.status === 0 ? 'SURVIVED' : 'killed' });
  });
} finally {
  writeFileSync(ART, original);
}
console.table(rows);
if (rows.some((r) => r.verdict === 'SURVIVED' || r.verdict.startsWith('RED'))) process.exit(1);
