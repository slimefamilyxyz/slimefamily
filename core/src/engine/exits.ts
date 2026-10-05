import { entryPriceUsd, type Position } from './ledger.js';
import type { Settings } from './settings.js';

export type ExitReason = 'take_profit' | 'stop_loss' | 'trailing_stop';

export interface ExitSignal {
  reason: ExitReason;
  text: string;
}

/**
 * Owner-set exits run before the brain is asked anything, so a stop fires
 * even when the model is slow, wrong or unavailable.
 */
export function checkExit(pos: Position, priceUsd: number, s: Pick<Settings, 'takeProfitPct' | 'stopLossPct' | 'trailingStopPct'>): ExitSignal | null {
  const entry = entryPriceUsd(pos);
  if (entry <= 0 || priceUsd <= 0) return null;
  const changePct = (priceUsd / entry - 1) * 100;

  if (s.stopLossPct !== null && changePct <= -s.stopLossPct) {
    return { reason: 'stop_loss', text: `stop loss: ${changePct.toFixed(1)}% from entry` };
  }
  if (s.takeProfitPct !== null && changePct >= s.takeProfitPct) {
    return { reason: 'take_profit', text: `take profit: +${changePct.toFixed(1)}% from entry` };
  }
  const peak = Math.max(pos.peakPriceUsd ?? 0, priceUsd);
  // A trailing stop only arms once the position has been in profit.
  if (s.trailingStopPct !== null && peak > entry) {
    const offPeakPct = (1 - priceUsd / peak) * 100;
    if (offPeakPct >= s.trailingStopPct) {
      return { reason: 'trailing_stop', text: `trailing stop: ${offPeakPct.toFixed(1)}% off the peak` };
    }
  }
  return null;
}
