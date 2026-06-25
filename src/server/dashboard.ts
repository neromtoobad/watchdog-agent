import express, { Request, Response } from 'express';
import * as http from 'http';
import * as path from 'path';
import { Watchdog, WatchdogEvent, WatchdogRules } from '../index';
import { getMarketContext, MarketContext } from '../market/context';

/** Cached live Bitget market context (via bgc --read-only). bgc shells out and
 *  is slow, so we refresh on an interval and serve the cache to /api/market. */
let marketCache: MarketContext | null = null;
let marketFetching = false;
const MARKET_TTL_MS = 20_000;
async function refreshMarket(symbol = 'BTCUSDT'): Promise<MarketContext> {
  if (marketFetching && marketCache) return marketCache;
  if (marketCache && Date.now() - marketCache.timestamp < MARKET_TTL_MS) return marketCache;
  marketFetching = true;
  try {
    marketCache = await getMarketContext(symbol);
  } catch (e) {
    marketCache = { symbol, fundingRate: null, recentVolatility: null, lastPrice: null, change24h: null, source: 'bgc', timestamp: Date.now(), ok: false, errors: [(e as Error).message] };
  } finally {
    marketFetching = false;
  }
  return marketCache;
}

/** Reconstruct closed trades FIFO-per-symbol from the event stream. */
export interface LedgerTrade {
  openedAt: number;
  closedAt: number;
  symbol: string;
  direction: 'long' | 'short';
  sizeUsdt: number;
  pnlUsdt: number;
  equityAfter: number;
  result: 'win' | 'loss' | 'flat';
}
export interface LedgerSummary {
  startEquity: number;
  finalEquity: number;
  totalPnl: number;
  totalReturnPct: number;
  totalTrades: number;
  openPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null; // null when no losses (effectively infinite)
}
export interface LedgerResponse {
  agentId: string;
  trades: LedgerTrade[];
  summary: LedgerSummary;
}

export function buildLedger(watchdog: Watchdog, startEquity = 10_000): LedgerResponse {
  const events = watchdog.getEvents().slice().sort((a: WatchdogEvent, b: WatchdogEvent) => a.timestamp - b.timestamp);
  const opens: Record<string, WatchdogEvent[]> = {};
  const trades: LedgerTrade[] = [];
  let equity = startEquity;

  for (const ev of events) {
    if (ev.type === 'trade-open') {
      const sym = String(ev.payload.symbol ?? '?');
      (opens[sym] ??= []).push(ev);
    } else if (ev.type === 'trade-close') {
      const sym = String(ev.payload.symbol ?? '?');
      const open = opens[sym]?.shift();
      if (!open) continue;
      const pnl = Number(ev.payload.pnlUsdt ?? 0);
      equity += pnl;
      trades.push({
        openedAt: open.timestamp,
        closedAt: ev.timestamp,
        symbol: sym,
        direction: (open.payload.direction === 'short' ? 'short' : 'long'),
        sizeUsdt: Number(open.payload.sizeUsdt ?? 0),
        pnlUsdt: pnl,
        equityAfter: equity,
        result: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat',
      });
    }
  }

  const wins = trades.filter((t) => t.pnlUsdt > 0);
  const losses = trades.filter((t) => t.pnlUsdt < 0);
  const totalWin = wins.reduce((a, t) => a + t.pnlUsdt, 0);
  const totalLoss = -losses.reduce((a, t) => a + t.pnlUsdt, 0);
  const totalPnl = totalWin - totalLoss;
  const openPositions = Object.values(opens).reduce((a, q) => a + q.length, 0);

  return {
    agentId: watchdog.getStatus().agentId,
    trades,
    summary: {
      startEquity,
      finalEquity: equity,
      totalPnl,
      totalReturnPct: startEquity > 0 ? (totalPnl / startEquity) * 100 : 0,
      totalTrades: trades.length,
      openPositions,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? wins.length / trades.length : 0,
      avgWin: wins.length ? totalWin / wins.length : 0,
      avgLoss: losses.length ? totalLoss / losses.length : 0,
      profitFactor: totalLoss > 0 ? totalWin / totalLoss : null,
    },
  };
}

export interface DashboardServer {
  app: express.Express;
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

/**
 * Build the Express app with all routes wired, WITHOUT calling listen().
 * Used directly by serverless hosts (Vercel) and wrapped by
 * createDashboardServer() for local/standalone use.
 */
export function createDashboardApp(watchdog: Watchdog): express.Express {
  const startedAt = Date.now();
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, uptime: Date.now() - startedAt });
  });

  app.get('/api/status', (_req: Request, res: Response) => {
    const status = watchdog.getStatus();
    res.json({
      agentId: status.agentId,
      paused: status.paused,
      status,
      trustScore: status.trustScore,
      forecasts: watchdog.getForecast(),
      lastDiagnosis: watchdog.getLastDiagnosis(),
    });
  });

  app.get('/api/events', (_req: Request, res: Response) => {
    res.json(watchdog.getEvents());
  });

  app.get('/api/ledger', (_req: Request, res: Response) => {
    res.json(buildLedger(watchdog));
  });

  app.get('/api/market', async (_req: Request, res: Response) => {
    res.json(await refreshMarket());
  });
  void refreshMarket(); // warm the cache on boot so the first poll is instant

  app.use(express.json());

  // LAYER 6 — the AI behavioral supervisor
  app.get('/api/supervisor', async (_req: Request, res: Response) => {
    try { res.json(await Watchdog.reviewFleet()); }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.post('/api/supervisor/ask', async (req: Request, res: Response) => {
    const q = (req.body && typeof req.body.question === 'string') ? req.body.question : '';
    if (!q.trim()) return res.status(400).json({ error: 'question required' });
    try { res.json(await Watchdog.askSupervisor(q)); }
    catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // Stateless real evaluation — replays a recent window of an agent's actions
  // through the REAL WATCHDOG engine and returns its live state. Powers the
  // in-browser live demo on the deployed site (real prices in, real verdicts out).
  app.post('/api/evaluate', async (req: Request, res: Response) => {
    try {
      const b = (req.body || {}) as Record<string, unknown>;
      const agentId = typeof b.agentId === 'string' && b.agentId ? b.agentId : 'paper-agent';
      const portfolioUsdt = Number(b.portfolioUsdt) > 0 ? Number(b.portfolioUsdt) : 10_000;
      const rules = (b.rules && typeof b.rules === 'object' ? b.rules : {
        maxTradesPerHour: 10, maxPositionSizePercent: 25, maxDrawdownPercent: 15,
        maxConsecutiveLosses: 4, maxSignalOverridesPerHour: 3,
      }) as WatchdogRules;
      const actions = Array.isArray(b.actions) ? (b.actions as Array<Record<string, unknown>>).slice(-60) : [];

      const w = new Watchdog({ agentId, portfolioUsdt, rules, onViolation: 'pause', ai: { enabled: true }, fleet: { register: false } });
      for (const a of actions) {
        const sym = String(a.symbol ?? 'BTCUSDT');
        const dir = a.direction === 'short' ? 'short' : 'long';
        if (a.kind === 'open') await w.checkTrade({ type: 'open', symbol: sym, sizeUsdt: Number(a.sizeUsdt) || 0, direction: dir });
        else if (a.kind === 'close') { await w.checkTrade({ type: 'close', symbol: sym, sizeUsdt: Number(a.sizeUsdt) || 0, direction: dir }); w.reportTradeClosed({ symbol: sym, pnlUsdt: Number(a.pnlUsdt) || 0 }); }
        else if (a.kind === 'signal') w.reportSignal({ signal: (a.signal as 'bullish' | 'bearish' | 'neutral') || 'neutral', action: String(a.action ?? '') });
      }
      await w.flushDiagnosis();
      const status = w.getStatus();
      res.json({ agentId, paused: status.paused, status, trustScore: status.trustScore, forecasts: w.getForecast(), lastDiagnosis: w.getLastDiagnosis() });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });

  app.get('/api/leaderboard', (_req: Request, res: Response) => {
    res.json(Watchdog.getLeaderboard());
  });

  app.get('/api/audit', (_req: Request, res: Response) => {
    const verification = watchdog.verifyAuditChain();
    res.json({
      verified: verification.valid,
      brokenAt: verification.brokenAt,
      trail: watchdog.getAuditTrail(),
    });
  });

  app.get('/badge/:agentId', (req: Request, res: Response) => {
    const svg = Watchdog.renderBadge(req.params.agentId);
    res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    res.send(svg);
  });

  // clean route for the dashboard: /app → app.html (/, the landing page, is static)
  const publicDir = path.resolve(__dirname, '..', '..', 'public');
  app.get('/app', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'app.html'));
  });

  // serve landing page + dashboard html + assets
  app.use(express.static(publicDir));

  return app;
}

export function createDashboardServer(watchdog: Watchdog, port: number): Promise<DashboardServer> {
  const app = createDashboardApp(watchdog);

  return new Promise<DashboardServer>((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      console.log(`[WATCHDOG dashboard] ${url}`);
      console.log(`  → ${url}/                       (dashboard html)`);
      console.log(`  → ${url}/leaderboard.html          (fleet leaderboard)`);
      console.log(`  → ${url}/ledger.html               (trade ledger)`);
      console.log(`  → ${url}/api/status`);
      console.log(`  → ${url}/api/events`);
      console.log(`  → ${url}/api/ledger                (reconstructed trade ledger)`);
      console.log(`  → ${url}/api/market                (live Bitget market via bgc --read-only)`);
      console.log(`  → ${url}/api/leaderboard`);
      console.log(`  → ${url}/api/audit`);
      console.log(`  → ${url}/api/health`);
      console.log(`  → ${url}/badge/<agentId>           (SVG)`);
      resolve({
        app,
        server,
        url,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
    server.on('error', reject);
  });
}
