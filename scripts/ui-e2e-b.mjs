// Browser end-to-end of USDC -> PUSD: the real app in the deepsurge profile, a Base wallet injected as window.ethereum that
// forwards to the local anvil (impersonating a funded account), the real desk and real chipnet. usage: node --env-file=.env scripts/ui-e2e-b.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Network } from 'cashscript';
import { encodeFunctionData } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { HeadlessWallet } from './headless-wallet.mjs';
import { ElectrumChain } from '../desk/chains.js';
import testUsdc from '../contracts/evm/TestUSDC.json' with { type: 'json' };

const UI = process.env.UI_URL ?? 'http://127.0.0.1:5199/';
const DESK = process.env.DESK_URL ?? 'http://127.0.0.1:8790';
const RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8547';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const bh = (...args) => execFileSync('bhn', ['deepsurge', ...args], { encoding: 'utf8', timeout: 90000 });
const state = () => JSON.parse(bh('state', 'compact')).state;
const refOf = (st, tag, startsWith) => st.elements.find((e) => e.tag === tag && e.name.startsWith(startsWith))?.ref;
const mainText = () => { try { return JSON.parse(bh('text', 'main', '4000')).text; } catch { return ''; } };
const until = async (what, fn, secs = 120) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if ((Date.now() - t0) / 1000 > secs) throw new Error('timeout: ' + what); await sleep(1500); } };
const rpc = async (method, params) => { const j = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json(); if (j.error) throw new Error(method + ': ' + j.error.message); return j.result; };

const status = await (await fetch(DESK + '/api/status')).json();
const category = status.pairs[0].category;
const chain = new ElectrumChain(Network.CHIPNET);
const payeeWallet = new HeadlessWallet(randomBytes(32));
const payee = payeeWallet.address('receive', 0, 'bchtest', true);
const baseUser = privateKeyToAccount(generatePrivateKey()).address;
await rpc('anvil_setBalance', [baseUser, '0x8ac7230489e80000']);
await rpc('anvil_impersonateAccount', [baseUser]);
await rpc('eth_sendTransaction', [{ from: baseUser, to: status.evm.token, data: encodeFunctionData({ abi: testUsdc.abi, functionName: 'mint', args: [baseUser, 3_000_000n] }) }]);
log('Base user', baseUser, 'holds 3 test USDC; BCH payee', payee);

bh('open', UI + '?dir=base2bch&amount=0.50');
await sleep(2500);
bh('eval', "localStorage.clear(); location.reload()");
await sleep(3000);
const mine = JSON.parse(bh('tabs')).tabs.find((t) => t.url.startsWith(UI.replace(/\/$/, '')));
bh('use', mine.targetId);
const result = { tab: mine.targetId };
try {
  await until('desk status in the page', () => /Desk fills up to/.test(mainText()), 40);
  // a browser wallet that forwards to anvil, standing in for MetaMask
  bh('eval', `(() => { const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['${baseUser}'];
    const r = await fetch('${RPC}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
    const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code }); return j.result; },
    on() {}, removeListener() {} };
    const detail = Object.freeze({ info: { uuid: 'anvil-test-wallet', name: 'Anvil Test Wallet', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E', rdns: 'local.anvil' }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.addEventListener('eip6963:requestProvider', announce); announce(); return 'announced'; })()`);
  // a real extension in this profile may have auto-reconnected: drop it so only the test wallet is used
  const dis = refOf(state(), 'button', 'Disconnect');
  if (dis) { bh('click', dis); await sleep(1500); }
  bh('fill', refOf(state(), 'input', 'Bitcoin Cash address'), payee);
  const connect = await until('connect button', () => refOf(state(), 'button', 'Anvil Test Wallet'), 20);
  bh('click', connect);
  const swapRef = await until('enabled swap button', () => refOf(state(), 'button', 'Swap 0.50 USDC'), 60);
  log('clicking', JSON.stringify(state().elements.find((e) => e.ref === swapRef).name));
  const t0 = Date.now();
  bh('click', swapRef);
  await until('swap complete', () => /Swap complete|Done in/.test(mainText()), 150);
  result.seconds = (Date.now() - t0) / 1000;
  result.receipt = mainText().split('\n').filter((l) => /\+\d+s|Done in/.test(l) || /locked|paid|claimed|complete/i.test(l)).slice(0, 14);
  await sleep(3000);
  const utxos = await chain.getUtxos(payee);
  result.payeePusdUnits = String(utxos.reduce((s, u) => (u.token?.category === category ? s + u.token.amount : s), 0n));
  result.ok = result.payeePusdUnits === '49';
} catch (e) {
  result.error = e.message;
  try { result.page = mainText().slice(0, 1800); } catch { /* page gone */ }
} finally {
  if (!result.error) { try { bh('close', mine.targetId); } catch { /* gone */ } }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
