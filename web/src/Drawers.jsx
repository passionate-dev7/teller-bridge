import { money } from './format.js';

function Drawer({ cls, title, chain, inventory, available, decimals, unit, want, over, pays, note }) {
  const inv = BigInt(inventory), av = BigInt(available);
  const pct = (x) => (inv > 0n ? Math.min(100, Number((x * 10000n) / inv) / 100) : 0);
  const w = want ? BigInt(want) : 0n;
  const ticks = [100, 75, 50, 25].map((p) => money((inv * BigInt(p)) / 100n, decimals, 0));
  return (
    <section className={'drawer ' + cls + (pays ? ' pays' : '')} aria-label={title + ' drawer'}>
      <div>
        <h3>{title}</h3>
        <div className="chain label">{chain}</div>
      </div>
      <div className="big">{money(av, decimals, 2)} <span className="label">{unit}</span></div>
      <div className="gauge">
        <div className="ticks" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{t}</span>)}</div>
        <div className="tube" role="img" aria-label={'fills up to ' + money(av, decimals, 2) + ' ' + unit}>
          <div className="reserved" style={{ height: '100%' }} />
          <div className="fill" style={{ height: pct(av) + '%' }} />
          {pays && w > 0n && <div className={'want' + (over ? ' over' : '')} style={{ bottom: 0, height: pct(w > inv ? inv : w) + '%' }} />}
        </div>
      </div>
      <div className="legend">
        <span>fills up to <b>{money(av, decimals, 2)} {unit}</b> right now</span>
        {note && <span>{note}</span>}
        <span>holds <b>{money(inv, decimals, 2)} {unit}</b>{inv > av ? ', ' + money(inv - av, decimals, 2) + ' reserved by open quotes' : ''}</span>
      </div>
    </section>
  );
}

export default function Drawers({ pair, dir, wantRecv, over, peg }) {
  if (!pair) return (
    <div className="drawers" aria-busy="true">
      <div className="drawer"><div className="skeleton" style={{ height: 380 }} /></div>
      <div className="drawer"><div className="skeleton" style={{ height: 380 }} /></div>
    </div>
  );
  return (
    <div className="drawers">
      <Drawer cls="bch" title={pair.symbol.toLowerCase()} chain="Bitcoin Cash" unit={pair.symbol} decimals={2}
        inventory={pair.inventory.bchUnits} available={pair.available.bchUnits} pays={dir === 'base2bch'} want={dir === 'base2bch' ? wantRecv : null} over={over}
        note={peg && pair.symbol === 'PUSD' ? 'Cauldron pays $' + peg.usd.toFixed(4) + ' per PUSD now. The desk pays $1.0000 less its fee.' : null} />
      <Drawer cls="base" title="usdc" chain="Base" unit="USDC" decimals={6}
        inventory={pair.inventory.usdcUnits} available={pair.available.usdcUnits} pays={dir === 'bch2base'} want={dir === 'bch2base' ? wantRecv : null} over={over} />
    </div>
  );
}
