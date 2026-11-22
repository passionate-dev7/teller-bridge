import { useCallback, useEffect, useMemo, useState } from 'react';
import { isAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deskApi } from '../../lib/client.js';
import { bchToBaseOut, baseToBchOut } from '../../lib/amounts.js';
import { lockingBytecodeOf } from '../../lib/bch.js';
import { DESK_URL } from './config.js';
import { parseCents, sendUnits, money, short } from './format.js';
import { saved, forget, startBchToBase, startBaseToBch, claimBchYourself, claimBaseYourself } from './flow.js';
import { useBchWallet, useEvmWallet } from './wallets.js';
import Drawers from './Drawers.jsx';
import Receipt from './Receipt.jsx';
import PairDialog from './PairDialog.jsx';
import Overflow from './Overflow.jsx';

const TERMINAL = ['done', 'refunded', 'expired', 'abandoned'];
const hours = (s) => (s % 3600 === 0 ? s / 3600 + ' h' : Math.round(s / 60) + ' min');

function useStatus(api) {
  const [status, setStatus] = useState(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => api.status().then((s) => { if (live) { setStatus(s); setOffline(false); } }).catch(() => live && setOffline(true));
    load();
    const id = setInterval(load, 5000);
    return () => { live = false; clearInterval(id); };
  }, [api]);
  return { status, offline };
}

export default function App() {
  const api = useMemo(() => deskApi(DESK_URL), []);
  const { status, offline } = useStatus(api);
  const bch = useBchWallet(status);
  const evm = useEvmWallet();

  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [dir, setDir] = useState(params.get('dir') === 'base2bch' ? 'base2bch' : 'bch2base');
  const [amount, setAmount] = useState(params.get('amount') || '0.50');
  const [pairSym, setPairSym] = useState('PUSD');
  const [baseAddr, setBaseAddr] = useState('');
  const [bchAddr, setBchAddr] = useState('');
  const [generated, setGenerated] = useState(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [track, setTrack] = useState(null);
  const [swap, setSwap] = useState(null);
  const [past, setPast] = useState([]);
  const [replayOf, setReplayOf] = useState(null);
  const [peg, setPeg] = useState(null);
  useEffect(() => { api.peg().then(setPeg).catch(() => setPeg(null)); }, [api]);

  const pair = status?.pairs.find((p) => p.symbol === pairSym) ?? status?.pairs[0];
  const cents = parseCents(amount);
  const units = cents ? sendUnits(dir, cents) : null;
  const feeBps = BigInt(status?.feeBps ?? 30);
  const recv = units ? (dir === 'bch2base' ? bchToBaseOut(units, feeBps) : baseToBchOut(units, feeBps)) : null;
  const maxSend = BigInt(pair?.maxSend[dir] ?? 0);
  const over = units !== null && units > maxSend;
  const minCents = BigInt(status?.minUsdCents ?? 25);
  const baseTarget = baseAddr || evm.address || '';
  const bchTarget = bchAddr || bch.scan?.receive?.tokenAddress || '';
  const bchOk = (() => { try { return !!bchTarget && bchTarget.startsWith((status?.bch.prefix ?? 'bchtest') + ':') && !!lockingBytecodeOf(bchTarget); } catch { return false; } })();

  // past swaps for the replay panel: the desk's own record, or the bundled export when the desk is offline
  useEffect(() => {
    api.replays().then(setPast).catch(() => fetch('/replays.json').then((r) => r.json()).then(setPast).catch(() => setPast([])));
  }, [api, swap?.state]);

  // resume the latest unfinished swap of this browser
  useEffect(() => {
    if (!status || track) return;
    const rec = saved().find((r) => r.id);
    if (!rec) return;
    api.swap(rec.id).then((s) => { if (!TERMINAL.includes(s.state)) { setTrack({ id: rec.id, secret: rec.secret, userLockTx: rec.userLockTx, dir: rec.dir, startedAt: rec.at }); setSwap(s); } }).catch(() => {});
  }, [status?.network]);

  // follow the active swap, hand the secret over once the desk has locked its side
  useEffect(() => {
    if (!track) return;
    let live = true, revealing = false;
    const step = async () => {
      try {
        let s = await api.swap(track.id);
        if (s.state === 'desk_locked' && !s.secretRevealed && track.secret && !revealing) {
          revealing = true;
          try { s = await api.reveal(track.id, track.secret); } catch { /* retried on the next poll */ } finally { revealing = false; }
        }
        if (live) setSwap(s);
        if (TERMINAL.includes(s.state)) { forget(s.hashlock); bch.rescan(); }
      } catch { /* desk blip, next poll */ }
    };
    step();
    const id = setInterval(step, 2000);
    return () => { live = false; clearInterval(id); };
  }, [track?.id]);

  const flip = () => { setDir((d) => (d === 'bch2base' ? 'base2bch' : 'bch2base')); setError(null); };
  const makeBaseAddress = () => { const key = generatePrivateKey(); setGenerated({ key, address: privateKeyToAccount(key).address }); setBaseAddr(privateKeyToAccount(key).address); };

  const start = useCallback(async () => {
    setError(null); setBusy(true); setReplayOf(null);
    try {
      const r = dir === 'bch2base'
        ? await startBchToBase({ api, status, pair: pair.symbol, cents, baseAddress: baseTarget, wallet: bch })
        : await startBaseToBch({ api, status, pair: pair.symbol, cents, bchAddress: bchTarget, evm });
      setTrack({ id: r.quote.id, secret: r.secret, userLockTx: r.userLockTx, dir, startedAt: Date.now() });
      setSwap(await api.swap(r.quote.id));
    } catch (e) {
      setError(e.body?.message ?? e.shortMessage ?? e.message);
    } finally { setBusy(false); }
  }, [api, status, pair, cents, dir, baseTarget, bchTarget, bch, evm]);

  const finish = () => { setTrack(null); setSwap(null); setError(null); };

  // primary button
  let action = { label: 'Loading the desk', disabled: true };
  if (status) {
    if (!cents) action = { label: 'Enter an amount', disabled: true };
    else if (cents < minCents) action = { label: 'Minimum is $' + (Number(minCents) / 100).toFixed(2), disabled: true };
    else if (over) action = { label: 'Above what the desk holds', disabled: true };
    else if (!status.ready) action = { label: 'Desk is refilling', disabled: true };
    else if (dir === 'bch2base' && !bch.paired) action = { label: 'Connect your Bitcoin Cash wallet', onClick: () => { bch.wc.connect(); setPairOpen(true); } };
    else if (dir === 'bch2base' && !bch.scan) action = { label: 'Reading your wallet', disabled: true };
    else if (dir === 'bch2base' && !isAddress(baseTarget)) action = { label: 'Add the Base address to pay', disabled: true };
    else if (dir === 'base2bch' && !evm.isConnected) action = { label: 'Connect your Base wallet', onClick: () => document.getElementById('evm-connect')?.scrollIntoView({ block: 'center' }) };
    else if (dir === 'base2bch' && !bchOk) action = { label: 'Add the Bitcoin Cash address to pay', disabled: true };
    else action = { label: 'Swap ' + money(cents, 2) + ' ' + (dir === 'bch2base' ? pair.symbol : 'USDC') + ' for ' + money(recv, dir === 'bch2base' ? 6 : 2, 2) + ' ' + (dir === 'bch2base' ? 'USDC' : pair.symbol), onClick: start };
  }
  const sendSym = dir === 'bch2base' ? pair?.symbol ?? 'PUSD' : 'USDC';
  const recvSym = dir === 'bch2base' ? 'USDC' : pair?.symbol ?? 'PUSD';

  const needSelf = swap && track && swap.state === 'desk_locked' && Date.now() - track.startedAt > 90_000;
  const [claimMsg, setClaimMsg] = useState(null);
  const claimSelf = async () => {
    setClaimMsg('Working...');
    try {
      const txid = track.dir === 'bch2base' ? await claimBaseYourself({ status, swap, secret: track.secret, evm }) : await claimBchYourself({ status, swap, secret: track.secret });
      setClaimMsg('Claim sent: ' + short(txid, 10, 8));
    } catch (e) { setClaimMsg(e.shortMessage ?? e.message); }
  };

  return (
    <div className="shell">
      <header className="bar">
        <h1 className="mark"><i aria-hidden="true" />teller</h1>
        <div className="pills">
          {status && <span className="chip plain">{status.bch.network} + {status.evm.name}</span>}
          {status && <span className={'chip ' + (status.ready ? 'ok' : 'warn')}>{status.ready ? 'desk open' : 'desk refilling'}</span>}
          {offline && <span className="chip warn">desk unreachable</span>}
        </div>
      </header>

      <div className="lead">
        <h2>pusd in, usdc out, and back again.</h2>
        <p>The card shows what the desk can fill right now. Both sides lock against the same secret, so either you are paid or you get your own coins back.</p>
      </div>

      <main className="board">
        <section className="slip" aria-label="Swap">
          {!track && (
            <>
              <div className="slip-row">
                <div className="slip-head"><span className="label">You send</span>
                  {status && status.pairs.length > 1 && dir === 'bch2base' && (
                    <span className="quick">{status.pairs.map((p) => <button key={p.symbol} aria-pressed={p.symbol === pair.symbol} onClick={() => setPairSym(p.symbol)} style={p.symbol === pair.symbol ? { background: 'var(--color-ink)', color: 'var(--color-paper)' } : null}>{p.symbol}</button>)}</span>)}
                </div>
                <div className="amount">
                  <input inputMode="decimal" aria-label="Amount to send in dollars" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <span className="unit">{sendSym}</span>
                </div>
                <div className="quick">{['0.50', '1.00', '2.50'].map((v) => <button key={v} onClick={() => setAmount(v)}>${v}</button>)}
                  {pair && maxSend > 0n && <button onClick={() => setAmount(money(dir === 'bch2base' ? maxSend : maxSend / 10000n, 2, 2))}>Max ${money(dir === 'bch2base' ? maxSend : maxSend / 10000n, 2, 2)}</button>}
                </div>
                <div className="sub">{pair ? 'Desk fills up to ' + money(dir === 'bch2base' ? maxSend : maxSend / 10000n, 2, 2) + ' ' + sendSym + ' right now.' : <span className="skeleton" style={{ display: 'inline-block', width: 200, height: 14 }} />}</div>
              </div>
              <div className="flip"><button onClick={flip} aria-label="Swap direction">{'\u21C5'}</button></div>
              <div className="slip-row">
                <div className="slip-head"><span className="label">You receive</span></div>
                <div className={'recv' + (recv && !over ? '' : ' idle')}>{recv && cents ? money(recv, dir === 'bch2base' ? 6 : 2, 2) : '0.00'} <span className="unit" style={{ fontSize: 20 }}>{recvSym}</span></div>
                <div className="sub">{recv && cents ? 'After the desk fee of ' + (Number(feeBps) / 100).toFixed(2) + '%. The desk pays the ' + (dir === 'bch2base' ? 'Base' : 'Bitcoin Cash') + ' network fee on its side.' : 'Rate is 1 to 1 less the desk fee.'}</div>
              </div>
              <div className="slip-row">
                {dir === 'bch2base' ? (
                  <div className="field">
                    <span className="label">Pay USDC to this Base address</span>
                    <div className="row">
                      <input className="text" placeholder="0x..." aria-label="Base address" value={baseAddr} onChange={(e) => setBaseAddr(e.target.value.trim())} spellCheck="false" />
                      {evm.isConnected && <button className="btn small" onClick={() => setBaseAddr(evm.address)}>Mine</button>}
                      <button className="btn small" onClick={makeBaseAddress}>Make one</button>
                    </div>
                    {generated && <div className="notice warn" role="alert"><strong>Save this key now.</strong> It exists only in this tab and controls the address above.<div className="mono" style={{ wordBreak: 'break-all', marginTop: 8 }}>{generated.key}</div></div>}
                    <span className="sub">{bch.paired ? 'Bitcoin Cash wallet paired' + (bch.walletName ? '' : '') + '. ' : 'No Base wallet needed for this direction. '}<button className="link" onClick={() => { bch.wc.connect(); setPairOpen(true); }}>{bch.paired ? 'Re-pair' : 'Pair your Bitcoin Cash wallet'}</button></span>
                  </div>
                ) : (
                  <div className="field">
                    <span className="label">Receive {pair?.symbol} at this Bitcoin Cash address</span>
                    <div className="row">
                      <input className="text" placeholder={(status?.bch.prefix ?? 'bchtest') + ':z...'} aria-label="Bitcoin Cash address" value={bchAddr} onChange={(e) => setBchAddr(e.target.value.trim())} spellCheck="false" />
                      {bch.scan?.receive && <button className="btn small" onClick={() => setBchAddr(bch.scan.receive.tokenAddress)}>Mine</button>}
                    </div>
                    <span className="sub" id="evm-connect">{evm.isConnected ? 'Base wallet ' + short(evm.address, 6, 4) + ' connected. ' : ''}
                      {evm.isConnected ? <button className="link" onClick={() => evm.disconnect()}>Disconnect</button> : evm.connectors.map((c) => <button key={c.uid} className="btn small" style={{ marginRight: 8 }} onClick={() => evm.connect(c).catch((e) => setError(e.shortMessage ?? e.message))}>{c.name === 'Injected' ? 'Browser wallet' : c.name}</button>)}
                      {!evm.isConnected && evm.connectors.length < 2 && <span> WalletConnect appears once a project id is configured.</span>}
                    </span>
                  </div>
                )}
              </div>
              <div className="slip-foot">
                {over && pair && (
                  <div className="notice warn" role="status"><strong>That is more than the desk holds.</strong> It fills up to {money(dir === 'bch2base' ? maxSend : maxSend / 10000n, 2, 2)} {sendSym} instantly. The whole amount can still go through NEAR Intents:
                    <Overflow api={api} dir={dir} pair={pair.symbol} units={units} baseAddress={baseTarget} bchAddress={bch.scan?.receive?.address ?? ''} status={status} bch={bch} />
                  </div>
                )}
                {!over && cents && recv && cents >= minCents && status && (
                  <div className="notice"><strong>What you sign</strong>
                    <dl>
                      <dt>You lock</dt><dd>{money(cents, 2)} {sendSym}</dd>
                      <dt>You get</dt><dd>{money(recv, dir === 'bch2base' ? 6 : 2, 2)} {recvSym}</dd>
                      <dt>If the desk never answers</dt><dd>refund after {hours(dir === 'bch2base' ? status.windows.userBchWindow : status.windows.userEvmWindow)}</dd>
                    </dl>
                  </div>
                )}
                {error && <div className="notice err" role="alert">{error}</div>}
                {status && !status.ready && <div className="notice warn">{status.reasons.join(', ')}</div>}
                {bch.scanError && <div className="notice err">Could not read your wallet: {bch.scanError}</div>}
                <button className="btn primary" disabled={action.disabled || busy} onClick={action.onClick}>{busy ? 'Waiting for your wallet' : action.label}</button>
              </div>
            </>
          )}
          {track && swap && (
            <div className="slip-foot" style={{ paddingTop: 'var(--space-4)' }}>
              <span className="label">Your swap</span>
              <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em' }}>{money(swap.dir === 'bch2base' ? swap.sendUnits : BigInt(swap.sendUnits) / 10000n, swap.dir === 'bch2base' ? 2 : 2, 2)} {swap.dir === 'bch2base' ? swap.pair : 'USDC'} {'\u2192'} {money(swap.recvUnits, swap.dir === 'bch2base' ? 6 : 2, 2)} {swap.dir === 'bch2base' ? 'USDC' : swap.pair}</div>
              {needSelf && swap.state === 'desk_locked' && (
                <div className="notice warn" role="status">The desk has not paid out yet. You can finish it yourself with your secret, no one else can.
                  <div style={{ marginTop: 8 }}><button className="btn small" onClick={claimSelf}>{track.dir === 'bch2base' ? 'Claim on Base with my wallet' : 'Claim on Bitcoin Cash now'}</button> {claimMsg && <span className="sub">{claimMsg}</span>}</div>
                </div>
              )}
              {TERMINAL.includes(swap.state) && <button className="btn" onClick={finish}>New swap</button>}
              {!TERMINAL.includes(swap.state) && <span className="sub">Keep this tab open. Your secret lives in it; a refund path exists either way.</span>}
            </div>
          )}
        </section>

        <Drawers pair={pair} dir={dir} wantRecv={recv ? recv.toString() : null} over={over} peg={peg} />

        <div className="receipt-wrap">
          {track && swap && status && <Receipt swap={swap} status={status} local={track} title="your receipt" />}
          {replayOf && status && <Receipt swap={replayOf} status={status} replay title="replay of a real swap" />}
          {past.length > 0 && status && (
            <div className="past" aria-label="Past swaps">
              <span className="label">Past swaps filled by this desk</span>
              {past.slice(0, 5).map((p) => {
                const secs = p.events[p.events.length - 1].t - p.events[0].t;
                return (
                  <div className="past-item" key={p.id}>
                    <span className="route">{money(p.dir === 'bch2base' ? p.sendUnits : BigInt(p.sendUnits) / 10000n, 2, 2)} {p.dir === 'bch2base' ? p.pair : 'USDC'} {'\u2192'} {money(p.recvUnits, p.dir === 'bch2base' ? 6 : 2, 2)} {p.dir === 'bch2base' ? 'USDC' : p.pair}</span>
                    <span className="meta">done in {secs}s</span>
                    <button className="btn small" onClick={() => setReplayOf(replayOf?.id === p.id ? null : p)}>{replayOf?.id === p.id ? 'Hide' : 'Watch it'}</button>
                  </div>
                );
              })}
            </div>
          )}
          {past.length === 0 && status && <p className="sub">No completed swaps yet on this desk.</p>}
        </div>
      </main>

      <section className="proof" aria-label="Why the desk cannot keep your money">
        <h3>why it cannot keep your money</h3>
        <ul>
          <li><b>One secret opens both locks.</b><span>You make it in this tab. The desk only learns it after its own side is locked, so it cannot take yours and leave.</span></li>
          <li><b>Your PUSD sits in a covenant.</b><span>It pays the desk only with your secret, and pays you after the refund time. Either way exactly one output, no signature needed.</span></li>
          <li><b>The USDC lock on Base pays your address.</b><span>Anyone can submit the claim, the contract still sends it to you. The desk gets it back only after its timeout.</span></li>
          <li><b>Every rule has a test that fails without it.</b><span>Delete a require in either contract and a test turns red. The run is in TESTS.md.</span></li>
        </ul>
      </section>

      <footer className="footer">
        <span>{status ? <>Desk lock on Base <a className="mono" href={status.evm.explorerAddr + status.evm.deskLock} target="_blank" rel="noreferrer">{short(status.evm.deskLock, 8, 6)}</a>, desk wallet on Bitcoin Cash <a className="mono" href={status.bch.explorerAddr + status.bch.deskAddress} target="_blank" rel="noreferrer">{short(status.bch.deskAddress, 14, 6)}</a></> : 'Connecting to the desk'}</span>
        <span>Desk fee {status ? (status.feeBps / 100).toFixed(2) + '%' : ''}</span>
      </footer>

      <PairDialog open={pairOpen && !bch.paired} onClose={() => setPairOpen(false)} uri={bch.wc.uri} qrUri={bch.wc.qrUri} />
    </div>
  );
}
