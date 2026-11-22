import { useEffect, useState } from 'react';
import { money } from './format.js';

/** Above the desk's inventory: a live NEAR Intents 1Click quote, computed by the desk service. */
export default function Overflow({ api, dir, pair, units, baseAddress, bchAddress, status }) {
  const [q, setQ] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setQ(null); setErr(null);
    const id = setTimeout(() => {
      api.overflow({ dir, pair, sendUnits: units.toString(), baseAddress: baseAddress || '', bchAddress: bchAddress || '' }).then(setQ).catch((e) => setErr(e.message));
    }, 500);
    return () => clearTimeout(id);
  }, [dir, pair, units, baseAddress, bchAddress]);
  if (err) return <div className="sub" style={{ marginTop: 8 }}>The route quote is unavailable right now: {err}</div>;
  if (!q) return <div className="skeleton" style={{ height: 56, marginTop: 8 }} aria-busy="true" />;
  return (
    <dl>
      <dt>Route</dt><dd>{q.route.join(' then ')}</dd>
      <dt>You would receive about</dt><dd>{money(q.estOut, q.outDecimals, 2)} {q.outSymbol}</dd>
      <dt>Quoted at</dt><dd>{new Date(q.quotedAt * 1000).toISOString().slice(11, 19)} UTC by {q.source}</dd>
      {q.timeEstimate && <dt>Time</dt>}{q.timeEstimate && <dd>about {q.timeEstimate} s</dd>}
    </dl>
  );
}
