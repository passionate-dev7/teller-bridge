// Networks, assets and desk rules. Pure data plus the timing policy; nothing here touches a chain.
export const PUSD_CATEGORY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544';
export const MUSD_CATEGORY = 'b38a33f750f84c5c169a6f23cb873e6e79605021585d4f3408789689ed87f366';

/** BCH stables carry 2 decimals, USDC 6: one BCH stable unit is RATIO USDC units at the 1:1 peg. */
export const BCH_DECIMALS = 2;
export const USDC_DECIMALS = 6;
export const RATIO = 10_000n;
export const BPS = 10_000n;

/** USDC where it already exists; on testnets the deployment record carries the test token */
export const USDC = { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };

export const NETWORKS = {
  testnet: {
    name: 'testnet',
    bch: { network: 'chipnet', prefix: 'bchtest', explorerTx: 'https://chipnet.imaginary.cash/tx/', explorerAddr: 'https://chipnet.imaginary.cash/address/' },
    evm: { chainId: 84532, name: 'Base Sepolia', rpc: 'https://sepolia.base.org', explorerTx: 'https://sepolia.basescan.org/tx/', explorerAddr: 'https://sepolia.basescan.org/address/' },
    // chipnet has no PUSD: a token minted on chipnet stands in, same 2 decimals
    pairs: [{ symbol: 'PUSD', label: 'ParyonUSD (test)', category: 'b8d87457be883dd4d3bdd79b72f40aca5991dbe2cf2aeae5296671a73a0a51a6' }],
  },
  mainnet: {
    name: 'mainnet',
    bch: { network: 'mainnet', prefix: 'bitcoincash', explorerTx: 'https://blockchair.com/bitcoin-cash/transaction/', explorerAddr: 'https://blockchair.com/bitcoin-cash/address/' },
    evm: { chainId: 8453, name: 'Base', rpc: 'https://mainnet.base.org', explorerTx: 'https://basescan.org/tx/', explorerAddr: 'https://basescan.org/address/' },
    pairs: [
      { symbol: 'PUSD', label: 'ParyonUSD', category: PUSD_CATEGORY },
      { symbol: 'MUSD', label: 'MUSD', category: MUSD_CATEGORY },
    ],
  },
};

/** Desk economics and timing. Seconds. Overridable per deployment through the desk env. */
export const DEFAULT_RULES = {
  feeBps: 30n,
  minUsdCents: 25n,
  quoteTtl: 600,
  maxActive: 20,
  maxActivePerIp: 3,
  // BCH to Base: the user's BCH lock outlives the desk's USDC lock by at least bchOverlap
  userBchWindow: 4 * 3600,
  deskEvmWindow: 90 * 60,
  overlap: 60 * 60,
  // Base to BCH: the user's USDC lock must outlive the desk's BCH lock by evmOverlap, which covers BCH median-time lag
  userEvmWindow: 5 * 3600,
  deskBchWindow: 60 * 60,
  evmOverlap: 2.5 * 3600,
  pollMs: 4000,
  // BCH side locks up to this many cents are answered from the mempool; larger ones wait for one confirmation
  zeroConfMaxCents: 2500n,
  minGasWei: 20_000_000_000_000n,
  minSats: 15_000n,
};

export const rulesFromEnv = (env = {}) => {
  const n = (k, d) => (env[k] === undefined || env[k] === '' ? d : Number(env[k]));
  return {
    ...DEFAULT_RULES,
    feeBps: BigInt(n('FEE_BPS', Number(DEFAULT_RULES.feeBps))),
    minUsdCents: BigInt(n('MIN_USD_CENTS', Number(DEFAULT_RULES.minUsdCents))),
    zeroConfMaxCents: BigInt(n('ZERO_CONF_MAX_CENTS', Number(DEFAULT_RULES.zeroConfMaxCents))),
    userBchWindow: n('USER_BCH_WINDOW_S', DEFAULT_RULES.userBchWindow),
    deskEvmWindow: n('DESK_EVM_WINDOW_S', DEFAULT_RULES.deskEvmWindow),
    overlap: n('BCH_OVERLAP_S', DEFAULT_RULES.overlap),
    userEvmWindow: n('USER_EVM_WINDOW_S', DEFAULT_RULES.userEvmWindow),
    deskBchWindow: n('DESK_BCH_WINDOW_S', DEFAULT_RULES.deskBchWindow),
    evmOverlap: n('EVM_OVERLAP_S', DEFAULT_RULES.evmOverlap),
    quoteTtl: n('QUOTE_TTL_S', DEFAULT_RULES.quoteTtl),
    pollMs: n('POLL_MS', DEFAULT_RULES.pollMs),
  };
};
