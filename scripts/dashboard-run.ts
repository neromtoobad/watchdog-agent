import { Watchdog, WatchdogConfig } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { clear } from '../src/intelligence/fleet';

const cfg: WatchdogConfig = {
  agentId: 'dash-demo',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'log',
  fleet: { register: true },
};

(async () => {
  clear();
  const w = new Watchdog(cfg);

  // prime with a small live sequence
  for (let i = 0; i < 4; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 200, direction: 'long' });
  w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -120 });
  w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -90 });
  w.reportSignal({ signal: 'bearish', action: 'open-long' });

  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(w, port);

  // keep generating activity every 3s so the dashboard is lively
  let i = 0;
  setInterval(async () => {
    i++;
    if (i % 3 === 0) {
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -80 });
    } else {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 300, direction: 'long' });
    }
  }, 3000);
})();
