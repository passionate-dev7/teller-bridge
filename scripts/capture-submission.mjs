// Captures the submission screenshots from a local run of the app against the dev rig (real chipnet, local anvil that reports Base Sepolia's chain id).
// usage: node --env-file=.env scripts/capture-submission.mjs   (needs scripts/dev-rig.mjs on DESK_URL, vite web on UI_URL, and a bhn profile named PROFILE)
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Network, TransactionBuilder, SignatureTemplate } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { HeadlessWallet } from './headless-wallet.mjs';
import { ElectrumChain } from '../desk/chains.js';
import { addressesOf } from '../lib/keys.js';

const UI = process.env.UI_URL, DESK = process.env.DESK_URL, P = process.env.PROFILE ?? 'teller-shots';
const OUT = new URL('../submission/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let TAB = null;
const bh = (...args) => {
  if (TAB && !['open', 'tabs', 'use'].includes(args[0])) execFileSync('bhn', [P, 'use', TAB], { encoding: 'utf8', timeout: 30000 });
  return execFileSync('bhn', [P, ...args], { encoding: 'utf8', timeout: 90000 });
};
const state = () => JSON.parse(bh('state', 'compact')).state;
const refOf = (st, tag, startsWith) => st.elements.find((e) => e.tag === tag && e.name.startsWith(startsWith))?.ref;
const mainText = () => { try { return JSON.parse(bh('text', 'main', '4000')).text; } catch { return ''; } };
const until = async (what, fn, secs = 120) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if ((Date.now() - t0) / 1000 > secs) throw new Error('timeout: ' + what); await sleep(1200); } };
const harness = (code) => execFileSync('bh-multi', ['run', P, code], { encoding: 'utf8', timeout: 90000 });
const hide = () => bh('eval', "document.querySelectorAll('.blaze-bar').forEach(e => e.style.display = 'none')");
// the page at its own height, 2x pixel density, so the PNG is the whole content and nothing else
const shot = (name, { w = 1600, full = true, h = 1000, mobile = false } = {}) => {
  hide();
  bh('eval', 'window.scrollTo(0, document.documentElement.scrollHeight); window.scrollTo(0, 0)');
  if (full) h = Math.ceil(Number(JSON.parse(bh('eval', 'document.documentElement.scrollHeight')).result ?? JSON.parse(bh('eval', 'document.documentElement.scrollHeight')).value));
  harness("cdp('Emulation.setDeviceMetricsOverride', width=" + w + ", height=" + h + ", deviceScaleFactor=2, mobile=" + (mobile ? 'True' : 'False') + "); wait(1.6); capture_screenshot('" + OUT + name + "'); print('ok')");
  log('shot', name, w + 'x' + h);
  harness("cdp('Emulation.setDeviceMetricsOverride', width=1600, height=1000, deviceScaleFactor=2, mobile=False); print('ok')");
};

const status = await (await fetch(DESK + '/api/status')).json();
const category = status.pairs[0].category;
const chain = new ElectrumChain(Network.CHIPNET);
const wallet = new HeadlessWallet(randomBytes(32));
const receive = wallet.address('receive', 0, 'bchtest', true);
{ // 10.00 test PUSD and 20000 sats for the wallet, from the desk's confirmed coins
  const deskKey = process.env.DESK_BCH_KEY, desk = addressesOf(deskKey);
  const utxos = await chain.getUtxos(desk.chipnet);
  const tok = utxos.filter((u) => u.token?.category === category).sort((a, b) => Number(b.token.amount - a.token.amount))[0];
  const fee = utxos.filter((u) => !u.token).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  const t = new SignatureTemplate(hexToBin(deskKey));
  const b = new TransactionBuilder({ provider: chain }).addInputs([tok, fee], t.unlockP2PKH())
    .addOutput({ to: receive, amount: 1000n, token: { category, amount: 1000n } }).addOutput({ to: receive, amount: 20000n })
    .addTokenChangeOutputIfNeeded({ category, to: desk.chipnetTokens }).addBchChangeOutputIfNeeded({ to: desk.chipnetTokens, feeRate: 1.2 });
  log('seeded wallet', (await b.send()).txid);
}
await until('wallet funded', async () => { const u = await chain.getUtxos(receive); return u.some((x) => x.token) && u.some((x) => !x.token); }, 90);

bh('open', UI);
await sleep(3000);
const mine = JSON.parse(bh('tabs')).tabs.find((t) => t.url.startsWith(UI.replace(/\/$/, '')));
TAB = mine.targetId;
bh('use', TAB);
bh('eval', 'localStorage.clear(); location.reload()');
await sleep(3500);
harness("cdp('Emulation.setDeviceMetricsOverride', width=1600, height=1000, deviceScaleFactor=2, mobile=False); print('ok')");
try {
  await until('desk status in the page', () => /Desk fills up to \d/.test(mainText()), 60);
  await sleep(1500);
  bh('click', refOf(state(), 'button', 'Connect your Bitcoin Cash wallet'));
  const uri = await until('pairing uri', () => (JSON.parse(bh('text', 'dialog', '1500')).text.match(/wiz:\/\/\S+/) ?? [])[0], 30);
  wallet.connect(uri.replace(/&amp;/g, '&'));
  await until('wallet paired in the page', () => /Bitcoin Cash wallet paired/.test(mainText()), 90);
  const payee = privateKeyToAccount(generatePrivateKey()).address;
  await until('swap button', () => refOf(state(), 'button', 'Add the Base address') || refOf(state(), 'button', 'Reading your wallet') || refOf(state(), 'button', 'Swap'), 60);
  bh('fill', refOf(state(), 'input', 'Base address'), payee);
  const swapRef = await until('enabled swap button', () => refOf(state(), 'button', 'Swap 0.50 PUSD'), 60);
  await sleep(1500);
  shot('02-quote.png');
  bh('click', refOf(state(), 'button', 'Swap 0.50 PUSD') ?? swapRef);
  await until('first legs', () => /\+\d+s/.test(mainText()), 90);
  await sleep(1200);
  shot('03-swap-tracker.png');
  await until('swap complete', () => /Swap complete|Done in/.test(mainText()), 300);
  await sleep(1500);
  shot('04-done.png');
  log('wallet signed', wallet.signed, 'payee', payee);
  bh('click', refOf(state(), 'button', 'New swap'));
  await sleep(2500);
  bh('fill', refOf(state(), 'input', 'Amount to send'), '5000');
  await until('overflow quote', () => /NEAR Intents/.test(mainText()) && !/Loading|Quoting|Asking|Checking/i.test(mainText()), 60).catch((e) => log(e.message));
  await sleep(6000);
  log(mainText().split('\n').filter((l) => /NEAR|Cauldron|route|USDC/i.test(l)).slice(0, 8).join(' | '));
  shot('05-overflow.png');
} catch (e) {
  log('ERROR', e.message);
  try { log(mainText().slice(0, 900).replace(/\n/g, ' | ')); } catch { /* page unreadable */ }
  process.exitCode = 1;
} finally {
  wallet.stop();
  try { harness("cdp('Emulation.clearDeviceMetricsOverride'); print('ok')"); bh('close', TAB); } catch { /* tab already gone */ }
}
