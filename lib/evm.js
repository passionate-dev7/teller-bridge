// EVM side: DeskLock ABI, lock ids, viem clients. Isomorphic.
import { createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256, parseAbi, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import deskLock from '../contracts/evm/DeskLock.json' with { type: 'json' };

export const DESK_LOCK_ABI = deskLock.abi;
export const DESK_LOCK_BYTECODE = deskLock.bytecode;
export const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
/** lock states in DeskLock.State */
export const LOCK_STATE = { None: 0, Open: 1, Claimed: 2, Refunded: 3 };

/** Mirrors keccak256(abi.encode(sender, recipient, hashlock, timeout, amount)) in DeskLock.lock. */
export const lockId = ({ sender, recipient, hashlock, timeout, amount }) =>
  keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'uint256' }],
    [sender, recipient, '0x' + hashlock.replace(/^0x/, ''), BigInt(timeout), BigInt(amount)],
  ));

export const chainFor = ({ chainId, name, rpc }) => defineChain({ id: chainId, name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

export function clients({ chainId, name, rpc }, deskKey) {
  const chain = chainFor({ chainId, name, rpc });
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const account = deskKey ? privateKeyToAccount(deskKey) : undefined;
  const walletClient = account ? createWalletClient({ chain, account, transport: http(rpc) }) : undefined;
  return { chain, publicClient, walletClient, account };
}

/** DeskLock.locks(id) as a plain object. Works with any viem public client, so the desk and a browser read the same way. */
export async function readLock(publicClient, deskLock, id) {
  const [sender, recipient, timeout, state, amount, hashlock] = await publicClient.readContract({ address: deskLock, abi: DESK_LOCK_ABI, functionName: 'locks', args: [id] });
  return { sender, recipient, timeout: Number(timeout), state, amount, hashlock };
}
