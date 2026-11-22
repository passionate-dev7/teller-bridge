// The desk: quotes, reserves inventory, and walks every swap through its hash-timelock state machine.
// Chain state is read before every action, so a crash or a repeated tick never sends a second lock or claim.
import { randomUUID } from 'node:crypto';
import { isAddress, getAddress } from 'viem';
import { sha256Hex, lockingBytecodeOf, LOCK_SATS, MAX_FEE } from '../lib/bch.js';
import { LOCK_STATE } from '../lib/evm.js';
import { bchToBaseOut, baseToBchOut, maxBchSend, maxUsdcSend } from '../lib/amounts.js';
import { RATIO } from '../lib/config.js';

export const ACTIVE = ['quoted', 'user_locked', 'desk_locked', 'refund_wait'];
const WATCH = [...ACTIVE, 'expired'];
const RESERVING = ['quoted', 'user_locked'];
/** margin before a lock's timeout below which the desk will not start the second leg (seconds) */
const MIN_LEFT = 15 * 60;

export class DeskError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

const isHex = (s, n) => typeof s === 'string' && new RegExp('^[0-9a-f]{' + n + '}$').test(s);

export class Desk {
  constructor({ cfg, bch, evm, store, clock = () => Math.floor(Date.now() / 1000), log = () => {} }) {
    Object.assign(this, { cfg, bch, evm, store, clock, log });
    this.rules = cfg.rules;
    this.busy = false;
    this.locks = new Map();
  }

  /** One swap is only ever advanced by one caller at a time (tick and reveal both reach the same record). */
  #locked(id, fn) {
    const next = (this.locks.get(id) ?? Promise.resolve()).then(fn);
    this.locks.set(id, next.catch(() => {}));
    return next;
  }

  // ---------- inventory and capacity ----------

  async capacity() {
    const now = this.clock();
    const live = this.store.inStates(RESERVING).filter((s) => s.state === 'user_locked' || s.quoteExpiry > now);
    const usdcReserved = live.filter((s) => s.dir === 'bch2base').reduce((a, s) => a + BigInt(s.recvUnits), 0n);
    const [usdc, eth, sats] = await Promise.all([this.evm.usdcBalance(), this.evm.ethBalance(), this.bch.plainSats()]);
    const reasons = [];
    if (eth < this.rules.minGasWei) reasons.push('desk is low on Base gas');
    if (sats < this.rules.minSats) reasons.push('desk is low on BCH for fees');
    const usdcAvail = usdc > usdcReserved ? usdc - usdcReserved : 0n;
    const pairs = [];
    for (const p of this.cfg.pairs) {
      const bchBal = await this.bch.tokenBalance(p.category);
      const reserved = live.filter((s) => s.dir === 'base2bch' && s.pair === p.symbol).reduce((a, s) => a + BigInt(s.recvUnits), 0n);
      const bchAvail = bchBal > reserved ? bchBal - reserved : 0n;
      const ok = reasons.length === 0;
      pairs.push({
        symbol: p.symbol, label: p.label, category: p.category,
        inventory: { bchUnits: bchBal.toString(), usdcUnits: usdc.toString() },
        available: { bchUnits: bchAvail.toString(), usdcUnits: usdcAvail.toString() },
        // what a user may send right now, in the sender's own units
        maxSend: {
          bch2base: (ok ? maxBchSend(usdcAvail, this.rules.feeBps) : 0n).toString(),
          base2bch: (ok ? maxUsdcSend(bchAvail, this.rules.feeBps) : 0n).toString(),
        },
      });
    }
    return { ready: reasons.length === 0, reasons, pairs };
  }

  async status() {
    const cap = await this.capacity();
    return {
      network: this.cfg.name,
      now: this.clock(),
      ready: cap.ready,
      reasons: cap.reasons,
      feeBps: Number(this.rules.feeBps),
      minUsdCents: Number(this.rules.minUsdCents),
      quoteTtl: this.rules.quoteTtl,
      bch: { ...this.cfg.bch, deskAddress: this.bch.tokenAddress(), deskLock: this.bch.lockingHex },
      evm: { ...this.cfg.evm, deskLock: this.evm.deskLock, token: this.evm.token, deskAddress: this.evm.address },
      windows: { userBchWindow: this.rules.userBchWindow, deskEvmWindow: this.rules.deskEvmWindow, userEvmWindow: this.rules.userEvmWindow, deskBchWindow: this.rules.deskBchWindow },
      pairs: cap.pairs,
    };
  }

  // ---------- quotes ----------

  async createSwap(req, ip = 'local') {
    const dir = req.dir;
    if (dir !== 'bch2base' && dir !== 'base2bch') throw new DeskError('bad_request', 'dir must be bch2base or base2bch');
    const pair = this.cfg.pairs.find((p) => p.symbol === req.pair);
    if (!pair) throw new DeskError('bad_request', 'unknown pair');
    const hashlock = String(req.hashlock ?? '').toLowerCase();
    if (!isHex(hashlock, 64)) throw new DeskError('bad_request', 'hashlock must be 32 bytes hex');
    if (this.store.byHashlock(hashlock)) throw new DeskError('bad_request', 'hashlock already used');
    let userBchLock;
    try {
      if (!String(req.userBchAddress).startsWith(this.cfg.bch.prefix + ':')) throw new Error('prefix');
      userBchLock = lockingBytecodeOf(req.userBchAddress);
    } catch { throw new DeskError('bad_request', 'userBchAddress is not a valid ' + this.cfg.bch.prefix + ' address'); }
    if (!/^76a914[0-9a-f]{40}88ac$/.test(userBchLock)) throw new DeskError('bad_request', 'userBchAddress must be a plain wallet (P2PKH) address');
    if (!isAddress(req.userEvm, { strict: false })) throw new DeskError('bad_request', 'userEvm is not an address');
    let send;
    try { send = BigInt(req.sendUnits); } catch { throw new DeskError('bad_request', 'sendUnits must be an integer string'); }
    if (send <= 0n) throw new DeskError('bad_request', 'sendUnits must be positive');
    if (dir === 'base2bch' && send % RATIO !== 0n) throw new DeskError('bad_request', 'send a whole number of cents');
    const minCents = this.rules.minUsdCents;
    const cents = dir === 'bch2base' ? send : send / RATIO;
    if (cents < minCents) throw new DeskError('below_min', 'minimum swap is ' + (Number(minCents) / 100).toFixed(2) + ' USD', { minUsdCents: Number(minCents) });
    const recv = dir === 'bch2base' ? bchToBaseOut(send, this.rules.feeBps) : baseToBchOut(send, this.rules.feeBps);
    if (recv <= 0n) throw new DeskError('below_min', 'amount too small');

    const active = this.store.inStates(ACTIVE);
    if (active.length >= this.rules.maxActive) throw new DeskError('busy', 'desk has too many open swaps, try again shortly');
    if (active.filter((s) => s.ip === ip && s.state === 'quoted').length >= this.rules.maxActivePerIp) throw new DeskError('busy', 'too many open quotes from your address');

    const cap = await this.capacity();
    const pc = cap.pairs.find((p) => p.symbol === pair.symbol);
    const max = BigInt(pc.maxSend[dir]);
    if (!cap.ready || send > max) throw new DeskError('over_capacity', cap.ready ? 'above what the desk holds right now' : cap.reasons.join(', '), { maxSend: max.toString(), reasons: cap.reasons, overflow: true });

    const now = this.clock();
    const s = {
      id: randomUUID(), dir, pair: pair.symbol, category: pair.category, hashlock, ip,
      userBchLock, userBchAddress: req.userBchAddress, userEvm: getAddress(req.userEvm),
      sendUnits: send.toString(), recvUnits: recv.toString(), feeBps: Number(this.rules.feeBps),
      createdAt: now, quoteExpiry: now + this.rules.quoteTtl,
      state: 'quoted', secret: null, secretVia: null, txs: {}, events: [], lastError: null,
    };
    if (dir === 'bch2base') s.bchRefundTime = now + this.rules.userBchWindow;
    else { s.evmTimeout = now + this.rules.userEvmWindow; s.evmLockId = this.evm.lockId({ sender: s.userEvm, recipient: this.evm.address, hashlock, timeout: s.evmTimeout, amount: send }); }
    this.#ev(s, 'quoted');
    this.store.insert(s);
    return this.view(s);
  }

  view(s) {
    const { secret, ip, ...rest } = s;
    const out = { ...rest, secretRevealed: !!secret, deskBchAddress: this.bch.address };
    if (s.dir === 'bch2base' || s.bchRefundTime) {
      try { out.bchLockAddress = this.bch.contract(s).tokenAddress; } catch { /* no params yet */ }
    }
    return out;
  }

  getSwap(id) { const s = this.store.get(id); return s ? this.view(s) : null; }

  recentDone(limit = 20) {
    return this.store.recent(['done'], limit).map((s) => this.view(s));
  }

  reveal(id, secret) {
    return this.#locked(id, async () => {
      const s = this.store.get(id);
      if (!s) throw new DeskError('not_found', 'no such swap');
      const sec = String(secret).toLowerCase();
      if (!isHex(sec, 64) || sha256Hex(sec) !== s.hashlock) throw new DeskError('bad_request', 'secret does not match the hashlock');
      if (s.state !== 'desk_locked') throw new DeskError('conflict', 'swap is ' + s.state + ', the desk has not locked its side yet');
      s.secret = sec;
      s.secretVia = 'reveal';
      this.#ev(s, 'secret_received');
      this.store.save(s);
      await this.#step(s.id);
      return this.view(this.store.get(id));
    });
  }

  // ---------- the loop ----------

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const s of this.store.inStates(WATCH)) await this.#locked(s.id, () => this.#step(s.id));
    } finally { this.busy = false; }
  }

  /** Advance one swap until it stops changing state (so a quote answered at once does not wait a poll per hop). */
  async #step(id) {
    let s = this.store.get(id);
    try {
      for (let hop = 0; hop < 6; hop++) {
        const before = s.state;
        await (s.dir === 'bch2base' ? this.#bch2base(s) : this.#base2bch(s));
        s = this.store.get(id);
        if (s.state === before || !ACTIVE.includes(s.state)) break;
      }
      const fresh = this.store.get(id);
      if (fresh.lastError) { fresh.lastError = null; this.store.save(fresh); }
    } catch (e) {
      const fresh = this.store.get(id);
      fresh.lastError = String(e.shortMessage ?? e.message ?? e).slice(0, 300);
      this.store.save(fresh);
      this.log('step failed', id, s.state, fresh.lastError);
    }
  }

  #ev(s, label, extra = {}) { s.events.push({ t: this.clock(), label, ...extra }); }
  #move(s, state, label, extra = {}) { s.state = state; this.#ev(s, label ?? state, extra); this.store.save(s); }

  // ---------- BCH stable -> USDC: user locks first on BCH, desk answers on Base ----------

  async #bch2base(s) {
    const now = this.clock();
    const evmNow = await this.evm.now();
    const funded = ['quoted', 'expired'].includes(s.state) ? await this.bch.funded(s) : null;

    if (s.state === 'quoted' || s.state === 'expired') {
      if (funded?.length) {
        s.txs.userLock = funded[0].txid;
        if (s.state === 'expired' || now > s.quoteExpiry) { s.note = 'funded after the quote expired; refund is released at ' + s.bchRefundTime; return this.#move(s, 'refund_wait', 'late_lock', { txid: funded[0].txid, chain: 'bch' }); }
        return this.#move(s, 'user_locked', 'user_locked', { txid: funded[0].txid, chain: 'bch' });
      }
      if (s.state === 'quoted' && now > s.quoteExpiry) return this.#move(s, 'expired');
      if (s.state === 'expired' && now > s.bchRefundTime) { s.state = 'abandoned'; return this.store.save(s); }
      return;
    }

    if (s.state === 'user_locked') {
      if (s.bchRefundTime - evmNow < this.rules.overlap + MIN_LEFT) { s.note = 'too close to the BCH refund time to answer safely'; return this.#move(s, 'refund_wait', 'too_late'); }
      if (!s.evmTimeout) {
        s.evmTimeout = Math.min(evmNow + this.rules.deskEvmWindow, s.bchRefundTime - this.rules.overlap);
        s.evmLockId = this.evm.lockId({ sender: this.evm.address, recipient: s.userEvm, hashlock: s.hashlock, timeout: s.evmTimeout, amount: s.recvUnits });
        this.store.save(s);
      }
      const l = await this.evm.lockState(s.evmLockId);
      if (l.state === LOCK_STATE.None) {
        const usdc = await this.evm.usdcBalance();
        if (usdc < BigInt(s.recvUnits)) { s.note = 'desk could not cover the payout'; return this.#move(s, 'refund_wait', 'desk_short'); }
        const r = await this.evm.lock({ recipient: s.userEvm, hashlock: s.hashlock, timeout: s.evmTimeout, amount: s.recvUnits });
        s.txs.deskLock = r.hash;
        s.evmLockBlock = Number(r.block);
        return this.#move(s, 'desk_locked', 'desk_locked', { txid: r.hash, chain: 'evm' });
      }
      return this.#move(s, 'desk_locked', 'desk_locked');
    }

    if (s.state === 'desk_locked') {
      const l = await this.evm.lockState(s.evmLockId);
      if (!s.secret) {
        const sec = await this.evm.claimedSecret(s.evmLockId, s.evmLockBlock);
        if (sec) { s.secret = sec; s.secretVia = 'evm'; this.#ev(s, 'secret_seen_on_base'); this.store.save(s); }
      }
      if (s.secret) {
        if (l.state === LOCK_STATE.Open && evmNow < s.evmTimeout && s.secretVia === 'reveal') {
          const r = await this.evm.claim(s.evmLockId, s.secret);
          s.txs.userPayout = r.hash;
          this.#ev(s, 'usdc_paid_to_user', { txid: r.hash, chain: 'evm' });
          this.store.save(s);
        }
        const utxos = await this.bch.funded(s);
        if (utxos.length) {
          s.txs.deskClaim = await this.bch.claim(s, utxos[0], s.secret);
          return this.#move(s, 'done', 'desk_claimed_pusd', { txid: s.txs.deskClaim, chain: 'bch' });
        }
        return this.#move(s, 'done', 'done');
      }
      if (l.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {
        const r = await this.evm.refund(s.evmLockId);
        s.txs.deskRefundEvm = r.hash;
        s.note = 'desk took its USDC back; the BCH lock is released to you at ' + s.bchRefundTime;
        return this.#move(s, 'refund_wait', 'desk_refunded', { txid: r.hash, chain: 'evm' });
      }
      if (l.state === LOCK_STATE.Refunded) return this.#move(s, 'refund_wait', 'desk_refunded');
      return;
    }

    if (s.state === 'refund_wait') {
      const utxos = await this.bch.funded(s);
      if (!utxos.length) return this.#move(s, 'refunded', 'refunded');
      if ((await this.bch.mtp()) >= s.bchRefundTime) {
        s.txs.userRefund = await this.bch.refund(s, utxos[0]);
        return this.#move(s, 'refunded', 'bch_refunded_to_user', { txid: s.txs.userRefund, chain: 'bch' });
      }
    }
  }

  // ---------- USDC -> BCH stable: user locks first on Base, desk answers on BCH ----------

  async #base2bch(s) {
    const now = this.clock();
    const evmNow = await this.evm.now();
    const userLock = ['quoted', 'expired', 'user_locked', 'refund_wait'].includes(s.state) ? await this.evm.lockState(s.evmLockId) : null;

    if (s.state === 'quoted' || s.state === 'expired') {
      if (userLock.state === LOCK_STATE.Open) {
        if (s.state === 'expired' || now > s.quoteExpiry) { s.note = 'funded after the quote expired; refund is released at ' + s.evmTimeout; return this.#move(s, 'refund_wait', 'late_lock', { chain: 'evm' }); }
        return this.#move(s, 'user_locked', 'user_locked', { chain: 'evm' });
      }
      if (s.state === 'quoted' && now > s.quoteExpiry) return this.#move(s, 'expired');
      if (s.state === 'expired' && evmNow > s.evmTimeout) { s.state = 'abandoned'; return this.store.save(s); }
      return;
    }

    if (s.state === 'user_locked') {
      if (userLock.state !== LOCK_STATE.Open) return this.#move(s, 'refund_wait', 'user_lock_gone');
      if (s.evmTimeout - evmNow < this.rules.evmOverlap + MIN_LEFT) { s.note = 'too close to the Base refund time to answer safely'; return this.#move(s, 'refund_wait', 'too_late'); }
      if (!s.bchRefundTime) { s.bchRefundTime = Math.min(now + this.rules.deskBchWindow, s.evmTimeout - this.rules.evmOverlap); this.store.save(s); }
      if ((await this.bch.funded(s)).length) return this.#move(s, 'desk_locked', 'desk_locked', { chain: 'bch' });
      if ((await this.bch.tokenBalance(s.category)) < BigInt(s.recvUnits)) { s.note = 'desk could not cover the payout'; return this.#move(s, 'refund_wait', 'desk_short'); }
      s.txs.deskLock = await this.bch.lock(s);
      return this.#move(s, 'desk_locked', 'desk_locked', { txid: s.txs.deskLock, chain: 'bch' });
    }

    if (s.state === 'desk_locked') {
      const utxos = await this.bch.funded(s);
      if (!s.secret) {
        const sec = await this.bch.findSecret(s);
        if (sec) { s.secret = sec; s.secretVia = 'bch'; this.#ev(s, 'secret_seen_on_bch'); this.store.save(s); }
      }
      if (s.secret) {
        if (utxos.length && s.secretVia === 'reveal') {
          s.txs.userPayout = await this.bch.claim(s, utxos[0], s.secret);
          this.#ev(s, 'pusd_paid_to_user', { txid: s.txs.userPayout, chain: 'bch' });
          this.store.save(s);
        }
        const l = await this.evm.lockState(s.evmLockId);
        if (l.state === LOCK_STATE.Open && evmNow < s.evmTimeout) {
          const r = await this.evm.claim(s.evmLockId, s.secret);
          s.txs.deskClaim = r.hash;
          return this.#move(s, 'done', 'desk_claimed_usdc', { txid: r.hash, chain: 'evm' });
        }
        return this.#move(s, 'done', 'done');
      }
      if (utxos.length && (await this.bch.mtp()) >= s.bchRefundTime) {
        s.txs.deskRefundBch = await this.bch.refund(s, utxos[0]);
        s.note = 'desk took its stable back; your USDC lock is released to you at ' + s.evmTimeout;
        return this.#move(s, 'refund_wait', 'desk_refunded', { txid: s.txs.deskRefundBch, chain: 'bch' });
      }
      return;
    }

    if (s.state === 'refund_wait') {
      if (userLock.state === LOCK_STATE.Open && evmNow >= s.evmTimeout) {
        const r = await this.evm.refund(s.evmLockId);
        s.txs.userRefund = r.hash;
        return this.#move(s, 'refunded', 'usdc_refunded_to_user', { txid: r.hash, chain: 'evm' });
      }
      if (userLock.state !== LOCK_STATE.Open) return this.#move(s, 'refunded', 'refunded');
    }
  }
}
