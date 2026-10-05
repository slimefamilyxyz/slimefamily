/**
 * Average-cost position accounting. Raw token amounts stay bigint end to end;
 * USD is a double, which is plenty for the sizes agents trade.
 */
export interface Position {
  mint: string;
  symbol: string;
  decimals: number;
  amountRaw: bigint;
  costUsd: number;
  peakPriceUsd: number | null;
  openedAt?: Date;
}

export function applyBuy(
  pos: Position | null,
  fill: { mint: string; symbol: string; decimals: number; amountRaw: bigint; usd: number; priceUsd: number },
): Position {
  if (fill.amountRaw <= 0n) throw new Error('buy fill with no tokens');
  if (!pos) {
    return { mint: fill.mint, symbol: fill.symbol, decimals: fill.decimals, amountRaw: fill.amountRaw, costUsd: fill.usd, peakPriceUsd: fill.priceUsd };
  }
  return {
    ...pos,
    amountRaw: pos.amountRaw + fill.amountRaw,
    costUsd: pos.costUsd + fill.usd,
    peakPriceUsd: Math.max(pos.peakPriceUsd ?? 0, fill.priceUsd),
  };
}

/** Sells part or all of a position. The cost basis leaves in proportion to the tokens that leave. */
export function applySell(pos: Position, amountRaw: bigint, usdOut: number): { position: Position | null; realizedUsd: number } {
  if (amountRaw <= 0n) throw new Error('sell of zero tokens');
  if (amountRaw > pos.amountRaw) throw new Error(`sell of ${amountRaw} exceeds holding ${pos.amountRaw}`);
  const costOut = amountRaw === pos.amountRaw ? pos.costUsd : pos.costUsd * ratio(amountRaw, pos.amountRaw);
  const realizedUsd = usdOut - costOut;
  if (amountRaw === pos.amountRaw) return { position: null, realizedUsd };
  return { position: { ...pos, amountRaw: pos.amountRaw - amountRaw, costUsd: pos.costUsd - costOut }, realizedUsd };
}

/** a / b as a double without losing precision on huge raw amounts. */
export function ratio(a: bigint, b: bigint): number {
  if (b === 0n) throw new Error('ratio by zero');
  const SCALE = 1_000_000_000n;
  return Number((a * SCALE) / b) / Number(SCALE);
}

export function tokensUi(amountRaw: bigint, decimals: number): number {
  return ratio(amountRaw, 10n ** BigInt(decimals));
}

export function valueUsd(pos: Position, priceUsd: number): number {
  return tokensUi(pos.amountRaw, pos.decimals) * priceUsd;
}

export function entryPriceUsd(pos: Position): number {
  const ui = tokensUi(pos.amountRaw, pos.decimals);
  return ui > 0 ? pos.costUsd / ui : 0;
}

/** Share of a holding as raw units, rounding down, never zero unless the holding is. */
export function portion(amountRaw: bigint, percent: number): bigint {
  if (percent >= 100) return amountRaw;
  const bps = BigInt(Math.max(1, Math.round(percent * 100)));
  const part = (amountRaw * bps) / 10_000n;
  return part > 0n ? part : amountRaw;
}
