import { useEffect, useState } from 'react';
import { short, ago } from './format.js';

const WORDS = {
  bch2base: {
    quoted: ['Quote opened', 'The desk reserved the USDC for you.'],
    user_locked: ['You locked your PUSD on Bitcoin Cash', 'Only the desk can take it, and only with your secret.'],
    desk_locked: ['The desk locked USDC on Base for you', 'Only your address can receive it.'],
    secret_received: ['Your secret reached the desk', null],
    usdc_paid_to_user: ['USDC paid to your Base address', 'The desk paid the gas.'],
    secret_seen_on_base: ['Your own claim on Base revealed the secret', null],
    desk_claimed_pusd: ['The desk claimed the PUSD it was owed', 'Same secret, now public.'],
  },
  base2bch: {
    quoted: ['Quote opened', 'The desk reserved the PUSD for you.'],
    user_locked: ['You locked your USDC on Base', 'Only the desk can take it, and only with your secret.'],
    desk_locked: ['The desk locked PUSD on Bitcoin Cash for you', 'Only your wallet can receive it.'],
    secret_received: ['Your secret reached the desk', null],
    pusd_paid_to_user: ['PUSD paid to your wallet', 'No signature needed from you.'],
    secret_seen_on_bch: ['Your own claim on Bitcoin Cash revealed the secret', null],
    desk_claimed_usdc: ['The desk claimed the USDC it was owed', 'Same secret, now public.'],
  },
};
const COMMON = {
  expired: ['Quote expired', 'Nothing was locked, nothing is owed.'],
  late_lock: ['Your lock arrived after the quote expired', 'The desk will not answer it. Your refund is released automatically at the refund time.'],
  too_late: ['Too close to your refund time to answer safely', 'The desk stepped back. Your refund is released automatically.'],
  desk_short: ['The desk could not cover the payout', 'Your refund is released automatically.'],
  user_lock_gone: ['Your lock is no longer open', null],
  desk_refunded: ['Nothing was claimed in time, the desk took its own side back', 'Your side comes back to you at the refund time.'],
  bch_refunded_to_user: ['Your PUSD came back to you', 'The desk relayed the refund.'],
  usdc_refunded_to_user: ['Your USDC came back to you', 'The desk relayed the refund.'],
  refunded: ['Closed with nothing owed', null],
  done: ['Swap complete', null],
};
const BAD = new Set(['expired', 'late_lock', 'too_late', 'desk_short', 'user_lock_gone', 'desk_refunded', 'bch_refunded_to_user', 'usdc_refunded_to_user', 'refunded']);

export function linesOf(swap, local) {
  const w = WORDS[swap.dir];
  const out = [];
  const t0 = swap.events[0]?.t ?? 0;
  for (const e of swap.events) {
    const [what, note] = w[e.label] ?? COMMON[e.label] ?? [e.label, null];
    let txid = e.txid, chain = e.chain;
    if (e.label === 'user_locked' && !txid && local?.userLockTx) { txid = local.userLockTx; chain = swap.dir === 'bch2base' ? 'bch' : 'evm'; }
    if (e.label === 'done' && out.length && out[out.length - 1].key === 'desk_claimed_pusd') continue;
    out.push({ key: e.label, what, note, t: e.t - t0, txid, chain, bad: BAD.has(e.label) });
  }
  return out;
}

const PENDING = {
  bch2base: ['user_locked', 'desk_locked', 'usdc_paid_to_user', 'desk_claimed_pusd'],
  base2bch: ['user_locked', 'desk_locked', 'pusd_paid_to_user', 'desk_claimed_usdc'],
};

export default function Receipt({ swap, status, local, replay, title }) {
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!replay) { setShown(null); return; }
    setShown(0);
    const total = swap.events.length;
    const id = setInterval(() => setShown((n) => { if (n + 1 >= total) { clearInterval(id); return total; } return n + 1; }), 700);
    return () => clearInterval(id);
  }, [replay, swap.id]);
  const all = linesOf(swap, local);
  const lines = shown === null ? all : all.slice(0, shown);
  const seen = new Set(all.map((l) => l.key));
  const pending = shown !== null || ['done', 'refunded', 'expired', 'abandoned'].includes(swap.state) ? [] : PENDING[swap.dir].filter((k) => !seen.has(k));
  const link = (l) => {
    if (!l.txid) return null;
    const base = l.chain === 'bch' ? status.bch.explorerTx : status.evm.explorerTx;
    return <a className="tx" href={base + l.txid} target="_blank" rel="noreferrer">{short(l.txid, 8, 6)}</a>;
  };
  const last = all[all.length - 1];
  return (
    <section className="receipt" aria-label="Swap receipt" aria-live="polite">
      <div className="receipt-head">
        <h3>{title ?? 'receipt'}</h3>
        <span className={'chip ' + (swap.state === 'done' ? 'ok' : ['refunded', 'refund_wait', 'expired'].includes(swap.state) ? 'warn' : 'signal')}>{swap.state.replace('_', ' ')}</span>
      </div>
      <ol className="lines">
        {lines.map((l, i) => (
          <li key={l.key + i} className={'line' + (l.bad ? ' bad' : '')}>
            <span className="t">+{l.t}s</span>
            <span className="what">{l.what}{l.note && <small>{l.note}</small>}</span>
            {link(l)}
          </li>
        ))}
        {pending.map((k) => {
          const [what] = WORDS[swap.dir][k];
          return <li key={k} className="line pending"><span className="t" /><span className="what">{what}</span><span /></li>;
        })}
      </ol>
      {swap.state === 'done' && last && shown === null && <div className="total"><span>Done in {ago(last.t)}</span><span className="mono">{swap.id.slice(0, 8)}</span></div>}
      {swap.state === 'refund_wait' && swap.note && <p className="sub">{swap.note}</p>}
    </section>
  );
}
