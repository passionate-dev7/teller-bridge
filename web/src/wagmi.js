import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { REOWN_PROJECT_ID } from './config.js';

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  // plain eth_call: a local node has no Multicall3 deployed, and a single allowance read gains nothing from batching
  batch: { multicall: false },
  // VITE_BASE_RPC_URL points the Base Sepolia transport at a local node for rehearsals; unset, the public RPCs are used
  transports: { [base.id]: http(), [baseSepolia.id]: http(import.meta.env.VITE_BASE_RPC_URL || undefined) },
  connectors: [injected(), ...(REOWN_PROJECT_ID ? [walletConnect({ projectId: REOWN_PROJECT_ID, showQrModal: true, metadata: { name: 'Teller', description: 'PUSD and USDC across Bitcoin Cash and Base', url: location.origin, icons: [] } })] : [])],
});
