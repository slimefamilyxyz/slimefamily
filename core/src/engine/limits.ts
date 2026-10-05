import type { Candidate } from '../market/candidates.js';
import { PLATFORM_MIN_LIQUIDITY_USD, type Settings } from './settings.js';

/** Why a token is off-limits for buying under these settings, or null if it may be bought. */
export function tokenBlockReason(c: Candidate, s: Settings): string | null {
  if (s.denyList.includes(c.mint)) return 'on the deny list';
  if (s.allowList.length > 0 && !s.allowList.includes(c.mint)) return 'not on the allow list';
  const minLiq = Math.max(s.minLiquidityUsd, PLATFORM_MIN_LIQUIDITY_USD);
  if (c.liquidityUsd < minLiq) return `liquidity $${Math.round(c.liquidityUsd)} below $${minLiq}`;
  if (s.minAgeHours !== null && s.minAgeHours > 0) {
    if (c.ageHours === null) return 'age unknown';
    if (c.ageHours < s.minAgeHours) return `${c.ageHours.toFixed(1)}h old, younger than ${s.minAgeHours}h`;
  }
  if (s.minVolumeH1Usd !== null && c.volumeUsd.h1 < s.minVolumeH1Usd) return `1h volume $${Math.round(c.volumeUsd.h1)} below $${s.minVolumeH1Usd}`;
  if (s.minMarketCapUsd !== null && (c.marketCapUsd ?? 0) < s.minMarketCapUsd) return 'market cap below the minimum';
  if (s.maxMarketCapUsd !== null && (c.marketCapUsd ?? Infinity) > s.maxMarketCapUsd) return 'market cap above the maximum';
  return null;
}

export function buyableCandidates(cands: Candidate[], s: Settings): Candidate[] {
  return cands.filter((c) => tokenBlockReason(c, s) === null);
}

export interface BuyContext {
  usd: number;
  cashUsd: number;
  equityUsd: number;
  openPositions: number;
  /** Current value of this token already held; the position cap covers the whole position, not one buy. */
  heldValueUsd: number;
  boughtTodayUsd: number;
}

/** Caps a requested buy to what the settings allow; returns the allowed size or why none is allowed. */
export function sizeBuy(ctx: BuyContext, s: Settings): { usd: number } | { rejected: string } {
  if (!Number.isFinite(ctx.usd) || ctx.usd <= 0) return { rejected: 'buy size must be positive' };
  if (ctx.heldValueUsd <= 0 && ctx.openPositions >= s.maxOpenPositions) {
    return { rejected: `already holding ${ctx.openPositions} positions (max ${s.maxOpenPositions})` };
  }
  let usd = Math.min(ctx.usd, (ctx.equityUsd * s.maxPositionPct) / 100 - ctx.heldValueUsd, ctx.cashUsd);
  if (s.dailyBuyLimitUsd !== null) usd = Math.min(usd, s.dailyBuyLimitUsd - ctx.boughtTodayUsd);
  // Below a dollar the swap fee eats the trade.
  if (usd < 1) return { rejected: 'no room left under cash, position size or daily limit' };
  return { usd: Math.floor(usd * 100) / 100 };
}
