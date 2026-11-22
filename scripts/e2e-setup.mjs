// Shared rig for the live end-to-end scripts: the real desk service over HTTP, real chipnet (or mainnet) BCH, and a real EVM
// (Base Sepolia, or a local anvil that reports chain id 84532 when E2E_EVM=anvil). A scripted user plays the browser.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Network, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { buildDesk, createServer } from '../desk/server.js';
import { ElectrumChain } from '../desk/chains.js';
import { clients, ERC20_ABI, DESK_LOCK_ABI } from '../lib/evm.js';
import { NETWORKS } from '../lib/config.js';
import { addressesOf } from '../lib/keys.js';
import { lockingBytecodeOf } from '../lib/bch.js';
import { deskApi } from '../lib/client.js';
import testUsdc from '../contracts/evm/TestUSDC.json' with { type: 'json' };
import { privateKeyToAccount } from 'viem/accounts';

export async function setup(extraEnv = {}) {
Object.assign(process.env, extraEnv);
const env = { ...process.env };
const net = NETWORKS[env.NETWORK ?? 'testnet'];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { scenarios: [] };
let anvil;

if (env.E2E_EVM === 'anvil') {
  const port = env.E2E_ANVIL_PORT ?? '8546';
  anvil = spawn('anvil', ['--port', port, '--chain-id', '84532', '--silent'], { stdio: 'ignore' });
  await sleep(1500);
  env.BASE_RPC_URL = 'http://127.0.0.1:' + port;
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  env.DEPLOYMENTS_FILE = join(dir, 'deployments.json');
  writeFileSync(env.DEPLOYMENTS_FILE, '{}');
  for (const k of ['DEPLOYER_EVM_KEY', 'DESK_EVM_KEY', 'TEST_USER_EVM_KEY']) {
    await fetch(env.BASE_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_setBalance', params: [privateKeyToAccount(env[k]).address, '0x8ac7230489e80000'] }) });
  }
  const r = spawnSync('node', ['scripts/deploy-evm.mjs'], { env, encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
  if (r.status !== 0) throw new Error(r.stderr);
}
Object.assign(process.env, { BASE_RPC_URL: env.BASE_RPC_URL ?? '', DEPLOYMENTS_FILE: env.DEPLOYMENTS_FILE ?? '' });
if (!env.BASE_RPC_URL) delete process.env.BASE_RPC_URL;
if (!env.DEPLOYMENTS_FILE) delete process.env.DEPLOYMENTS_FILE;
process.env.DESK_DB = join(mkdtempSync(join(tmpdir(), 'e2e-db-')), 'desk.sqlite');
process.env.POLL_MS = '3000';

const { desk, cfg } = buildDesk(process.env);
const token = desk.evm.token;
const evmInfo = cfg.evm;
const bchNet = net.bch.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
const chain = new ElectrumChain(bchNet);
const userA = addressesOf(env.TEST_USER_BCH_KEY);
const userBchAddr = net.bch.network === 'mainnet' ? userA.mainnet : userA.chipnet;
const userBchLock = lockingBytecodeOf(userBchAddr);
const userEvm = clients(evmInfo, env.TEST_USER_EVM_KEY);
const category = net.pairs[0].category;

// ---- seed: test token and sats for the scripted user (testnets only), USDC for desk and user
const tokensOf = async (addr) => (await chain.getUtxos(addr)).reduce((a, u) => (u.token?.category === category ? a + u.token.amount : a), 0n);
const satsOf = async (addr) => (await chain.getUtxos(addr)).reduce((a, u) => (u.token ? a : a + u.satoshis), 0n);
if (net.name === 'testnet') {
  if ((await satsOf(userBchAddr)) < 30_000n) {
    log('funding scripted user with chipnet sats from the faucet');
    const r = spawnSync('node', ['scripts/chipnet-faucet.mjs', userA.chipnetTokens, '300000'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
    out.userFaucet = r.stdout.trim().slice(0, 400);
  }
  if ((await tokensOf(userBchAddr)) < 3000n) {
    log('desk sends 30.00 test PUSD to the scripted user');
    const key = hexToBin(env.DESK_BCH_KEY);
    const utxos = await chain.getUtxos(desk.bch.address);
    const tok = utxos.filter((u) => u.token?.category === category).sort((a, b) => Number(b.token.amount - a.token.amount))[0];
    const fee = utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
    const t = new SignatureTemplate(key);
    const b = new TransactionBuilder({ provider: chain })
      .addInputs([tok, fee], t.unlockP2PKH())
      .addOutput({ to: userA.chipnetTokens, amount: 1000n, token: { category, amount: 3000n } })
      .addTokenChangeOutputIfNeeded({ category, to: desk.bch.tokenAddress() })
      .addBchChangeOutputIfNeeded({ to: desk.bch.tokenAddress(), feeRate: 1.2 });
    out.seedTokenTx = (await b.send()).txid;
    await sleep(3000);
  }
  const usdcOf = (a) => userEvm.publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [a] });
  const mintIfLow = async (addr, want) => {
    if ((await usdcOf(addr)) >= want) return;
    const h = await userEvm.walletClient.writeContract({ address: token, abi: testUsdc.abi, functionName: 'mint', args: [addr, want] });
    await userEvm.publicClient.waitForTransactionReceipt({ hash: h });
  };
  await mintIfLow(desk.evm.address, 10_000_000n);
  await mintIfLow(userEvm.account.address, 5_000_000n);
}
const userUsdc = () => userEvm.publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [userEvm.account.address] });

// ---- run the desk service
await desk.evm.ensureAllowance();
const tickTimer = setInterval(() => desk.tick().catch((e) => console.error('tick', e.message)), 3000);
const server = createServer(desk);
await new Promise((r) => server.listen(Number(process.env.DESK_PORT ?? 0), '127.0.0.1', r));
const api = deskApi('http://127.0.0.1:' + server.address().port);
const status = await api.status();
log('desk ready', status.ready, 'inventory', JSON.stringify(status.pairs[0].inventory), 'maxSend', JSON.stringify(status.pairs[0].maxSend));
out.status = { ready: status.ready, inventory: status.pairs[0].inventory, maxSend: status.pairs[0].maxSend };


const waitFor = async (id, states, timeoutS = 900) => {
  const t0 = Date.now();
  let last = '';
  while ((Date.now() - t0) / 1000 < timeoutS) {
    const s = await api.swap(id);
    if (s.state !== last) { log('swap', id.slice(0, 8), s.state, s.lastError ?? ''); last = s.state; }
    if (states.includes(s.state)) return s;
    await sleep(2000);
  }
  throw new Error('timeout waiting for ' + states + ' last ' + last);
};
const explorer = { bch: (t) => net.bch.explorerTx + t, evm: (t) => net.evm.explorerTx + t };
const stop = () => { clearInterval(tickTimer); server.close(); anvil?.kill(); };
return { env, net, desk, cfg, token, evmInfo, chain, userA, userBchAddr, userBchLock, userEvm, category, tokensOf, satsOf, userUsdc, api, status, out, log, sleep, waitFor, explorer, stop };
}
