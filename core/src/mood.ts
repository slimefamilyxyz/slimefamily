export type Mood = 'thinking' | 'bought' | 'glowing' | 'sweating' | 'sleeping' | 'calm';
export type Stage = 'egg' | 'baby' | 'adult';

export interface MoodInput {
  paused: boolean;
  equityUsd: number;
  minEquityUsd: number;
  thinking: boolean;
  lastTradeAt: number | null;
  /** P&L change over the last 24 hours as a percent of net deposits. */
  pnl24hPct: number | null;
  now: number;
}

const FRESH_TRADE_MS = 3 * 60_000;
const MOOD_BAND_PCT = 1;

/** The creature's face. Order matters: a sleeping slime does not also sweat. */
export function moodOf(m: MoodInput): Mood {
  if (m.paused || m.equityUsd < m.minEquityUsd) return 'sleeping';
  if (m.thinking) return 'thinking';
  if (m.lastTradeAt !== null && m.now - m.lastTradeAt < FRESH_TRADE_MS) return 'bought';
  if (m.pnl24hPct !== null && m.pnl24hPct >= MOOD_BAND_PCT) return 'glowing';
  if (m.pnl24hPct !== null && m.pnl24hPct <= -MOOD_BAND_PCT) return 'sweating';
  return 'calm';
}

export const ADULT_TRADES = 100;

/** Growth is earned on the ledger: hatch on the first trade, grow up at 100 trades or on launching a token. */
export function stageOf(trades: number, hasToken: boolean): Stage {
  if (hasToken || trades >= ADULT_TRADES) return 'adult';
  return trades > 0 ? 'baby' : 'egg';
}
