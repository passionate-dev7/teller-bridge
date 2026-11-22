import { createConfig, http } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { REOWN_PROJECT_ID } from './config.js';

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  transports: { [base.id]: http(), [baseSepolia.id]: http() },
  connectors: [injected(), ...(REOWN_PROJECT_ID ? [walletConnect({ projectId: REOWN_PROJECT_ID, showQrModal: true, metadata: { name: 'Teller', description: 'PUSD and USDC across Bitcoin Cash and Base', url: location.origin, icons: [] } })] : [])],
});
