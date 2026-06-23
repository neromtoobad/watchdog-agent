import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { clear } from '../src/intelligence/fleet';

const rules: WatchdogRules = {
  maxTradesPerHour: 5,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 3,
  maxSignalOverridesPerHour: 3,
};

function mk(agentId: string): Watchdog {
  const cfg: WatchdogConfig = {
    agentId,
    portfolioUsdt: 10_000,
    rules,
    onViolation: 'log',
    fleet: { register: true },
  };
  return new Watchdog(cfg);
}

(async () => {
  clear();

  // A — clean
  const a = mk('alpha-clean');
  await a.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  await a.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  a.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 30 });

  // B — overtrader
  const b = mk('beta-overtrader');
  for (let i = 0; i < 8; i++) await b.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });

  // C — chaos
  const c = mk('gamma-chaos');
  for (let i = 0; i < 15; i++) await c.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 4_000, direction: 'long' });
  for (let i = 0; i < 6; i++) c.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -400 });

  // D — mild incident
  const d = mk('delta-mild');
  for (let i = 0; i < 4; i++) await d.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  d.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -50 });
  d.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -50 });

  // pick any agent as the primary for /api/status — leaderboard endpoint reads the fleet registry, so all 4 will appear
  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(a, port);
})();
