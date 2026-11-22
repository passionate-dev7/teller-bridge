// Overflow lane: what the same swap would return through NEAR Intents 1Click (and Cauldron for the PUSD leg), live.
// Both services are public. The desk only quotes here; the user executes against them directly.
import { PUSD_CATEGORY, MUSD_CATEGORY } from '../lib/config.js';

const ONECLICK = 'https://1click.chaindefuser.com/v0';
const ROUTER = 'wss://router.riften.net/v1/route';
const BCH_ASSET = 'nep141:bch.omft.near';
const USDC_BASE_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
// reference addresses for dry quotes when the caller has not given one yet (1Click validates format only)
const REF_BCH = 'bitcoincash:qpk40ajqg0a2kxxrnqn3xgha6taycv0gusnnq6v6hp';
const REF_EVM = '0x154CB68631f0398cb90cDC460494309ac2981Ab7';
const CATEGORY = { PUSD: PUSD_CATEGORY, MUSD: MUSD_CATEGORY };

export async function routerQuote({ sell, buy, amount, side }, { url = ROUTER, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); reject(new Error('Cauldron router did not answer')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'route.quote', params: { sell, buy, amount: String(amount), side } }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Cauldron router unreachable')); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id !== 1) return;
      clearTimeout(timer); ws.close();
      if (m.error) reject(new Error('Cauldron: ' + (m.error.message ?? m.error.code))); else resolve(m.result);
    };
  });
}

export async function oneClickDry({ originAsset, destinationAsset, amount, recipient, refundTo, jwt = process.env.ONECLICK_JWT }) {
  const r = await fetch(ONECLICK + '/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(jwt ? { authorization: 'Bearer ' + jwt } : {}) },
    body: JSON.stringify({
      dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
      originAsset, destinationAsset, amount: String(amount),
      depositType: 'ORIGIN_CHAIN', refundType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN',
      recipient, refundTo, deadline: new Date(Date.now() + 3 * 3600_000).toISOString(),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('NEAR Intents: ' + (j.message ?? r.status));
  return j.quote;
}

/** query: { dir, pair, sendUnits, baseAddress?, bchAddress? } */
export async function overflowQuote(query) {
  const { dir, pair } = query;
  const category = CATEGORY[pair];
  if (!category || (dir !== 'bch2base' && dir !== 'base2bch')) throw new Error('unsupported pair or direction');
  if (!/^\d{1,15}$/.test(String(query.sendUnits))) throw new Error('sendUnits');
  const send = BigInt(query.sendUnits);
  const evm = /^0x[0-9a-fA-F]{40}$/.test(query.baseAddress ?? '') ? query.baseAddress : REF_EVM;
  const bch = /^bitcoincash:[qp][a-z0-9]{40,}$/.test(query.bchAddress ?? '') ? query.bchAddress : REF_BCH;
  if (dir === 'bch2base') {
    // PUSD -> BCH on Cauldron, then BCH -> USDC on Base through NEAR Intents
    const leg1 = await routerQuote({ sell: category, buy: 'bch', amount: send, side: 'sell' });
    const sats = BigInt(leg1.output_amount ?? 0);
    if (sats <= 0n) throw new Error('Cauldron has no route for that size');
    const leg2 = await oneClickDry({ originAsset: BCH_ASSET, destinationAsset: USDC_BASE_ASSET, amount: sats, recipient: evm, refundTo: bch });
    return { route: [pair + ' to BCH on Cauldron', 'BCH to USDC on Base via NEAR Intents'], estOut: leg2.amountOut, outDecimals: 6, outSymbol: 'USDC', quotedAt: Math.floor(Date.now() / 1000), source: 'Cauldron router and NEAR Intents 1Click (mainnet)', timeEstimate: leg2.timeEstimate ?? null, legs: { cauldronBchSats: sats.toString(), intentsAmountIn: leg2.amountIn } };
  }
  // USDC on Base -> BCH through NEAR Intents, then BCH -> PUSD on Cauldron
  const leg1 = await oneClickDry({ originAsset: USDC_BASE_ASSET, destinationAsset: BCH_ASSET, amount: send, recipient: bch, refundTo: evm });
  const sats = BigInt(leg1.amountOut);
  const leg2 = await routerQuote({ sell: 'bch', buy: category, amount: sats, side: 'sell' });
  return { route: ['USDC on Base to BCH via NEAR Intents', 'BCH to ' + pair + ' on Cauldron'], estOut: leg2.output_amount, outDecimals: 2, outSymbol: pair, quotedAt: Math.floor(Date.now() / 1000), source: 'NEAR Intents 1Click and Cauldron router (mainnet)', timeEstimate: leg1.timeEstimate ?? null, legs: { intentsBchSats: sats.toString() } };
}

export const oneClickQuote = (query) => overflowQuote(query);

/** What 1 PUSD sells for on Cauldron right now, in USD, with its source: Cauldron router sats times the 1Click BCH price. */
export async function pegQuote(category = PUSD_CATEGORY) {
  const [leg, tokens] = await Promise.all([
    routerQuote({ sell: category, buy: 'bch', amount: 100, side: 'sell' }),
    fetch(ONECLICK + '/tokens').then((r) => r.json()),
  ]);
  const bch = tokens.find((t) => t.assetId === BCH_ASSET);
  if (!bch) throw new Error('no BCH price');
  const usd = (Number(leg.output_amount) / 1e8) * bch.price;
  return { symbol: category === PUSD_CATEGORY ? 'PUSD' : 'MUSD', usd: Math.round(usd * 10000) / 10000, bchUsd: bch.price, bchPriceAt: bch.priceUpdatedAt, quotedAt: Math.floor(Date.now() / 1000), source: 'Cauldron router sale of 1.00 PUSD, BCH priced by NEAR Intents' };
}
