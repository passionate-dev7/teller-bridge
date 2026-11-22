// Live refund run in both directions: the user locks and then does nothing. Short windows, real chipnet clock.
// BCH judges a time-based locktime by the median time past (about an hour behind the wall clock), so the BCH refund
// arrives roughly 60 to 80 minutes after the lock. usage: node --env-file=.env scripts/e2e-refund.mjs
import { setup } from './e2e-setup.mjs';
import { lockBuilder, addressInputs } from '../lib/bch.js';
import { randomSecret, checkQuote, bchContractFromQuote } from '../lib/client.js';
import { ERC20_ABI, DESK_LOCK_ABI } from '../lib/evm.js';

const R = await setup({ USER_BCH_WINDOW_S: '1500', DESK_EVM_WINDOW_S: '420', BCH_OVERLAP_S: '300', USER_EVM_WINDOW_S: '1500', DESK_BCH_WINDOW_S: '420', EVM_OVERLAP_S: '300', QUOTE_TTL_S: '600' });
const { net, env, desk, token, chain, userBchAddr, userBchLock, userEvm, category, tokensOf, userUsdc, api, out, log, waitFor, explorer } = R;
const verdict = { ok: false };
try {
  const startUser = { tokens: await tokensOf(userBchAddr), usdc: await userUsdc() };
  const startDesk = { tokens: await desk.bch.tokenBalance(category), usdc: await desk.evm.usdcBalance() };

  // A: PUSD -> USDC, user locks BCH, never reveals
  const a = randomSecret();
  const reqA = { dir: 'bch2base', pair: 'PUSD', sendUnits: '30', hashlock: a.hashlock, userBchAddress: userBchAddr, userEvm: userEvm.account.address };
  const qA = await api.quote(reqA);
  if (checkQuote(qA, { ...reqA, userBchLock }, await api.status(), Math.floor(Date.now() / 1000), chain).length) throw new Error('quote A');
  const lockA = await lockBuilder({ provider: chain, contract: bchContractFromQuote(qA, await api.status(), chain), category, tokenAmount: 30n, inputs: await addressInputs(chain, userBchAddr, { keyHex: env.TEST_USER_BCH_KEY }), changeTo: R.userA[net.bch.network === 'mainnet' ? 'mainnetTokens' : 'chipnetTokens'] }).send();
  log('A user locked 0.30 PUSD', lockA.txid, 'refund time', qA.bchRefundTime);

  // B: USDC -> PUSD, user locks USDC, never reveals
  const b = randomSecret();
  const reqB = { dir: 'base2bch', pair: 'PUSD', sendUnits: '300000', hashlock: b.hashlock, userBchAddress: userBchAddr, userEvm: userEvm.account.address };
  const qB = await api.quote(reqB);
  if (checkQuote(qB, { ...reqB, userBchLock }, await api.status(), Math.floor(Date.now() / 1000), chain).length) throw new Error('quote B');
  const w = userEvm.walletClient, p = userEvm.publicClient;
  await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [desk.evm.deskLock, 300000n] }) });
  const lockB = await w.writeContract({ address: desk.evm.deskLock, abi: DESK_LOCK_ABI, functionName: 'lock', args: [desk.evm.address, '0x' + b.hashlock, BigInt(qB.evmTimeout), 300000n] });
  await p.waitForTransactionReceipt({ hash: lockB });
  log('B user locked 0.30 USDC', lockB, 'refund time', qB.evmTimeout);

  const [doneA, doneB] = await Promise.all([waitFor(qA.id, ['refunded'], 7200), waitFor(qB.id, ['refunded'], 7200)]);
  await R.sleep(3000);
  const endUser = { tokens: await tokensOf(userBchAddr), usdc: await userUsdc() };
  const endDesk = { tokens: await desk.bch.tokenBalance(category), usdc: await desk.evm.usdcBalance() };
  Object.assign(verdict, {
    A: { states: doneA.events.map((e) => e.label), deskRefundEvm: doneA.txs.deskRefundEvm, userRefundBch: doneA.txs.userRefund, links: { deskRefundEvm: explorer.evm(doneA.txs.deskRefundEvm), userRefundBch: explorer.bch(doneA.txs.userRefund) } },
    B: { states: doneB.events.map((e) => e.label), deskRefundBch: doneB.txs.deskRefundBch, userRefundEvm: doneB.txs.userRefund, links: { deskRefundBch: explorer.bch(doneB.txs.deskRefundBch), userRefundEvm: explorer.evm(doneB.txs.userRefund) } },
    userTokensDelta: String(endUser.tokens - startUser.tokens), userUsdcDelta: String(endUser.usdc - startUser.usdc),
    deskTokensDelta: String(endDesk.tokens - startDesk.tokens), deskUsdcDelta: String(endDesk.usdc - startDesk.usdc),
  });
  verdict.ok = endUser.tokens === startUser.tokens && endUser.usdc === startUser.usdc && endDesk.tokens === startDesk.tokens && endDesk.usdc === startDesk.usdc;
} finally {
  R.stop();
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}
