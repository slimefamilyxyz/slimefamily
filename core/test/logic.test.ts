import { describe, expect, it } from 'vitest';
import { checkExit } from '../src/engine/exits.js';
import { applyBuy, applySell, entryPriceUsd, portion, ratio, type Position } from '../src/engine/ledger.js';
import { sizeBuy, tokenBlockReason } from '../src/engine/limits.js';
import { assertSellable, paperExecutor } from '../src/engine/executor.js';
import { USDC_MINT } from '../src/market/jupiter.js';
import { defaultSettings, mergeSettings, parseStoredSettings, SettingsSchema } from '../src/engine/settings.js';
import { moodOf, stageOf } from '../src/mood.js';
import { createWallet, decryptSecret, encryptSecret, exportSecretBase58, hashOwnerKey, newOwnerKey } from '../src/wallet.js';
import { candidate, fakeJupiter, MASTER, MINT_A } from './helpers.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

const pos = (over: Partial<Position> = {}): Position => ({
  mint: MINT_A,
  symbol: 'AAA',
  decimals: 6,
  amountRaw: 1_000_000_000n, // 1000 tokens
  costUsd: 10, // entry $0.01
  peakPriceUsd: 0.01,
  ...over,
});

describe('ledger', () => {
  it('averages cost across buys', () => {
    const a = applyBuy(null, { mint: MINT_A, symbol: 'AAA', decimals: 6, amountRaw: 1_000_000_000n, usd: 10, priceUsd: 0.01 });
    const b = applyBuy(a, { mint: MINT_A, symbol: 'AAA', decimals: 6, amountRaw: 500_000_000n, usd: 10, priceUsd: 0.02 });
    expect(b.amountRaw).toBe(1_500_000_000n);
    expect(b.costUsd).toBe(20);
    expect(entryPriceUsd(b)).toBeCloseTo(0.013333, 5);
    expect(b.peakPriceUsd).toBe(0.02);
  });

  it('realizes profit on the share sold and keeps the rest of the basis', () => {
    const { position, realizedUsd } = applySell(pos(), 250_000_000n, 5); // sold a quarter for $5, basis $2.5
    expect(realizedUsd).toBeCloseTo(2.5);
    expect(position?.amountRaw).toBe(750_000_000n);
    expect(position?.costUsd).toBeCloseTo(7.5);
  });

  it('closes the position on a full sell', () => {
    const { position, realizedUsd } = applySell(pos(), 1_000_000_000n, 4);
    expect(position).toBeNull();
    expect(realizedUsd).toBeCloseTo(-6);
  });

  it('refuses to sell more than is held', () => {
    expect(() => applySell(pos(), 2_000_000_000n, 1)).toThrow(/exceeds/);
  });

  it('keeps precision on huge raw amounts', () => {
    expect(ratio(10n ** 30n, 4n * 10n ** 30n)).toBe(0.25);
    expect(portion(10n ** 30n, 50)).toBe(5n * 10n ** 29n);
    expect(portion(3n, 1)).toBe(3n); // never rounds a sell down to nothing
  });
});

describe('exits', () => {
  const s = { takeProfitPct: 100, stopLossPct: 25, trailingStopPct: 20 };
  it('fires the stop loss', () => {
    expect(checkExit(pos(), 0.0074, s)?.reason).toBe('stop_loss');
  });
  it('fires take profit', () => {
    expect(checkExit(pos(), 0.021, s)?.reason).toBe('take_profit');
  });
  it('arms the trailing stop only after a profit', () => {
    expect(checkExit(pos({ peakPriceUsd: 0.01 }), 0.0079, { ...s, stopLossPct: null })).toBeNull();
    expect(checkExit(pos({ peakPriceUsd: 0.015 }), 0.0119, s)?.reason).toBe('trailing_stop');
    expect(checkExit(pos({ peakPriceUsd: 0.015 }), 0.0125, s)).toBeNull();
  });
  it('does nothing without a price', () => {
    expect(checkExit(pos(), 0, s)).toBeNull();
  });
});

describe('limits', () => {
  const s = defaultSettings('balanced'); // 15% position, $25k liquidity, 5 positions
  const ctx = { usd: 50, cashUsd: 100, equityUsd: 100, openPositions: 0, heldValueUsd: 0, boughtTodayUsd: 0 };

  it('caps a buy at the position share of equity', () => {
    expect(sizeBuy(ctx, s)).toEqual({ usd: 15 });
  });
  it('counts what is already held toward the cap', () => {
    expect(sizeBuy({ ...ctx, heldValueUsd: 10 }, s)).toEqual({ usd: 5 });
    expect(sizeBuy({ ...ctx, heldValueUsd: 15 }, s)).toHaveProperty('rejected');
  });
  it('never spends more cash than there is', () => {
    expect(sizeBuy({ ...ctx, cashUsd: 3 }, s)).toEqual({ usd: 3 });
  });
  it('stops at the open position limit, but allows adding to a holding', () => {
    expect(sizeBuy({ ...ctx, openPositions: 5 }, s)).toHaveProperty('rejected');
    expect(sizeBuy({ ...ctx, openPositions: 5, heldValueUsd: 5 }, s)).toEqual({ usd: 10 });
  });
  it('respects the daily buy limit', () => {
    const daily = { ...s, dailyBuyLimitUsd: 20 };
    expect(sizeBuy({ ...ctx, boughtTodayUsd: 12 }, daily)).toEqual({ usd: 8 });
    expect(sizeBuy({ ...ctx, boughtTodayUsd: 20 }, daily)).toHaveProperty('rejected');
  });
  it('filters tokens by liquidity, lists and market cap', () => {
    expect(tokenBlockReason(candidate(MINT_A, { liquidityUsd: 5000 }), s)).toMatch(/liquidity/);
    expect(tokenBlockReason(candidate(MINT_A), { ...s, denyList: [MINT_A] })).toMatch(/deny/);
    expect(tokenBlockReason(candidate(MINT_A), { ...s, maxMarketCapUsd: 500_000 })).toMatch(/market cap/);
    expect(tokenBlockReason(candidate(MINT_A), s)).toBeNull();
  });
  it('filters young, unknown-age and quiet tokens', () => {
    expect(tokenBlockReason(candidate(MINT_A, { ageHours: 3 }), s)).toMatch(/younger than 24h/);
    expect(tokenBlockReason(candidate(MINT_A, { ageHours: null }), s)).toMatch(/age unknown/);
    expect(tokenBlockReason(candidate(MINT_A, { ageHours: 3 }), { ...s, minAgeHours: null })).toBeNull();
    expect(tokenBlockReason(candidate(MINT_A), { ...s, minVolumeH1Usd: 50_000 })).toMatch(/1h volume/);
  });
  it('keeps the platform liquidity floor under any owner setting', () => {
    expect(tokenBlockReason(candidate(MINT_A, { liquidityUsd: 8000 }), { ...s, minLiquidityUsd: 0 })).toMatch(/below \$10000/);
  });
});

describe('settings', () => {
  it('switching risk profile resets the values it owns', () => {
    const next = mergeSettings(defaultSettings('careful'), { risk: 'degen' });
    expect(next.maxPriceImpactPct).toBe(4);
    expect(next.minLiquidityUsd).toBe(10_000);
  });
  it('rejects nonsense', () => {
    expect(() => mergeSettings(defaultSettings(), { stopLossPct: 150 })).toThrow();
    expect(() => mergeSettings(defaultSettings(), { denyList: ['not-a-mint'] })).toThrow();
  });
});

describe('mood and growth', () => {
  const base = { paused: false, equityUsd: 50, minEquityUsd: 5, thinking: false, lastTradeAt: null, pnl24hPct: 0, now: 1_000_000 };
  it('reads the ledger', () => {
    expect(moodOf({ ...base, equityUsd: 2 })).toBe('sleeping');
    expect(moodOf({ ...base, paused: true })).toBe('sleeping');
    expect(moodOf({ ...base, thinking: true })).toBe('thinking');
    expect(moodOf({ ...base, lastTradeAt: 1_000_000 - 60_000 })).toBe('bought');
    expect(moodOf({ ...base, pnl24hPct: 4 })).toBe('glowing');
    expect(moodOf({ ...base, pnl24hPct: -4 })).toBe('sweating');
    expect(moodOf(base)).toBe('calm');
  });
  it('grows with trades', () => {
    expect(stageOf(0, false)).toBe('egg');
    expect(stageOf(1, false)).toBe('baby');
    expect(stageOf(100, false)).toBe('adult');
    expect(stageOf(3, true)).toBe('adult');
  });
});

describe('wallet', () => {
  it('round-trips an encrypted secret and exports a key that signs for the address', () => {
    const w = createWallet(MASTER);
    const secret = bs58.decode(exportSecretBase58(w.secretEnc, w.address, MASTER));
    expect(secret.length).toBe(64);
    const sig = nacl.sign.detached(new Uint8Array([1, 2, 3]), secret);
    expect(nacl.sign.detached.verify(new Uint8Array([1, 2, 3]), sig, bs58.decode(w.address))).toBe(true);
  });
  it('will not decrypt under another address or key', () => {
    const w = createWallet(MASTER);
    expect(() => decryptSecret(w.secretEnc, 'x'.repeat(44), MASTER)).toThrow();
    expect(() => decryptSecret(w.secretEnc, w.address, 'cd'.repeat(32))).toThrow();
    expect(() => encryptSecret(new Uint8Array(64), w.address, 'short')).toThrow(/WALLET_MASTER_KEY/);
  });
  it('makes owner keys that only match their own hash', () => {
    const k = newOwnerKey();
    expect(k.startsWith('slime_owner_')).toBe(true);
    expect(hashOwnerKey(k)).not.toBe(hashOwnerKey(newOwnerKey()));
  });
});

describe('sell-back rail', () => {
  const agent = { id: 1, walletAddress: 'x' };
  it('buys a token that sells straight back', async () => {
    const fill = await paperExecutor(fakeJupiter({ [MINT_A]: 0.01 })).buy(agent, MINT_A, 100, 2);
    expect(fill.amountRaw).toBeGreaterThan(0n);
  });
  it('refuses a token with no route back', async () => {
    const jup = fakeJupiter({ [MINT_A]: 0.01 });
    const oneWay = { ...jup, quote: (i: string, o: string, a: bigint, sl: number) => (i === USDC_MINT ? jup.quote(i, o, a, sl) : Promise.reject(new Error('no route'))) };
    await expect(paperExecutor(oneWay).buy(agent, MINT_A, 100, 2)).rejects.toThrow(/no route to sell/);
  });
  it('refuses a round trip that loses more than a fifth', async () => {
    const jup = fakeJupiter({ [MINT_A]: 0.01 });
    const lossy = { ...jup, quote: async (i: string, o: string, a: bigint, sl: number) => {
      const q = await jup.quote(i, o, a, sl);
      return i === USDC_MINT ? q : { ...q, outAmount: q.outAmount / 2n };
    } };
    await expect(assertSellable(lossy, MINT_A, 10_000_000_000n, 100)).rejects.toThrow(/selling straight back/);
  });
});

describe('coin-age settings', () => {
  it('an owner patch keeps the age floor, a risk switch resets it, old rows read as off', () => {
    const cur = defaultSettings('careful');
    const patch = SettingsSchema.partial().parse({ stopLossPct: 30 });
    expect('minAgeHours' in patch).toBe(false);
    expect(mergeSettings(cur, patch).minAgeHours).toBe(72);
    expect(mergeSettings(cur, { risk: 'degen' }).minAgeHours).toBe(1);
    const { minAgeHours: _a, minVolumeH1Usd: _v, ...old } = cur;
    expect(parseStoredSettings(old).minAgeHours).toBeNull();
  });
});
