import { Buffer } from 'buffer';
globalThis.Buffer ??= Buffer;
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './wagmi.js';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>,
);
