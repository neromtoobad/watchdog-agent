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
  source: 'bgc';
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

export async function getMarketContext(symbol: string): Promise<MarketContext> {
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
