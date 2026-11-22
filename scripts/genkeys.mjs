// Generates deployer / desk EVM keys and the desk BCH key into .env (gitignored). Prints addresses only.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { addressesOf } from '../lib/keys.js';

const ENV = new URL('../.env', import.meta.url);
const text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
const has = (k) => new RegExp('^' + k + '=.+', 'm').test(text);

const out = {};
for (const k of ['DEPLOYER_EVM_KEY', 'DESK_EVM_KEY', 'DESK_BCH_KEY']) {
  if (has(k)) continue;
  const hex = randomBytes(32).toString('hex');
  const line = k + '=' + (k.endsWith('EVM_KEY') ? '0x' : '') + hex + '\n';
  if (new RegExp('^' + k + '=', 'm').test(text)) writeFileSync(ENV, readFileSync(ENV, 'utf8').replace(new RegExp('^' + k + '=.*$', 'm'), line.trim()));
  else appendFileSync(ENV, line);
}
if (!existsSync(ENV)) throw new Error('env write failed');
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => /^[A-Z_]+=.+/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
console.log(JSON.stringify({
  deployerEvm: privateKeyToAccount(env.DEPLOYER_EVM_KEY).address,
  deskEvm: privateKeyToAccount(env.DESK_EVM_KEY).address,
  deskBch: addressesOf(env.DESK_BCH_KEY),
}, null, 2));
