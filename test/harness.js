// Test rig: a real local EVM (anvil), the BCH VM as the chain (MemoryChain), a desk wired to both, and a scripted user.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { randomUtxo } from 'cashscript';
import { Desk } from '../desk/engine.js';
import { Store } from '../desk/store.js';
import { BchDesk, EvmDesk, MemoryChain } from '../desk/chains.js';
import { clients, DESK_LOCK_ABI, DESK_LOCK_BYTECODE, ERC20_ABI, lockId } from '../lib/evm.js';
import { DEFAULT_RULES, NETWORKS } from '../lib/config.js';
import { addressesOf } from '../lib/keys.js';
import { swapLock, lockBuilder, addressInputs, tokenAddressOf, claimBuilder, lockingBytecodeOf, sha256Hex } from '../lib/bch.js';
import testUsdc from '../contracts/evm/TestUSDC.json' with { type: 'json' };

export const CATEGORY = NETWORKS.testnet.pairs[0].category;
let port = 18545 + Math.floor(Math.random() * 1000);

export async function startAnvil() {
  const p = port++;
  const proc = spawn('anvil', ['--port', String(p), '--silent'], { stdio: 'ignore' });
  const rpc = 'http://127.0.0.1:' + p;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' }); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { rpc, stop: () => proc.kill() };
}

const rpcCall = (rpc, method, params) => fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());

export async function rig({ rules = {} } = {}) {
  const anvil = await startAnvil();
  const evmInfo = { chainId: 31337, name: 'anvil', rpc: anvil.rpc };
  const deployer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const { publicClient, walletClient } = clients(evmInfo, '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const deploy = async (abi, bytecode, args = []) => {
    const hash = await walletClient.deployContract({ abi, bytecode, args });
    return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress;
  };
  const token = await deploy(testUsdc.abi, testUsdc.bytecode);
  const deskLock = await deploy(DESK_LOCK_ABI, DESK_LOCK_BYTECODE, [token]);

  const mkAccount = async () => {
    const key = '0x' + randomBytes(32).toString('hex');
    await rpcCall(anvil.rpc, 'anvil_setBalance', [privateKeyToAccount(key).address, '0x' + parseEther('1').toString(16)]);
    return key;
  };
  const deskEvmKey = await mkAccount();
  const userEvmKey = await mkAccount();
  const mint = async (to, amount) => { const h = await walletClient.writeContract({ address: token, abi: testUsdc.abi, functionName: 'mint', args: [to, amount] }); await publicClient.waitForTransactionReceipt({ hash: h }); };

  const wall = Math.floor(Date.now() / 1000);
  const state = { offset: 0 };
  const clock = () => Math.floor(Date.now() / 1000) + state.offset;
  const chain = new MemoryChain();
  chain.mtp = wall - 3300;

  const deskBchKey = randomBytes(32).toString('hex');
  const deskBchAddr = addressesOf(deskBchKey);
  chain.addUtxo(deskBchAddr.chipnet, { ...randomUtxo(), satoshis: 200_000n });
  const deskBchTokens = 100_000n; // 1000.00 test PUSD
  chain.addUtxo(deskBchAddr.chipnet, { ...randomUtxo(), satoshis: 5000n, token: { category: CATEGORY, amount: deskBchTokens } });

  const deskEvmClients = clients(evmInfo, deskEvmKey);
  const evm = new EvmDesk({ ...deskEvmClients, deskLock, token });
  await mint(evm.address, 10_000_000n); // 10 USDC
  await evm.ensureAllowance();
  const bch = new BchDesk({ provider: chain, prefix: 'bchtest', keyHex: deskBchKey });
  const cfg = { name: 'testnet', bch: NETWORKS.testnet.bch, evm: evmInfo, pairs: NETWORKS.testnet.pairs, rules: { ...DEFAULT_RULES, ...rules } };
  const store = new Store();
  const desk = new Desk({ cfg, bch, evm, store, clock });

  /** move every clock forward: desk clock, EVM block time, BCH median time past */
  const warp = async (seconds) => {
    state.offset += seconds;
    await rpcCall(anvil.rpc, 'evm_increaseTime', [seconds]);
    await rpcCall(anvil.rpc, 'evm_mine', []);
    chain.mtp += seconds;
  };

  // ---- a scripted user: BCH wallet + Base wallet ----
  const userBchKey = randomBytes(32).toString('hex');
  const userBch = addressesOf(userBchKey);
  const userEvm = clients(evmInfo, userEvmKey);
  const fundUserBch = (tokens) => {
    chain.addUtxo(userBch.chipnet, { ...randomUtxo(), satoshis: 50_000n });
    if (tokens) chain.addUtxo(userBch.chipnet, { ...randomUtxo(), satoshis: 2000n, token: { category: CATEGORY, amount: tokens } });
  };
  const user = {
    bchKey: userBchKey, bch: userBch, evmKey: userEvmKey, evm: userEvm, fundBch: fundUserBch,
    secret: () => { const secret = randomBytes(32).toString('hex'); return { secret, hashlock: sha256Hex(secret) }; },
    async fundUsdc(amount) { await mint(userEvm.account.address, amount); },
    usdc: (addr = userEvm.account.address) => publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }),
    bchTokens: async (addr = userBch.chipnet) => (await chain.getUtxos(addr)).reduce((a, u) => (u.token ? a + u.token.amount : a), 0n),
    request: (o) => desk.createSwap({ userBchAddress: userBch.chipnet, userEvm: userEvm.account.address, pair: 'PUSD', ...o }),
    /** the swap lock exactly as the user derives it from the quote's public terms */
    bchContract: (q) => swapLock({ hashlock: q.hashlock, recipientLock: q.dir === 'bch2base' ? bch.lockingHex : q.userBchLock, refundLock: q.dir === 'bch2base' ? q.userBchLock : bch.lockingHex, refundTime: q.bchRefundTime }, chain),
    async lockBch(q) {
      const contract = user.bchContract(q);
      const inputs = await addressInputs(chain, userBch.chipnet, { keyHex: userBchKey });
      return (await lockBuilder({ provider: chain, contract, category: CATEGORY, tokenAmount: BigInt(q.sendUnits), inputs, changeTo: userBch.chipnetTokens }).send()).txid;
    },
    async lockUsdc(q) {
      const w = userEvm.walletClient;
      await publicClient.waitForTransactionReceipt({ hash: await w.writeContract({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [deskLock, BigInt(q.sendUnits)] }) });
      const hash = await w.writeContract({ address: deskLock, abi: DESK_LOCK_ABI, functionName: 'lock', args: [evm.address, '0x' + q.hashlock, BigInt(q.evmTimeout), BigInt(q.sendUnits)] });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    },
    async claimUsdcSelf(q, secret) {
      await publicClient.waitForTransactionReceipt({ hash: await userEvm.walletClient.writeContract({ address: deskLock, abi: DESK_LOCK_ABI, functionName: 'claim', args: [q.evmLockId, '0x' + secret] }) });
    },
    async claimBchSelf(q, secret) {
      const utxo = (await user.bchContract(q).getUtxos())[0];
      return (await claimBuilder({ provider: chain, contract: user.bchContract(q), utxo, secretHex: secret, recipientLock: lockingBytecodeOf(userBch.chipnet), prefix: 'bchtest' }).send()).txid;
    },
  };
  const swap = (id) => desk.getSwap(id);
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) await desk.tick(); };
  return { desk, evm, bch, chain, store, user, anvil, warp, tick, swap, clock, cfg, publicClient, token, deskLock, rules: cfg.rules, deskTokens: () => bch.tokenBalance(CATEGORY), stop: () => anvil.stop() };
}
