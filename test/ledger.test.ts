import { describe, it, expect, beforeEach } from 'vitest';
import { buildLedger } from '../src/server/dashboard';
import { Watchdog, WatchdogConfig } from '../src/index';
import { clear } from '../src/intelligence/fleet';

function mkCfg(): WatchdogConfig {
  return {
    agentId: 'ledger-test',
    portfolioUsdt: 10_000,
    rules: {
      maxTradesPerHour: 100,
      maxPositionSizePercent: 100,
      maxDrawdownPercent: 100,
      maxConsecutiveLosses: 100,
      maxSignalOverridesPerHour: 100,
    },
    onViolation: 'log',
  };
}

beforeEach(() => clear());

describe('buildLedger', () => {
  it('empty watchdog → empty ledger', () => {
    const w = new Watchdog(mkCfg());
    const r = buildLedger(w);
    expect(r.trades).toEqual([]);
    expect(r.summary.totalTrades).toBe(0);
    expect(r.summary.openPositions).toBe(0);
    expect(r.summary.finalEquity).toBe(10_000);
    expect(r.summary.totalPnl).toBe(0);
    expect(r.summary.winRate).toBe(0);
    expect(r.summary.profitFactor).toBeNull();
  });

  it('one open with no close → 0 trades, 1 open position', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const r = buildLedger(w);
    expect(r.trades.length).toBe(0);
    expect(r.summary.openPositions).toBe(1);
    expect(r.summary.finalEquity).toBe(10_000);
  });

  it('one open + one close pairs FIFO → 1 closed trade with PnL applied to equity', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 25 });
    const r = buildLedger(w);
    expect(r.trades.length).toBe(1);
    expect(r.summary.openPositions).toBe(0);
    expect(r.trades[0]).toMatchObject({
      symbol: 'BTCUSDT',
      direction: 'long',
      sizeUsdt: 100,
      pnlUsdt: 25,
      equityAfter: 10_025,
      result: 'win',
    });
    expect(r.summary.finalEquity).toBe(10_025);
    expect(r.summary.totalPnl).toBe(25);
    expect(r.summary.totalReturnPct).toBeCloseTo(0.25, 4);
    expect(r.summary.wins).toBe(1);
    expect(r.summary.losses).toBe(0);
    expect(r.summary.winRate).toBe(1);
  });

  it('a loss tags result=loss and decrements equity', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'short' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -40 });
    const r = buildLedger(w);
    expect(r.trades[0].result).toBe('loss');
    expect(r.trades[0].direction).toBe('short');
    expect(r.trades[0].equityAfter).toBe(9_960);
    expect(r.summary.losses).toBe(1);
    expect(r.summary.winRate).toBe(0);
  });

  it('zero PnL tags result=flat', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 0 });
    expect(buildLedger(w).trades[0].result).toBe('flat');
  });

  it('multiple symbols are paired independently', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    await w.checkTrade({ type: 'open', symbol: 'ETHUSDT', sizeUsdt: 200, direction: 'short' });
    w.reportTradeClosed({ symbol: 'ETHUSDT', pnlUsdt: 30 });   // closes the ETH one
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -10 });   // closes the BTC one
    const r = buildLedger(w);
    expect(r.trades.length).toBe(2);
    const byTs = r.trades.slice().sort((a, b) => a.closedAt - b.closedAt);
    expect(byTs[0].symbol).toBe('ETHUSDT');
    expect(byTs[1].symbol).toBe('BTCUSDT');
  });

  it('FIFO pairing across multiple opens on the same symbol', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 300, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 10 });   // pairs with the FIRST open (size 100)
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 50 });   // pairs with the SECOND open (size 300)
    const r = buildLedger(w);
    expect(r.trades.length).toBe(2);
    expect(r.trades[0].sizeUsdt).toBe(100);
    expect(r.trades[0].pnlUsdt).toBe(10);
    expect(r.trades[1].sizeUsdt).toBe(300);
    expect(r.trades[1].pnlUsdt).toBe(50);
  });

  it('orphan close (no matching open) is skipped, not counted', () => {
    const w = new Watchdog(mkCfg());
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 100 });
    expect(buildLedger(w).trades.length).toBe(0);
  });

  it('aggregate stats: win rate, profit factor, avg win/loss', async () => {
    const w = new Watchdog(mkCfg());
    for (const pnl of [50, -20, 30, -10, 40]) {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: pnl });
    }
    const s = buildLedger(w).summary;
    expect(s.totalTrades).toBe(5);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.winRate).toBeCloseTo(0.6, 4);
    expect(s.totalPnl).toBe(90); // 50-20+30-10+40
    expect(s.finalEquity).toBe(10_090);
    expect(s.avgWin).toBeCloseTo(40, 4);    // (50+30+40)/3
    expect(s.avgLoss).toBeCloseTo(15, 4);   // (20+10)/2
    expect(s.profitFactor).toBeCloseTo(120 / 30, 4); // 4.0
  });

  it('profitFactor is null when no losses exist', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 25 });
    expect(buildLedger(w).summary.profitFactor).toBeNull();
  });
});
