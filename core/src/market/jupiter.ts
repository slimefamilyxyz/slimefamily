import type { Stable } from '../chains.js';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_DECIMALS = 6;

export const SOLANA_USDC: Stable = { mint: USDC_MINT, symbol: 'USDC', decimals: USDC_DECIMALS };
export const stableOf = (venue: Pick<Jupiter, 'stable'>): Stable => venue.stable ?? SOLANA_USDC;

/** Dollars to the stable's base units, exact to the cent-millionth whatever its decimals (BNB USDT has 18). */
export function usdToStableRaw(usd: number, stable: Stable): bigint {
  const micro = BigInt(Math.floor(usd * 1e6));
  return stable.decimals >= 6 ? micro * 10n ** BigInt(stable.decimals - 6) : micro / 10n ** BigInt(6 - stable.decimals);
}

export function stableRawToUsd(raw: bigint, stable: Stable): number {
  return Number(raw) / 10 ** stable.decimals;
}

export interface Quote {
  inAmount: bigint;
  outAmount: bigint;
  priceImpactPct: number;
  /** The raw quote, passed on unchanged when a live swap is built from it. */
  raw: unknown;
}

export interface TokenPrice {
  usdPrice: number;
  decimals: number;
}

export interface SwapTx {
  tx: Uint8Array;
  lastValidBlockHeight: number;
}

/**
 * A source of quotes, prices and swaps on one chain: Jupiter on Solana,
 * KyberSwap on EVM chains. `stable` is the chain's dollar, the side every
 * agent trade shares; absent means Solana USDC.
 */
export interface Jupiter {
  stable?: Stable;
  /** `platformFeeBps` asks Jupiter to reserve the platform's cut; the swap then needs a fee account. */
  quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number, platformFeeBps?: number): Promise<Quote>;
  prices(mints: string[]): Promise<Map<string, TokenPrice>>;
  /** An unsigned transaction that performs the quoted swap from `wallet`; `feeAccount` receives the platform fee. */
  swapTransaction(quote: Quote, wallet: string, feeAccount?: string): Promise<SwapTx>;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Jupiter ${res.status} for ${new URL(url).pathname}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const PRICE_TTL_MS = 20_000;

/**
 * `apiKey` switches to api.jup.ag, the supported endpoint; lite-api.jup.ag is
 * deprecated and rate-limited harder over time. Prices are cached briefly so
 * page views and agents do not spend the request quota asking the same thing.
 */
export function createJupiter(base: string, apiKey = ''): Jupiter {
  const headers: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {};
  const priceCache = new Map<string, { at: number; price: TokenPrice | null }>();
  return {
    async quote(inputMint, outputMint, amount, slippageBps, platformFeeBps) {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: String(slippageBps),
        ...(platformFeeBps ? { platformFeeBps: String(platformFeeBps) } : {}),
      });
      const q = (await getJson(`${base}/swap/v1/quote?${params}`, headers)) as {
        inAmount: string;
        outAmount: string;
        priceImpactPct: string;
      };
      return {
        inAmount: BigInt(q.inAmount),
        outAmount: BigInt(q.outAmount),
        // Jupiter reports impact as a fraction ("0.0123" = 1.23%).
        priceImpactPct: Math.abs(Number(q.priceImpactPct)) * 100,
        raw: q,
      };
    },

    async swapTransaction(quote, wallet, feeAccount) {
      const res = await fetch(`${base}/swap/v1/swap`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          quoteResponse: quote.raw,
          userPublicKey: wallet,
          ...(feeAccount ? { feeAccount } : {}),
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 200_000, priorityLevel: 'high' } },
        }),
      });
      if (!res.ok) throw new Error(`Jupiter swap ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { swapTransaction?: string; lastValidBlockHeight?: number; simulationError?: unknown };
      if (body.simulationError) throw new Error(`Jupiter simulation failed: ${JSON.stringify(body.simulationError).slice(0, 200)}`);
      if (!body.swapTransaction || !body.lastValidBlockHeight) throw new Error('Jupiter returned no transaction');
      return { tx: new Uint8Array(Buffer.from(body.swapTransaction, 'base64')), lastValidBlockHeight: body.lastValidBlockHeight };
    },

    async prices(mints) {
      const out = new Map<string, TokenPrice>();
      const now = Date.now();
      const missing: string[] = [];
      for (const mint of new Set(mints)) {
        const hit = priceCache.get(mint);
        if (hit && now - hit.at < PRICE_TTL_MS) {
          if (hit.price) out.set(mint, hit.price);
        } else missing.push(mint);
      }
      // The price endpoint takes up to 50 ids per call.
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        const data = (await getJson(`${base}/price/v3?ids=${chunk.join(',')}`, headers)) as Record<string, { usdPrice?: number; decimals?: number } | null>;
        for (const mint of chunk) {
          const p = data[mint];
          const price = p && typeof p.usdPrice === 'number' && typeof p.decimals === 'number' ? { usdPrice: p.usdPrice, decimals: p.decimals } : null;
          priceCache.set(mint, { at: now, price });
          if (price) out.set(mint, price);
        }
      }
      return out;
    },
  };
}

export function usdToUsdcRaw(usd: number): bigint {
  return BigInt(Math.floor(usd * 10 ** USDC_DECIMALS));
}

export function usdcRawToUsd(raw: bigint): number {
  return Number(raw) / 10 ** USDC_DECIMALS;
}
