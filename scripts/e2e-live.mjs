// Live end-to-end run of the happy path in both directions against the real stack. usage: node --env-file=.env scripts/e2e-live.mjs
// (E2E_EVM=anvil rehearses the Base leg on a local anvil that reports chain id 84532; otherwise the configured Base RPC is used.)
import { setup } from './e2e-setup.mjs';
import { lockBuilder } from '../lib/bch.js';
import { randomSecret, checkQuote, bchContractFromQuote } from '../lib/client.js';
import { fmtUsd } from '../lib/amounts.js';
import { ERC20_ABI, DESK_LOCK_ABI } from '../lib/evm.js';

const R = await setup();
const { env, net, desk, token, chain, userBchAddr, userBchLock, userEvm, category, tokensOf, userUsdc, api, out, log, sleep, waitFor, explorer } = R;
try {
  // ============ A: PUSD (BCH) -> USDC (Base) ============
  {
    const sendUnits = '50'; // 0.50
    const { secret, hashlock } = randomSecret();
    const before = { usdc: await userUsdc(), deskTokens: await desk.bch.tokenBalance(category) };
    const req = { dir: 'bch2base', pair: 'PUSD', sendUnits, hashlock, userBchAddress: userBchAddr, userEvm: userEvm.account.address };
    const q = await api.quote(req);
    const problems = checkQuote(q, { ...req, userBchLock }, await api.status(), Math.floor(Date.now() / 1000), chain);
    if (problems.length) throw new Error('quote check: ' + problems.join('; '));
    const t0 = Date.now();
    const contract = bchContractFromQuote(q, await api.status(), chain);
    const lock = await (await lockBuilder({ provider: chain, contract, category, tokenAmount: BigInt(sendUnits), from: userBchAddr, fromPrefix: net.bch.prefix, signer: { keyHex: env.TEST_USER_BCH_KEY } })).send();
    log('A user locked 0.50 PUSD on BCH', lock.txid);
    const locked = await waitFor(q.id, ['desk_locked']);
    log('A desk locked USDC on Base', locked.txs.deskLock, 'after', (Date.now() - t0) / 1000, 's');
    await api.reveal(q.id, secret);
    const done = await waitFor(q.id, ['done']);
    const secs = (Date.now() - t0) / 1000;
    const after = { usdc: await userUsdc(), deskTokens: await desk.bch.tokenBalance(category) };
    out.scenarios.push({
      name: 'PUSD to USDC', seconds: secs, userLockTx: lock.txid, deskLockTx: done.txs.deskLock, userPayoutTx: done.txs.userPayout, deskClaimTx: done.txs.deskClaim,
      userUsdcDelta: String(after.usdc - before.usdc), expected: q.recvUnits, deskPusdDelta: String(after.deskTokens - before.deskTokens),
      links: { userLock: explorer.bch(lock.txid), deskLock: explorer.evm(done.txs.deskLock), userPayout: explorer.evm(done.txs.userPayout), deskClaim: explorer.bch(done.txs.deskClaim) },
    });
    if (after.usdc - before.usdc !== BigInt(q.recvUnits)) throw new Error('A: user USDC delta wrong');
    if (after.deskTokens - before.deskTokens !== BigInt(sendUnits)) throw new Error('A: desk PUSD delta wrong');
    log('A done in', secs, 's: user +' + fmtUsd(after.usdc - before.usdc, 6) + ' USDC');
  }
  // ============ B: USDC (Base) -> PUSD (BCH) ============
  {
    const sendUnits = '500000'; // 0.50 USDC
    const { secret, hashlock } = randomSecret();
    const before = { tokens: await tokensOf(userBchAddr), deskUsdc: await desk.evm.usdcBalance() };
    const req = { dir: 'base2bch', pair: 'PUSD', sendUnits, hashlock, userBchAddress: userBchAddr, userEvm: userEvm.account.address };
    const q = await api.quote(req);
    const problems = checkQuote(q, { ...req, userBchLock }, await api.status(), Math.floor(Date.now() / 1000), chain);
    if (problems.length) throw new Error('quote check: ' + problems.join('; '));
    const t0 = Date.now();
    const w = userEvm.walletClient, p = userEvm.publicClient;
    await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [desk.evm.deskLock, BigInt(sendUnits)] }) });
    const lockHash = await w.writeContract({ address: desk.evm.deskLock, abi: DESK_LOCK_ABI, functionName: 'lock', args: [desk.evm.address, '0x' + hashlock, BigInt(q.evmTimeout), BigInt(sendUnits)] });
    await p.waitForTransactionReceipt({ hash: lockHash });
    log('B user locked 0.50 USDC on Base', lockHash);
    const locked = await waitFor(q.id, ['desk_locked']);
    log('B desk locked PUSD on BCH', locked.txs.deskLock, 'after', (Date.now() - t0) / 1000, 's');
    await api.reveal(q.id, secret);
    const done = await waitFor(q.id, ['done']);
    const secs = (Date.now() - t0) / 1000;
    await sleep(2500);
    const after = { tokens: await tokensOf(userBchAddr), deskUsdc: await desk.evm.usdcBalance() };
    out.scenarios.push({
      name: 'USDC to PUSD', seconds: secs, userLockTx: lockHash, deskLockTx: done.txs.deskLock, userPayoutTx: done.txs.userPayout, deskClaimTx: done.txs.deskClaim,
      userPusdDelta: String(after.tokens - before.tokens), expected: q.recvUnits, deskUsdcDelta: String(after.deskUsdc - before.deskUsdc),
      links: { userLock: explorer.evm(lockHash), deskLock: explorer.bch(done.txs.deskLock), userPayout: explorer.bch(done.txs.userPayout), deskClaim: explorer.evm(done.txs.deskClaim) },
    });
    if (after.tokens - before.tokens !== BigInt(q.recvUnits)) throw new Error('B: user PUSD delta wrong');
    if (after.deskUsdc - before.deskUsdc !== BigInt(sendUnits)) throw new Error('B: desk USDC delta wrong');
    log('B done in', secs, 's: user +' + fmtUsd(after.tokens - before.tokens, 2) + ' PUSD');
  }
  out.ok = true;
} finally {
  R.stop();
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
