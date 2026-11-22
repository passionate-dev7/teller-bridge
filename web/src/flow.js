// The browser side of a swap, as plain async functions the UI calls. Nothing here renders anything.
import { Network, ElectrumNetworkProvider } from 'cashscript';
import { lockBuilder, claimBuilder, lockingBytecodeOf, tokenAddressOf } from '../../lib/bch.js';
import { randomSecret, checkQuote, bchContractFromQuote } from '../../lib/client.js';
import { signBuilder } from '../../lib/wizard.js';
import { DESK_LOCK_ABI, ERC20_ABI } from '../../lib/evm.js';
import { money } from './format.js';

export const bchProvider = (status) => new ElectrumNetworkProvider(status.bch.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET);

const KEY = 'teller.swaps';
export const saved = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
export const keep = (rec) => { const all = saved().filter((r) => r.hashlock !== rec.hashlock); all.unshift({ ...rec, at: Date.now() }); localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20))); };
export const forget = (hashlock) => localStorage.setItem(KEY, JSON.stringify(saved().filter((r) => r.hashlock !== hashlock)));

const now = () => Math.floor(Date.now() / 1000);

/** PUSD (or MUSD) on Bitcoin Cash -> USDC on Base. One wallet signature on the BCH lock; the desk does the rest. */
export async function startBchToBase({ api, status, pair, cents, baseAddress, wallet }) {
  const provider = bchProvider(status);
  const { secret, hashlock } = randomSecret();
  const req = { dir: 'bch2base', pair, sendUnits: cents.toString(), hashlock, userBchAddress: wallet.scan.receive.address, userEvm: baseAddress };
  keep({ hashlock, secret, dir: 'bch2base', pair, cents: cents.toString() });
  const quote = await api.quote(req);
  const problems = checkQuote(quote, { ...req, userBchLock: lockingBytecodeOf(req.userBchAddress) }, status, now(), provider);
  if (problems.length) throw new Error('Quote refused by your browser: ' + problems.join('; '));
  keep({ hashlock, secret, dir: 'bch2base', pair, cents: cents.toString(), id: quote.id });
  const category = status.pairs.find((p) => p.symbol === pair).category;
  const contract = bchContractFromQuote(quote, status, provider);
  const builder = lockBuilder({ provider, contract, category, tokenAmount: cents, inputs: wallet.scan.inputs, changeTo: wallet.scan.receive.tokenAddress });
  const prompt = 'Lock ' + money(cents, 2) + ' ' + pair + ' for ' + money(quote.recvUnits, 6, 2) + ' USDC on Base. Only the desk can take it, and only with your secret.';
  const hex = await signBuilder(wallet.manager, builder, wallet.scan.inputs, prompt);
  const txid = await provider.sendRawTransaction(hex);
  keep({ hashlock, secret, dir: 'bch2base', pair, cents: cents.toString(), id: quote.id, userLockTx: txid });
  return { quote, secret, userLockTx: txid };
}

/** USDC on Base -> PUSD on Bitcoin Cash. Needs a Base wallet for approve and lock; the PUSD arrives without any BCH signature. */
export async function startBaseToBch({ api, status, pair, cents, bchAddress, evm }) {
  const provider = bchProvider(status);
  const { secret, hashlock } = randomSecret();
  const units = cents * 10_000n;
  const req = { dir: 'base2bch', pair, sendUnits: units.toString(), hashlock, userBchAddress: bchAddress, userEvm: evm.address };
  keep({ hashlock, secret, dir: 'base2bch', pair, cents: cents.toString() });
  const quote = await api.quote(req);
  const problems = checkQuote(quote, { ...req, userBchLock: lockingBytecodeOf(bchAddress) }, status, now(), provider);
  if (problems.length) throw new Error('Quote refused by your browser: ' + problems.join('; '));
  keep({ hashlock, secret, dir: 'base2bch', pair, cents: cents.toString(), id: quote.id });
  if (evm.chainId !== status.evm.chainId) await evm.switchChain(status.evm.chainId);
  const allowance = await evm.publicClient.readContract({ address: status.evm.token, abi: ERC20_ABI, functionName: 'allowance', args: [evm.address, status.evm.deskLock] });
  if (allowance < units) {
    const h = await evm.write({ address: status.evm.token, abi: ERC20_ABI, functionName: 'approve', args: [status.evm.deskLock, units] });
    await evm.publicClient.waitForTransactionReceipt({ hash: h });
  }
  const lockHash = await evm.write({ address: status.evm.deskLock, abi: DESK_LOCK_ABI, functionName: 'lock', args: [status.evm.deskAddress, '0x' + hashlock, BigInt(quote.evmTimeout), units] });
  keep({ hashlock, secret, dir: 'base2bch', pair, cents: cents.toString(), id: quote.id, userLockTx: lockHash });
  await evm.publicClient.waitForTransactionReceipt({ hash: lockHash });
  return { quote, secret, userLockTx: lockHash };
}

/** Fallback when the desk does not relay the payout: claim the BCH stable yourself. No signature needed, the covenant pays your address. */
export async function claimBchYourself({ status, swap, secret }) {
  const provider = bchProvider(status);
  const contract = bchContractFromQuote(swap, status, provider);
  const utxo = (await contract.getUtxos())[0];
  if (!utxo) throw new Error('Nothing left to claim at the lock address.');
  return (await claimBuilder({ provider, contract, utxo, secretHex: secret, recipientLock: swap.userBchLock, prefix: status.bch.prefix }).send()).txid;
}

/** Fallback: claim the USDC yourself with your Base wallet (needs a little ETH for gas). */
export async function claimBaseYourself({ status, swap, secret, evm }) {
  if (evm.chainId !== status.evm.chainId) await evm.switchChain(status.evm.chainId);
  return evm.write({ address: status.evm.deskLock, abi: DESK_LOCK_ABI, functionName: 'claim', args: [swap.evmLockId, '0x' + secret] });
}

export { tokenAddressOf };
