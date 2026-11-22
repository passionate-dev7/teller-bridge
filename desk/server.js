// The desk counterparty service. Run: node --env-file=.env desk/server.js
// Keys come from the environment; nothing here prints or returns them.
import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { Network } from 'cashscript';
import { Desk, DeskError } from './engine.js';
import { Store } from './store.js';
import { BchDesk, EvmDesk, ElectrumChain } from './chains.js';
import { clients } from '../lib/evm.js';
import { NETWORKS, rulesFromEnv } from '../lib/config.js';
import { oneClickQuote } from './overflow.js';

const USDC = { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };

export function buildDesk(env = process.env) {
  const net = NETWORKS[env.NETWORK ?? 'testnet'];
  if (!net) throw new Error('NETWORK must be testnet or mainnet');
  const evmInfo = { ...net.evm, rpc: env.BASE_RPC_URL || net.evm.rpc };
  const dep = JSON.parse(readFileSync((process.env.DEPLOYMENTS_FILE ? new URL('file://' + process.env.DEPLOYMENTS_FILE) : new URL('../deployments.json', import.meta.url)), 'utf8'))[evmInfo.chainId];
  if (!dep?.deskLock) throw new Error('no DeskLock deployment for chain ' + evmInfo.chainId + ': run scripts/deploy-evm.mjs');
  const token = USDC[evmInfo.chainId] ?? dep.token;
  const provider = new ElectrumChain(net.bch.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET, env.BCH_ELECTRUM_HOST ? { hostname: env.BCH_ELECTRUM_HOST } : {});
  const bch = new BchDesk({ provider, prefix: net.bch.prefix, keyHex: env.DESK_BCH_KEY });
  const evm = new EvmDesk({ ...clients(evmInfo, env.DESK_EVM_KEY), deskLock: dep.deskLock, token });
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  const store = new Store(env.DESK_DB ?? new URL('../data/desk-' + net.name + '.sqlite', import.meta.url).pathname);
  const cfg = { name: net.name, bch: net.bch, evm: evmInfo, pairs: net.pairs, rules: rulesFromEnv(env) };
  return { desk: new Desk({ cfg, bch, evm, store, log: (...a) => console.error('[desk]', ...a) }), cfg };
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on('data', (c) => { n += c.length; if (n > 4096) { reject(new DeskError('bad_request', 'body too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new DeskError('bad_request', 'invalid JSON')); } });
});

export function createServer(desk, { oneClick = oneClickQuote } = {}) {
  const hits = new Map();
  const limited = (ip) => { const now = Date.now(); const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000); h.push(now); hits.set(ip, h); return h.length > 120; };
  let statusCache = { at: 0, body: null };
  return http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? 'x';
    try {
      if (req.method === 'OPTIONS') return json(res, 204, {});
      if (limited(ip)) return json(res, 429, { error: 'rate_limited' });
      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/^\/api\/swaps\/([0-9a-f-]{36})(\/reveal)?$/);
      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (Date.now() - statusCache.at > 3000) statusCache = { at: Date.now(), body: await desk.status() };
        return json(res, 200, statusCache.body);
      }
      if (req.method === 'POST' && url.pathname === '/api/swaps') { const s = await desk.createSwap(await readBody(req), ip); statusCache.at = 0; return json(res, 201, s); }
      if (req.method === 'GET' && m && !m[2]) { const s = desk.getSwap(m[1]); return s ? json(res, 200, s) : json(res, 404, { error: 'not_found' }); }
      if (req.method === 'POST' && m && m[2]) { const b = await readBody(req); return json(res, 200, await desk.reveal(m[1], b.secret)); }
      if (req.method === 'GET' && url.pathname === '/api/replays') return json(res, 200, desk.recentDone(20));
      if (req.method === 'GET' && url.pathname === '/api/overflow/quote') return json(res, 200, await oneClick(Object.fromEntries(url.searchParams), desk.cfg));
      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      if (e instanceof DeskError) return json(res, e.code === 'not_found' ? 404 : e.code === 'over_capacity' || e.code === 'conflict' ? 409 : 400, { error: e.code, message: e.message, ...e.extra });
      console.error('[server]', e);
      return json(res, 500, { error: 'internal' });
    }
  });
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const { desk } = buildDesk();
  const approval = await desk.evm.ensureAllowance();
  if (approval) console.error('[desk] approved DeskLock for USDC', approval.hash);
  setInterval(() => desk.tick().catch((e) => console.error('[tick]', e.message)), desk.rules.pollMs);
  const port = Number(process.env.DESK_PORT ?? 8787);
  createServer(desk).listen(port, process.env.DESK_HOST ?? '127.0.0.1', () => console.error('[desk] listening on', port, 'network', desk.cfg.name, 'bch desk', desk.bch.address, 'evm desk', desk.evm.address));
}
