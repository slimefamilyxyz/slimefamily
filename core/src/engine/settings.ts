import { isAddress } from '../chains.js';
import { z } from 'zod';

// minAgeHours: on the first paper day 87% of realized losses came from tokens bought in their first six hours.
export const RISK_PROFILES: Record<'careful' | 'balanced' | 'degen', { maxPositionPct: number; maxPriceImpactPct: number; minLiquidityUsd: number; minAgeHours: number | null }> = {
  careful: { maxPositionPct: 10, maxPriceImpactPct: 1, minLiquidityUsd: 100_000, minAgeHours: 72 },
  balanced: { maxPositionPct: 15, maxPriceImpactPct: 2, minLiquidityUsd: 25_000, minAgeHours: 24 },
  degen: { maxPositionPct: 25, maxPriceImpactPct: 4, minLiquidityUsd: 10_000, minAgeHours: 1 },
};

/** Platform rails: below these no owner setting reaches, because quotes and P&L stop meaning anything there. */
export const PLATFORM_MIN_LIQUIDITY_USD = 10_000;

export type RiskProfile = keyof typeof RISK_PROFILES;

// A token address on any supported chain; EVM ones are lower-cased, the form candidates are keyed by.
const mint = z
  .string()
  .refine((a) => isAddress(a), 'not a token address')
  .transform((a) => (a.startsWith('0x') ? a.toLowerCase() : a));

/** What an owner controls. The server enforces every field on every trade; the brain only sees them as rules. */
export const SettingsSchema = z.object({
  risk: z.enum(['careful', 'balanced', 'degen']),
  maxPositionPct: z.number().min(1).max(100),
  maxPriceImpactPct: z.number().min(0.1).max(10),
  // Not min(PLATFORM_MIN_LIQUIDITY_USD): older settings may sit below it, and the floor is applied in limits.ts.
  minLiquidityUsd: z.number().min(0),
  minAgeHours: z.number().min(0).max(8760).nullable(),
  minVolumeH1Usd: z.number().min(0).nullable(),
  minMarketCapUsd: z.number().min(0).nullable(),
  maxMarketCapUsd: z.number().min(0).nullable(),
  takeProfitPct: z.number().min(1).max(10_000).nullable(),
  stopLossPct: z.number().min(1).max(99).nullable(),
  trailingStopPct: z.number().min(1).max(99).nullable(),
  maxOpenPositions: z.number().int().min(1).max(20),
  dailyBuyLimitUsd: z.number().min(0).nullable(),
  allowList: z.array(mint).max(200),
  denyList: z.array(mint).max(500),
  language: z.enum(['en', 'ru']),
  // How the brain is run. The platform pays for it, so these spend the agent's daily AI budget faster or slower.
  /** Minutes between turns; null is the server default (5-15). Five is the floor: more often only re-reads cached prices. */
  thinkEveryMinutes: z.number().min(5).max(240).nullable(),
  skipIdleTurns: z.boolean(),
  /** A move below this on every token offered or held lets a turn after a hold skip the model. */
  idleMovePct: z.number().min(0.5).max(20),
  /** Thinking depth for brains that take it; null is the model's own default. */
  effort: z.enum(['low', 'medium', 'high']).nullable(),
  /**
   * Live slimes: how much of the wallet the slime trades with; trades are sized as if it held at most this. Null is
   * the platform default; the platform ceiling (LIVE_CAPITAL_CAP_USD) bounds it whatever the owner sets.
   */
  tradingCapitalUsd: z.number().min(10).max(1_000_000).nullable(),
});

/** What a live slime trades with: the owner's choice (or the platform default), never above the platform ceiling. */
export function tradingCapital(settings: Pick<Settings, 'tradingCapitalUsd'>, defaultUsd: number, ceilingUsd: number): number {
  return Math.min(settings.tradingCapitalUsd ?? defaultUsd, ceilingUsd);
}

export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Reads settings from the database. Rows written before a field existed get it
 * as off; migration 013 already filled the age floor from each risk profile.
 * Not a default on SettingsSchema itself: `.partial()` would then put the
 * default into every owner patch and switch the filter off on each save.
 */
export function parseStoredSettings(raw: unknown): Settings {
  return SettingsSchema.parse({ minAgeHours: null, minVolumeH1Usd: null, ...BRAIN_DEFAULTS, ...(raw as object) });
}

/** How the brain runs unless the owner says otherwise; also what rows from before these settings read as. */
const BRAIN_DEFAULTS = { thinkEveryMinutes: null, skipIdleTurns: true, idleMovePct: 3, effort: null, tradingCapitalUsd: null } as const;

export function defaultSettings(risk: RiskProfile = 'balanced'): Settings {
  return {
    risk,
    ...RISK_PROFILES[risk],
    minMarketCapUsd: null,
    maxMarketCapUsd: null,
    minVolumeH1Usd: null,
    takeProfitPct: null,
    stopLossPct: 25,
    trailingStopPct: 20,
    maxOpenPositions: 5,
    dailyBuyLimitUsd: null,
    allowList: [],
    denyList: [],
    language: 'en',
    ...BRAIN_DEFAULTS,
  };
}

/** Owner edits merge over what is stored; switching the risk profile resets the values it owns. */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  const base = patch.risk && patch.risk !== current.risk ? { ...current, ...RISK_PROFILES[patch.risk] } : current;
  return SettingsSchema.parse({ ...base, ...patch });
}
