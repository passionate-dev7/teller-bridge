// Mutation check for DeskLock.sol: apply each mutant, run forge test, expect red. Restores the source when done.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('../contracts/evm/', import.meta.url).pathname;
const SRC = dir + 'src/DeskLock.sol';
const original = readFileSync(SRC, 'utf8');
const forge = () => spawnSync('forge', ['test'], { cwd: dir, encoding: 'utf8', env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: '1' } });

const mutants = [];
original.split('\n').forEach((line, i) => {
  if (/^\s*require\(/.test(line)) mutants.push({ name: 'line ' + (i + 1) + ' guard removed: ' + line.trim(), apply: (s) => s.split('\n').map((l, j) => (j === i ? l.replace(/require\([^;]*,\s*("[^"]*")\);/, 'require(true, $1);') : l)).join('\n') });
});
const sub = (name, from, to) => mutants.push({ name, apply: (s) => { if (!s.includes(from)) throw new Error('mutant anchor missing: ' + from); return s.replace(from, to); } });
sub('claim deadline < becomes <=', 'block.timestamp < l.timeout', 'block.timestamp <= l.timeout');
sub('refund time >= becomes >', 'block.timestamp >= l.timeout', 'block.timestamp > l.timeout');
sub('lock timeout > becomes >=', 'timeout > block.timestamp', 'timeout >= block.timestamp');
sub('claim does not close the lock', 'l.state = State.Claimed;', '');
sub('refund does not close the lock', 'l.state = State.Refunded;', '');
sub('claim pays the caller, not the recipient', 'abi.encodeCall(IERC20.transfer, (l.recipient, l.amount))', 'abi.encodeCall(IERC20.transfer, (msg.sender, l.amount))');
sub('refund pays the caller, not the sender', 'abi.encodeCall(IERC20.transfer, (l.sender, l.amount))', 'abi.encodeCall(IERC20.transfer, (msg.sender, l.amount))');
sub('claim pays one unit short', 'abi.encodeCall(IERC20.transfer, (l.recipient, l.amount))', 'abi.encodeCall(IERC20.transfer, (l.recipient, l.amount - 1))');
sub('hashlock uses keccak256 instead of sha256', 'sha256(abi.encodePacked(secret))', 'keccak256(abi.encodePacked(secret))');

const rows = [{ mutant: 'ORIGINAL', verdict: forge().status === 0 ? 'green' : 'RED (unexpected)' }];
try {
  for (const m of mutants) {
    writeFileSync(SRC, m.apply(original));
    const r = forge();
    const out = r.stdout + r.stderr;
    rows.push({ mutant: m.name, verdict: r.status === 0 ? 'SURVIVED' : 'killed', failed: (out.match(/(\d+) failed/) ?? [])[1] ?? 'compile error' });
  }
} finally {
  writeFileSync(SRC, original);
}
console.table(rows);
if (rows.some((r) => r.verdict === 'SURVIVED' || r.verdict.startsWith('RED'))) process.exit(1);
