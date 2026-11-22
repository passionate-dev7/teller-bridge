// Chain reads the browser makes itself, never through the desk: the Base lock table and BCH confirmations.
import { createPublicClient, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { readLock } from '../../lib/evm.js';
import { confirmationsOf } from '../../lib/bch.js';
import { bchProvider } from './flow.js';
import { pinnedFor } from './pinned.js';

export function makeReads(status) {
  const pin = pinnedFor(status);
  const chain = pin.chainId === base.id ? base : baseSepolia;
  const client = createPublicClient({ chain, transport: http(chain.id === baseSepolia.id ? import.meta.env.VITE_BASE_RPC_URL || undefined : undefined) });
  const provider = bchProvider(status);
  return { pin, evmLock: (id) => readLock(client, pin.deskLock, id), provider, confirmations: (txid) => confirmationsOf(provider, txid) };
}
