import { useEffect, useMemo, useState, useCallback } from 'react';
import { useWizardConnect } from '@wizardconnect/react';
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { scanWallet } from '../../lib/wizard.js';
import { bchProvider } from './flow.js';

/** Bitcoin Cash side: WizardConnect pairing plus a scan of the paired wallet's coins. */
export function useBchWallet(status) {
  const wc = useWizardConnect({ dappName: 'Teller', sessionKey: 'teller-wc' });
  const { manager, state } = wc;
  const paired = !!manager && (state === 'connected' || ((state === 'reconnecting' || state === 'connecting') && manager.getSessionPaths().length > 0));
  const provider = useMemo(() => (status ? bchProvider(status) : null), [status?.bch?.network]);
  const [scan, setScan] = useState(null);
  const [scanError, setScanError] = useState(null);
  const rescan = useCallback(async () => {
    if (!paired || !provider || !status) return;
    try { setScan(await scanWallet(manager, provider, status.bch.prefix)); setScanError(null); } catch (e) { setScanError(e.message); }
  }, [paired, provider, manager, status?.bch?.prefix]);
  useEffect(() => { if (paired) rescan(); else setScan(null); }, [paired, rescan]);
  return { wc, manager, paired, scan, scanError, rescan };
}

/** Base side: any injected wallet, or WalletConnect when a project id is configured. */
export function useEvmWallet() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  return {
    address, chainId, isConnected, connectors,
    connect: (c) => connectAsync({ connector: c }),
    disconnect,
    switchChain: (id) => switchChainAsync({ chainId: id }),
    write: (req) => writeContractAsync(req),
    publicClient,
  };
}
