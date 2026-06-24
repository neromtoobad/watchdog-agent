import { execFile } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execFile);
const BGC_TIMEOUT_MS = 8_000;

export interface MarketContext {
  symbol: string;
  fundingRate: number | null;
  recentVolatility: number | null; // 24h (high-low)/last * 100, %
  lastPrice: number | null;
  change24h: number | null; // fractional, e.g. -0.0537
  source: 'bgc' | 'bitget-rest';
  timestamp: number;
  ok: boolean;
  errors?: string[];
}

interface BgcResponse<T> {
  endpoint?: string;
  requestTime?: string;
  data?: T;
}

async function runBgc(args: string[]): Promise<unknown> {
  const fullArgs = ['--read-only', ...args];
  const { stdout } = await exec('bgc', fullArgs, { timeout: BGC_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function getMarketContextBgc(symbol: string): Promise<MarketContext> {
  const errors: string[] = [];
  let lastPrice: number | null = null;
  let recentVolatility: number | null = null;
  let change24h: number | null = null;
  let fundingRate: number | null = null;

  try {
    const tickerRes = (await runBgc(['spot', 'spot_get_ticker', '--symbol', symbol])) as BgcResponse<unknown[]>;
    const row = Array.isArray(tickerRes.data) ? (tickerRes.data[0] as Record<string, unknown> | undefined) : undefined;
    if (row) {
      const last = num(row['lastPr']);
      const high = num(row['high24h']);
      const low = num(row['low24h']);
      change24h = num(row['change24h']);
      lastPrice = last;
      if (last && last > 0 && high !== null && low !== null) {
        recentVolatility = Number((((high - low) / last) * 100).toFixed(4));
      }
    } else {
      errors.push('ticker: empty data');
    }
  } catch (e) {
    errors.push(`ticker: ${(e as Error).message}`);
  }

  try {
    const fundRes = (await runBgc([
      'futures',
      'futures_get_funding_rate',
      '--productType',
      'USDT-FUTURES',
      '--symbol',
      symbol,
    ])) as BgcResponse<{ currentFundRate?: Array<Record<string, unknown>> }>;
    const list = fundRes.data?.currentFundRate ?? [];
    if (list.length > 0) {
      fundingRate = num(list[0]['fundingRate']);
    } else {
      errors.push('funding: empty currentFundRate');
    }
  } catch (e) {
    errors.push(`funding: ${(e as Error).message}`);
  }

  const ok = errors.length === 0 && fundingRate !== null && lastPrice !== null;
  return {
    symbol,
    fundingRate,
    recentVolatility,
    lastPrice,
    change24h,
    source: 'bgc',
    timestamp: Date.now(),
    ok,
    ...(errors.length ? { errors } : {}),
  };
}

const REST_BASE = 'https://api.bitget.com';
const REST_TIMEOUT_MS = 6_000;

async function fetchJson(url: string): Promise<any> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** Bitget public REST fallback — same read-only public data as bgc, but reachable
 *  from environments where the bgc CLI isn't installed (e.g. serverless / Vercel). */
async function getMarketContextHttp(symbol: string): Promise<MarketContext> {
  const errors: string[] = [];
  let lastPrice: number | null = null;
  let recentVolatility: number | null = null;
  let change24h: number | null = null;
  let fundingRate: number | null = null;

  try {
    const res = await fetchJson(`${REST_BASE}/api/v2/spot/market/tickers?symbol=${symbol}`);
    const row = Array.isArray(res?.data) ? (res.data[0] as Record<string, unknown> | undefined) : undefined;
    if (row) {
      const last = num(row['lastPr']);
      const high = num(row['high24h']);
      const low = num(row['low24h']);
      change24h = num(row['change24h']);
      lastPrice = last;
      if (last && last > 0 && high !== null && low !== null) {
        recentVolatility = Number((((high - low) / last) * 100).toFixed(4));
      }
    } else {
      errors.push('ticker: empty data');
    }
  } catch (e) {
    errors.push(`ticker: ${(e as Error).message}`);
  }

  try {
    const res = await fetchJson(`${REST_BASE}/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=USDT-FUTURES`);
    const row = Array.isArray(res?.data) ? (res.data[0] as Record<string, unknown> | undefined) : undefined;
    if (row) {
      fundingRate = num(row['fundingRate']);
    } else {
      errors.push('funding: empty data');
    }
  } catch (e) {
    errors.push(`funding: ${(e as Error).message}`);
  }

  const ok = lastPrice !== null && fundingRate !== null;
  return {
    symbol,
    fundingRate,
    recentVolatility,
    lastPrice,
    change24h,
    source: 'bitget-rest',
    timestamp: Date.now(),
    ok,
    ...(errors.length ? { errors } : {}),
  };
}

/**
 * Live read-only Bitget market context. Tries the bgc CLI first (the
 * --read-only safety primitive); if bgc is unavailable or returns incomplete
 * data, falls back to Bitget's public REST API directly. Either way the data is
 * public and read-only — WATCHDOG can never place an order.
 */
export async function getMarketContext(symbol: string): Promise<MarketContext> {
  const viaBgc = await getMarketContextBgc(symbol);
  if (viaBgc.ok) return viaBgc;

  const viaRest = await getMarketContextHttp(symbol);
  if (viaRest.ok) return viaRest;

  // neither path succeeded — surface both sets of errors for debugging
  return {
    ...viaBgc,
    errors: [
      ...(viaBgc.errors ?? []).map((e) => `bgc ${e}`),
      ...(viaRest.errors ?? []).map((e) => `rest ${e}`),
    ],
  };
}

if (require.main === module) {
  (async () => {
    const symbol = process.argv[2] ?? 'BTCUSDT';
    console.log(`fetching market context for ${symbol} (bgc --read-only)...`);
    const ctx = await getMarketContext(symbol);
    console.log(JSON.stringify(ctx, null, 2));
    if (!ctx.ok) {
      console.error('context fetch incomplete (degraded mode would still proceed)');
      process.exit(0);
    }
  })();
}
