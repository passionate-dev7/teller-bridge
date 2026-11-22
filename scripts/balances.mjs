// Desk and deployer balances on the selected network. usage: node --env-file=.env scripts/balances.mjs
import { readFileSync } from 'node:fs';
import { Network } from 'cashscript';
import { clients, ERC20_ABI } from '../lib/evm.js';
import { NETWORKS } from '../lib/config.js';
import { addressesOf } from '../lib/keys.js';
import { fmtUsd } from '../lib/amounts.js';
import { ElectrumChain } from '../desk/chains.js';

const net = NETWORKS[process.env.NETWORK ?? 'testnet'];
const evmInfo = { ...net.evm, rpc: process.env.BASE_RPC_URL || net.evm.rpc };
const dep = JSON.parse(readFileSync((process.env.DEPLOYMENTS_FILE ? new URL('file://' + process.env.DEPLOYMENTS_FILE) : new URL('../deployments.json', import.meta.url)), 'utf8'))[evmInfo.chainId] ?? {};
const token = evmInfo.chainId === 8453 ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' : dep.token;
const { publicClient, account: desk } = clients(evmInfo, process.env.DESK_EVM_KEY);
const { account: deployer } = clients(evmInfo, process.env.DEPLOYER_EVM_KEY);
const out = { network: net.name, evm: evmInfo.name };
for (const [k, a] of [['desk', desk], ['deployer', deployer]]) {
  out[k + 'Evm'] = { address: a.address, ethWei: String(await publicClient.getBalance({ address: a.address })) };
}
if (token) out.deskEvm.usdc = fmtUsd(await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [desk.address] }), 6);
const a = addressesOf(process.env.DESK_BCH_KEY);
const chain = new ElectrumChain(net.bch.network === 'mainnet' ? Network.MAINNET : Network.CHIPNET);
const utxos = await chain.getUtxos(net.bch.network === 'mainnet' ? a.mainnet : a.chipnet);
out.deskBch = { address: net.bch.network === 'mainnet' ? a.mainnetTokens : a.chipnetTokens, sats: String(utxos.filter((u) => !u.token).reduce((s, u) => s + u.satoshis, 0n)) };
for (const p of net.pairs) out.deskBch[p.symbol] = fmtUsd(utxos.reduce((s, u) => (u.token?.category === p.category ? s + u.token.amount : s), 0n), 2);
console.log(JSON.stringify(out, null, 2));
