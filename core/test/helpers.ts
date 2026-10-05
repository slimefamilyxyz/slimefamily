// The test helpers of the platform, without its database part (not needed by these tests).
import type { Stable } from '../src/chains.js';
import type { Candidate } from '../src/market/candidates.js';
import type { Jupiter, TokenPrice } from '../src/market/jupiter.js';
import { USDC_MINT } from '../src/market/jupiter.js';

export const MASTER = 'ab'.repeat(32);

export const MINT_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const MINT_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

export function candidate(mint: string, over: Partial<Candidate> = {}): Candidate {
  return {
    mint,
    symbol: mint.slice(0, 3),
    name: `Token ${mint.slice(0, 3)}`,
    priceUsd: 0.01,
    liquidityUsd: 200_000,
    marketCapUsd: 1_000_000,
    volumeUsd: { m5: 1000, h1: 10_000, h24: 100_000 },
    changePct: { m5: 1, h1: 5, h24: 20 },
    txnsH1: { buys: 300, sells: 200 },
    ageHours: 30,
    imageUrl: null,
    ...over,
  };
}

/** A Jupiter whose prices the test sets; quotes swap at those prices with a fixed impact. */
export function fakeJupiter(prices: Record<string, number>, decimals = 6, impactPct = 0.5, stable?: Stable): Jupiter & { prices_: Record<string, number> } {
  // The chain's dollar: Solana USDC unless a test gives another (BNB's USDT has 18 decimals).
  const cash = stable ?? { mint: USDC_MINT, symbol: 'USDC', decimals: 6 };
  return {
    prices_: prices,
    ...(stable ? { stable } : {}),
    async quote(input, output, amount) {
      const usdcIn = input === cash.mint;
      const mint = usdcIn ? output : input;
      const price = prices[mint];
      if (price === undefined) throw new Error(`no route for ${mint}`);
      const out = usdcIn
        ? BigInt(Math.floor(((Number(amount) / 10 ** cash.decimals) / price) * 10 ** decimals))
        : BigInt(Math.floor(((Number(amount) / 10 ** decimals) * price) * 10 ** cash.decimals));
      return { inAmount: amount, outAmount: out, priceImpactPct: impactPct, raw: null };
    },
    async swapTransaction() {
      throw new Error('fake jupiter builds no transactions; use fakeLive');
    },
    async prices(mints) {
      const m = new Map<string, TokenPrice>();
      for (const mint of mints) if (prices[mint] !== undefined) m.set(mint, { usdPrice: prices[mint]!, decimals });
      return m;
    },
  };
}
