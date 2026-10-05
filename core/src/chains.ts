/**
 * The chains a slime can live on. One chain per slime, chosen at hatch: its
 * wallet, market and quotes all come from that chain, and its cash is that
 * chain's dollar stablecoin. Addresses checked on 2026-10-03 against LI.FI's
 * token list, the chains' explorers and on-chain supply.
 */
export type ChainId = 'solana' | 'base' | 'bsc' | 'robinhood' | 'ethereum';

export interface Stable {
  /** Token address (mint on Solana). EVM addresses are kept lower-case everywhere. */
  mint: string;
  symbol: string;
  decimals: number;
}

export interface ChainSpec {
  id: ChainId;
  name: string;
  kind: 'svm' | 'evm';
  /** EIP-155 id for EVM chains. */
  evmChainId: number | null;
  stable: Stable;
  native: { symbol: string; decimals: number; wrapped: string };
  /** Ids the market feeds use for this chain. */
  dexscreener: string;
  geckoterminal: string;
  /** KyberSwap aggregator path segment (EVM). */
  kyberswap: string | null;
  /** A public RPC for reads (token decimals), overridable by env. */
  publicRpc: string | null;
  explorer: { tx: string; address: string; token: string };
}

export const CHAINS: Record<ChainId, ChainSpec> = {
  solana: {
    id: 'solana',
    name: 'Solana',
    kind: 'svm',
    evmChainId: null,
    stable: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 },
    native: { symbol: 'SOL', decimals: 9, wrapped: 'So11111111111111111111111111111111111111112' },
    dexscreener: 'solana',
    geckoterminal: 'solana',
    kyberswap: null,
    publicRpc: null,
    explorer: { tx: 'https://solscan.io/tx/', address: 'https://solscan.io/account/', token: 'https://solscan.io/token/' },
  },
  base: {
    id: 'base',
    name: 'Base',
    kind: 'evm',
    evmChainId: 8453,
    stable: { mint: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', symbol: 'USDC', decimals: 6 },
    native: { symbol: 'ETH', decimals: 18, wrapped: '0x4200000000000000000000000000000000000006' },
    dexscreener: 'base',
    geckoterminal: 'base',
    kyberswap: 'base',
    publicRpc: 'https://mainnet.base.org',
    explorer: { tx: 'https://basescan.org/tx/', address: 'https://basescan.org/address/', token: 'https://basescan.org/token/' },
  },
  bsc: {
    id: 'bsc',
    name: 'BNB Chain',
    kind: 'evm',
    evmChainId: 56,
    // USDT is the dollar of BNB Chain's memecoin pools; note its 18 decimals.
    stable: { mint: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT', decimals: 18 },
    native: { symbol: 'BNB', decimals: 18, wrapped: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c' },
    dexscreener: 'bsc',
    geckoterminal: 'bsc',
    kyberswap: 'bsc',
    publicRpc: 'https://bsc-dataseed.bnbchain.org',
    explorer: { tx: 'https://bscscan.com/tx/', address: 'https://bscscan.com/address/', token: 'https://bscscan.com/token/' },
  },
  robinhood: {
    id: 'robinhood',
    name: 'Robinhood Chain',
    kind: 'evm',
    evmChainId: 4663,
    // Paxos USDG: USDC barely exists here (~340 bridged). A second "USDG" with ~1,100 supply is not this one.
    stable: { mint: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', decimals: 6 },
    native: { symbol: 'ETH', decimals: 18, wrapped: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' },
    dexscreener: 'robinhood',
    geckoterminal: 'robinhood',
    kyberswap: 'robinhood',
    publicRpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: { tx: 'https://robin.etherscan.io/tx/', address: 'https://robin.etherscan.io/address/', token: 'https://robin.etherscan.io/token/' },
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    kind: 'evm',
    evmChainId: 1,
    stable: { mint: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
    native: { symbol: 'ETH', decimals: 18, wrapped: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
    dexscreener: 'ethereum',
    geckoterminal: 'eth',
    kyberswap: 'ethereum',
    publicRpc: 'https://ethereum-rpc.publicnode.com',
    explorer: { tx: 'https://etherscan.io/tx/', address: 'https://etherscan.io/address/', token: 'https://etherscan.io/token/' },
  },
};

export const CHAIN_IDS = Object.keys(CHAINS) as ChainId[];

export function isChainId(v: unknown): v is ChainId {
  return typeof v === 'string' && Object.hasOwn(CHAINS, v);
}

/** A token address in the form the code keys it by: EVM lower-cased, Solana as is. */
export function normalizeAddress(chain: ChainId, address: string): string {
  return CHAINS[chain].kind === 'evm' ? address.toLowerCase() : address;
}

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Whether `address` is a well-formed address on `chain` (or on any chain, when none is given). */
export function isAddress(address: string, chain?: ChainId): boolean {
  if (!chain) return SOLANA_ADDRESS.test(address) || EVM_ADDRESS.test(address);
  return CHAINS[chain].kind === 'evm' ? EVM_ADDRESS.test(address) : SOLANA_ADDRESS.test(address);
}
