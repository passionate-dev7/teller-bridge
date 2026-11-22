// Deploys DeskLock (and TestUSDC on testnets) with DEPLOYER_EVM_KEY and records the addresses in deployments.json.
// usage: node --env-file=.env scripts/deploy-evm.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { clients, DESK_LOCK_ABI, DESK_LOCK_BYTECODE } from '../lib/evm.js';
import { NETWORKS } from '../lib/config.js';
import testUsdc from '../contracts/evm/TestUSDC.json' with { type: 'json' };

const net = NETWORKS[process.env.NETWORK ?? 'testnet'];
const evmInfo = { ...net.evm, rpc: process.env.BASE_RPC_URL || net.evm.rpc };
const { publicClient, walletClient, account } = clients(evmInfo, process.env.DEPLOYER_EVM_KEY);
const file = (process.env.DEPLOYMENTS_FILE ? new URL('file://' + process.env.DEPLOYMENTS_FILE) : new URL('../deployments.json', import.meta.url));
const all = JSON.parse(readFileSync(file, 'utf8'));
const dep = all[evmInfo.chainId] ?? {};
const deploy = async (abi, bytecode, args = []) => {
  const hash = await walletClient.deployContract({ abi, bytecode, args });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error('deploy reverted ' + hash);
  console.log('deployed', r.contractAddress, 'tx', hash);
  return { address: r.contractAddress, tx: hash };
};
console.log('deployer', account.address, 'balance', await publicClient.getBalance({ address: account.address }), 'wei on', evmInfo.name);
if (net.name === 'testnet' && !dep.token) { const t = await deploy(testUsdc.abi, testUsdc.bytecode); dep.token = t.address; dep.tokenTx = t.tx; }
const token = evmInfo.chainId === 8453 ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : dep.token;
if (!dep.deskLock) { const d = await deploy(DESK_LOCK_ABI, DESK_LOCK_BYTECODE, [token]); dep.deskLock = d.address; dep.deskLockTx = d.tx; }
all[evmInfo.chainId] = dep;
writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
console.log(JSON.stringify(dep));
