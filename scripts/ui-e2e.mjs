// Drives the real web app in the deepsurge browser profile against the dev rig (real chipnet + local anvil), with a
// headless WizardConnect wallet doing the signing. Proves the judge path: pair, quote, one signature, USDC arrives.
// usage: node --env-file=.env scripts/ui-e2e.mjs   (needs scripts/dev-rig.mjs on :8790 and `vite web --port 5199`)
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Network, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http } from 'viem';
import { HeadlessWallet } from './headless-wallet.mjs';
import { ElectrumChain } from '../desk/chains.js';
import { addressesOf } from '../lib/keys.js';
import { NETWORKS } from '../lib/config.js';
import { ERC20_ABI } from '../lib/evm.js';

const UI = process.env.UI_URL ?? 'http://127.0.0.1:5199/';
const DESK = process.env.DESK_URL ?? 'http://127.0.0.1:8790';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const bh = (...args) => execFileSync('bhn', ['deepsurge', ...args], { encoding: 'utf8', timeout: 90000 });
const state = () => JSON.parse(bh('state', 'compact')).state;
const refOf = (st, tag, startsWith) => st.elements.find((e) => e.tag === tag && e.name.startsWith(startsWith))?.ref;
const mainText = () => { try { return JSON.parse(bh('text', 'main', '4000')).text; } catch { return ''; } };
const until = async (what, fn, secs = 120) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if ((Date.now() - t0) / 1000 > secs) throw new Error('timeout: ' + what); await sleep(1500); } };

const status = await (await fetch(DESK + '/api/status')).json();
const net = NETWORKS[status.network];
const category = status.pairs[0].category;
const chain = new ElectrumChain(Network.CHIPNET);
const wallet = new HeadlessWallet(randomBytes(32));
const receive = wallet.address('receive', 0, 'bchtest', true);
log('wallet receive address', receive);

// 1. fund the wallet: faucet sats and test PUSD from the desk
spawnSync('node', ['scripts/chipnet-faucet.mjs', receive, '200000'], { encoding: 'utf8' });
{
  const deskKey = process.env.DESK_BCH_KEY;
  const desk = addressesOf(deskKey);
  const utxos = await chain.getUtxos(desk.chipnet);
  const tok = utxos.filter((u) => u.token?.category === category).sort((a, b) => Number(b.token.amount - a.token.amount))[0];
  const fee = utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  const t = new SignatureTemplate(hexToBin(deskKey));
  const b = new TransactionBuilder({ provider: chain })
    .addInputs([tok, fee], t.unlockP2PKH())
    .addOutput({ to: receive, amount: 1000n, token: { category, amount: 1000n } })
    .addTokenChangeOutputIfNeeded({ category, to: desk.chipnetTokens })
    .addBchChangeOutputIfNeeded({ to: desk.chipnetTokens, feeRate: 1.2 });
  log('desk sent 10.00 test PUSD to the wallet', (await b.send()).txid);
}
await until('wallet funded', async () => { const u = await chain.getUtxos(receive); return u.some((x) => x.token) && u.some((x) => !x.token) ; }, 90);

// 2. open the app in its own tab
bh('open', UI);
await sleep(2500);
bh('eval', "localStorage.clear(); location.reload()");
await sleep(3000);
const tabs = JSON.parse(bh('tabs')).tabs;
const mine = tabs.find((t) => t.url.startsWith(UI.replace(/\/$/, '')));
bh('use', mine.targetId);
const result = { tab: mine.targetId };
try {
  // 3. pair
  await until('desk status in the page', () => /Desk fills up to/.test(mainText()), 40);
  bh('click', refOf(state(), 'button', 'Connect your Bitcoin Cash wallet'));
  const uri = await until('pairing uri', () => (JSON.parse(bh('text', 'dialog', '1500')).text.match(/wiz:\/\/\S+/) ?? [])[0], 30);
  wallet.connect(uri.replace(/&amp;/g, '&'));
  log('paired with the app over WizardConnect');
  await until('wallet paired in the page', () => /Bitcoin Cash wallet paired/.test(mainText()), 90);

  // 4. the Base address that will receive the USDC
  const payee = privateKeyToAccount(generatePrivateKey()).address;
  await until('swap button', () => refOf(state(), 'button', 'Add the Base address') || refOf(state(), 'button', 'Reading your wallet') || refOf(state(), 'button', 'Swap'), 60);
  bh('fill', refOf(state(), 'input', 'Base address'), payee);
  const swapRef = await until('enabled swap button', () => refOf(state(), 'button', 'Swap 0.50 PUSD'), 60);
  log('clicking', JSON.stringify(state().elements.find((e) => e.ref === swapRef).name));
  const t0 = Date.now();
  bh('click', swapRef);
  await until('swap complete', () => /Swap complete|Done in/.test(mainText()), 240);
  result.seconds = (Date.now() - t0) / 1000;
  result.receipt = mainText().split('\n').filter((l) => /\+\d+s|Done in/.test(l) || /locked|paid|claimed|complete/i.test(l)).slice(0, 14);
  result.walletSigned = wallet.signed;

  // 5. the post-condition: the payee holds the USDC, read from the chain
  const pc = createPublicClient({ transport: http(status.evm.rpc ?? 'http://127.0.0.1:8547') });
  result.payee = payee;
  result.payeeUsdc = String(await pc.readContract({ address: status.evm.token, abi: ERC20_ABI, functionName: 'balanceOf', args: [payee] }));
  result.ok = result.payeeUsdc === '498500' && wallet.signed === 1;
} catch (e) {
  result.error = e.message;
} finally {
  wallet.stop();
  try { bh('close', mine.targetId); } catch { /* tab already gone */ }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
