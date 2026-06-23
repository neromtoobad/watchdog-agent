import express, { Request, Response } from 'express';
import * as http from 'http';
import * as path from 'path';
import { Watchdog, WatchdogEvent } from '../index';

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

export function createDashboardServer(watchdog: Watchdog, port: number): Promise<DashboardServer> {
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
