// forge build, then export ABI + creation bytecode used by the desk, deploy script and web app.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../contracts/evm/', import.meta.url).pathname;
const r = spawnSync('forge', ['build'], { cwd: dir, encoding: 'utf8', env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: '1' } });
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
for (const name of ['DeskLock', 'TestUSDC']) {
  const j = JSON.parse(readFileSync(dir + 'out/' + name + '.sol/' + name + '.json', 'utf8'));
  writeFileSync(dir + name + '.json', JSON.stringify({ abi: j.abi, bytecode: j.bytecode.object }, null, 1));
  console.log('exported', name);
}
