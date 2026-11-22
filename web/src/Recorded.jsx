import { useEffect, useState } from 'react';
import Receipt from './Receipt.jsx';
import { money, short } from './format.js';
import { overflowQuote, pegQuote } from '../../desk/overflow.js';

// Shown when the desk service cannot be reached: the swaps this desk really filled on chipnet, replayed leg by leg.
// Bitcoin Cash legs link to the chipnet explorer; the Base legs of these swaps ran on a local node and print without a link.
const EXPLORERS = { bch: { explorerTx: 'https://chipnet.imaginary.cash/tx/' }, evm: { explorerTx: 'https://sepolia.basescan.org/tx/' } };
const RUN_IT = 'https://github.com/passionate-dev7/teller-bridge#run-it';
const fwd = (p) => p.dir === 'bch2base';
const route = (p) => money(fwd(p) ? p.sendUnits : BigInt(p.sendUnits) / 10000n, 2, 2) + ' ' + (fwd(p) ? p.pair : 'USDC') + ' \u2192 ' + money(p.recvUnits, fwd(p) ? 6 : 2, 2) + ' ' + (fwd(p) ? 'USDC' : p.pair);
const secs = (p) => p.events[p.events.length - 1].t - p.events[0].t;

export default function Recorded({ past }) {
  const [id, setId] = useState(null);
  const [run, setRun] = useState(0);
  const [peg, setPeg] = useState(null);
  const [over, setOver] = useState(null);
  // live reads straight from the browser: the Cauldron price of PUSD and a NEAR Intents route for a size no desk holds; a panel that cannot load is not drawn
  useEffect(() => {
    pegQuote().then(setPeg).catch(() => {});
    const ask = (units) => overflowQuote({ dir: 'bch2base', pair: 'PUSD', sendUnits: units }).then((q) => setOver({ q, units }));
    ask('100000').catch(() => ask('10000')).catch(() => {});
  }, []);
  const sel = past.find((p) => p.id === id) ?? past.find(fwd) ?? past[0];
  if (!sel) return <p className="sub" style={{ gridColumn: '1 / -1' }}>Loading the recorded swaps</p>;
  const refundH = Math.round((sel.bchRefundTime - sel.createdAt) / 3600);
  return (
    <>
      <section className="slip panel" aria-label="Recorded swap">
        <div className="slip-foot" style={{ paddingTop: 'var(--space-4)' }}>
          <span className="label">Recorded chipnet swaps</span>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>{route(sel)}</div>
          <div className="notice"><strong>What was signed</strong>
            <dl>
              <dt>Locked by the user</dt><dd>{money(fwd(sel) ? sel.sendUnits : BigInt(sel.sendUnits) / 10000n, 2, 2)} {fwd(sel) ? sel.pair : 'USDC'}</dd>
              <dt>Received</dt><dd>{money(sel.recvUnits, fwd(sel) ? 6 : 2, 2)} {fwd(sel) ? 'USDC' : sel.pair}</dd>
              <dt>Hashlock</dt><dd className="mono">{short(sel.hashlock, 10, 8)}</dd>
              <dt>Filled in</dt><dd>{secs(sel)} s</dd>
              <dt>Refund if the desk never answered</dt><dd>after {refundH} h</dd>
            </dl>
          </div>
          <button className="btn primary" onClick={() => setRun((n) => n + 1)}>Replay this swap</button>
          <a className="btn" href={RUN_IT} target="_blank" rel="noreferrer">Run the desk yourself</a>
        </div>
      </section>
      <div className="rec-receipt">
        <Receipt key={sel.id + ':' + run} swap={sel} status={EXPLORERS} replay title="replay of a real swap" />
      </div>
      <div className="receipt-wrap">
        <div className="past" aria-label="Recorded swaps">
          <span className="label">Every swap recorded on chipnet</span>
          {past.slice(0, 6).map((p) => (
            <div className="past-item" key={p.id}>
              <span className="route">{route(p)}</span>
              <span className="meta">done in {secs(p)}s</span>
              <button className="btn small" onClick={() => { setId(p.id); setRun((n) => n + 1); }}>{p.id === sel.id ? 'Showing' : 'Watch it'}</button>
            </div>
          ))}
        </div>
      </div>
      {(over || peg) && (
        <div className="receipt-wrap">
          <div className="notice"><strong>Above what a desk holds</strong> The card quotes the whole amount through NEAR Intents and Cauldron. Read from your browser just now:
            <dl>
              {over && <><dt>Route</dt><dd>{over.q.route.join(' then ')}</dd>
                <dt>{money(BigInt(over.units), 2, 2)} PUSD would return about</dt><dd>{money(over.q.estOut, over.q.outDecimals, 2)} {over.q.outSymbol}</dd>
                <dt>Quoted at</dt><dd>{new Date(over.q.quotedAt * 1000).toISOString().slice(11, 19)} UTC by {over.q.source}</dd></>}
              {peg && <><dt>Cauldron pays per PUSD</dt><dd>${peg.usd.toFixed(4)}</dd></>}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
