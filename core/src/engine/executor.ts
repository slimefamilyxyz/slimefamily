import { stableOf, stableRawToUsd, usdToStableRaw, type Jupiter } from '../market/jupiter.js';

export interface Fill {
  amountRaw: bigint;
  /** USDC that left (buy) or arrived (sell), after the platform fee. */
  usd: number;
  priceImpactPct: number;
  signature: string | null;
  /** The platform's cut of this swap, in USD. */
  feeUsd?: number;
}

export const feeOf = (usd: number, bps: number) => (usd * bps) / 10_000;

/** Who is trading: the executor needs the wallet, the live one also the agent to find its key. */
export interface ExecAgent {
  id: number;
  walletAddress: string;
}

export class TradeRejected extends Error {}

/** A live swap was sent but its fate is not known yet; the next turn settles it from the chain. */
export class SwapPending extends Error {
  /** `lastValidBlockHeight`: past it the swap can no longer land. */
  constructor(
    readonly signature: string,
    readonly lastValidBlockHeight: number | null = null,
    /** EVM: the transaction's nonce; once the chain has moved past it without a receipt, it never landed. */
    readonly evmNonce: number | null = null,
  ) {
    super(`swap ${signature} not confirmed yet`);
  }
}

export interface Executor {
  readonly mode: 'paper' | 'live';
  buy(agent: ExecAgent, mint: string, usd: number, maxImpactPct: number): Promise<Fill>;
  sell(agent: ExecAgent, mint: string, amountRaw: bigint): Promise<Fill>;
}

export const SLIPPAGE_BPS = 100;

/** A buy whose tokens could not be sold straight back for at least this share of the money is refused. */
export const MIN_SELL_BACK_PCT = 80;

/**
 * Platform rail against honeypots and one-way pools: before buying, ask for
 * the route back. No route, or a round trip that loses more than a fifth,
 * means the owner's stop loss could not get them out.
 */
export async function assertSellable(jupiter: Jupiter, mint: string, amountRaw: bigint, usdIn: number): Promise<void> {
  const stable = stableOf(jupiter);
  let back: Awaited<ReturnType<Jupiter['quote']>>;
  try {
    back = await jupiter.quote(mint, stable.mint, amountRaw, SLIPPAGE_BPS);
  } catch {
    throw new TradeRejected('no route to sell this token back');
  }
  const backUsd = stableRawToUsd(back.outAmount, stable);
  if (backUsd < (usdIn * MIN_SELL_BACK_PCT) / 100) {
    throw new TradeRejected(`selling straight back would return $${backUsd.toFixed(2)} of $${usdIn.toFixed(2)}`);
  }
}

/**
 * Paper trading on real routes: every fill is the amount Jupiter's live quote
 * says the swap would return, so a paper week measures the same thing a live
 * week would, minus network fees and slippage beyond the quote.
 */
export function paperExecutor(jupiter: Jupiter, feeBps = 0): Executor {
  return {
    mode: 'paper',
    // The platform fee comes out of the USDC side, as it does live: a buy swaps what is left after it.
    async buy(_agent, mint, usd, maxImpactPct) {
      const feeUsd = feeOf(usd, feeBps);
      const stable = stableOf(jupiter);
      const q = await jupiter.quote(stable.mint, mint, usdToStableRaw(usd - feeUsd, stable), SLIPPAGE_BPS);
      if (q.priceImpactPct > maxImpactPct) {
        throw new TradeRejected(`price impact ${q.priceImpactPct.toFixed(2)}% is over the ${maxImpactPct}% limit`);
      }
      if (q.outAmount <= 0n) throw new TradeRejected('no route returns tokens for this amount');
      await assertSellable(jupiter, mint, q.outAmount, usd - feeUsd);
      return { amountRaw: q.outAmount, usd, priceImpactPct: q.priceImpactPct, signature: null, feeUsd };
    },
    // Sells are never blocked on impact: an owner's stop loss must be able to get out.
    async sell(_agent, mint, amountRaw) {
      const stable = stableOf(jupiter);
      const q = await jupiter.quote(mint, stable.mint, amountRaw, SLIPPAGE_BPS);
      const gross = stableRawToUsd(q.outAmount, stable);
      const feeUsd = feeOf(gross, feeBps);
      return { amountRaw, usd: gross - feeUsd, priceImpactPct: q.priceImpactPct, signature: null, feeUsd };
    },
  };
}
