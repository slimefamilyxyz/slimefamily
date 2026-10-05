import { CHAINS, normalizeAddress, type ChainId } from '../chains.js';

/** One tradable token as the brain sees it. Everything here comes from third parties: data, never instructions. */
export interface Candidate {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number | null;
  volumeUsd: { m5: number; h1: number; h24: number };
  changePct: { m5: number; h1: number; h24: number };
  txnsH1: { buys: number; sells: number };
  ageHours: number | null;
  imageUrl: string | null;
}

/** Tokens never offered as candidates: each chain's cash, gas coin and the other big dollars. */
const SKIP: Record<ChainId, Set<string>> = Object.fromEntries(
  (Object.keys(CHAINS) as ChainId[]).map((c) => [
    c,
    new Set([
      CHAINS[c].stable.mint,
      CHAINS[c].native.wrapped,
      ...({
        solana: ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'], // USDT
        base: ['0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'], // USDT
        bsc: ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', '0xe9e7cea3dedca5984780bafc599bd69add087d56'], // USDC, BUSD
        robinhood: ['0x80e0e24718dbfcad49ecaa6f1e6c89a190586ca8'], // bridged USDC
        ethereum: ['0xdac17f958d2ee523a2206206994597c13d831ec7'], // USDT
      } as Record<ChainId, string[]>)[c],
    ].map((a) => normalizeAddress(c, a))),
  ]),
) as Record<ChainId, Set<string>>;

interface DexPair {
  chainId: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { m5?: number; h1?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  txns?: { h1?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** Token addresses on `chain` that are getting attention right now, from five free feeds. A feed that fails is skipped. */
export async function discoverMints(chain: ChainId = 'solana'): Promise<string[]> {
  const spec = CHAINS[chain];
  const ours = (rows: Array<{ chainId: string; tokenAddress: string }>) => rows.filter((r) => r.chainId === spec.dexscreener).map((r) => r.tokenAddress);
  const feeds: Array<Promise<string[]>> = [
    getJson('https://api.dexscreener.com/token-boosts/top/v1').then((rows) => ours(rows as Array<{ chainId: string; tokenAddress: string }>)),
    getJson('https://api.dexscreener.com/token-profiles/latest/v1').then((rows) => ours(rows as Array<{ chainId: string; tokenAddress: string }>)),
    // Top pools by volume too: on chains with few boosted or profiled tokens the first two feeds are thin.
    ...['trending_pools', 'new_pools', 'pools'].map((feed) =>
      getJson(`https://api.geckoterminal.com/api/v2/networks/${spec.geckoterminal}/${feed}?page=1`).then((body) =>
        (body as { data: Array<{ relationships: { base_token: { data: { id: string } } } }> }).data.map((p) =>
          p.relationships.base_token.data.id.replace(new RegExp(`^${spec.geckoterminal}_`), ''),
        ),
      ),
    ),
  ];
  const settled = await Promise.allSettled(feeds);
  const mints = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])).map((m) => normalizeAddress(chain, m));
  return [...new Set(mints)].filter((m) => !SKIP[chain].has(m));
}

export function pairToCandidate(pair: DexPair, now: number, chain: ChainId = 'solana'): Candidate | null {
  const priceUsd = Number(pair.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return {
    mint: normalizeAddress(chain, pair.baseToken.address),
    symbol: pair.baseToken.symbol.slice(0, 20),
    name: pair.baseToken.name.slice(0, 40),
    priceUsd,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
    volumeUsd: { m5: pair.volume?.m5 ?? 0, h1: pair.volume?.h1 ?? 0, h24: pair.volume?.h24 ?? 0 },
    changePct: { m5: pair.priceChange?.m5 ?? 0, h1: pair.priceChange?.h1 ?? 0, h24: pair.priceChange?.h24 ?? 0 },
    txnsH1: { buys: pair.txns?.h1?.buys ?? 0, sells: pair.txns?.h1?.sells ?? 0 },
    ageHours: pair.pairCreatedAt ? Math.max(0, (now - pair.pairCreatedAt) / 3_600_000) : null,
    imageUrl: pair.info?.imageUrl ?? null,
  };
}

/** Market data for the given tokens on `chain`: the deepest pair of each. */
export async function describeMints(mints: string[], now = Date.now(), chain: ChainId = 'solana'): Promise<Map<string, Candidate>> {
  const spec = CHAINS[chain];
  const best = new Map<string, DexPair>();
  const unique = [...new Set(mints.map((m) => normalizeAddress(chain, m)))];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    let pairs: DexPair[];
    try {
      pairs = (await getJson(`https://api.dexscreener.com/tokens/v1/${spec.dexscreener}/${chunk.join(',')}`)) as DexPair[];
    } catch {
      continue;
    }
    for (const pair of pairs) {
      if (pair.chainId !== spec.dexscreener) continue;
      const mint = normalizeAddress(chain, pair.baseToken.address);
      if (!chunk.includes(mint)) continue;
      const current = best.get(mint);
      if (!current || (pair.liquidity?.usd ?? 0) > (current.liquidity?.usd ?? 0)) best.set(mint, pair);
    }
  }
  const out = new Map<string, Candidate>();
  for (const [mint, pair] of best) {
    const c = pairToCandidate(pair, now, chain);
    if (c) out.set(mint, c);
  }
  return out;
}
