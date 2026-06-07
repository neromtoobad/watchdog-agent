/**
 * wrap-your-agent.ts — copy-paste starter.
 *
 * This is the template a real user forks to put WATCHDOG around their own
 * Bitget trading agent. Replace the two TODO blocks with your real
 * trade-decision logic and your real Bitget order call. Everything else
 * is the WATCHDOG wiring you keep.
 *
 *   npx ts-node examples/wrap-your-agent.ts
 */
import { Watchdog } from '../src/index';
// when installed from npm, this becomes:  import { Watchdog } from 'watchdog-agent';

// ── 1. configure WATCHDOG once ────────────────────────────────────────
const watchdog = new Watchdog({
  agentId: 'my-trading-agent',           // unique name — shows on the leaderboard
  portfolioUsdt: 10_000,                  // your account size, for % math
  rules: {
    maxTradesPerHour: 10,                 // overtrading guard
    maxPositionSizePercent: 25,           // size-creep guard
    maxDrawdownPercent: 15,               // bleed-out guard
    maxConsecutiveLosses: 4,              // broken-strategy guard
    maxSignalOverridesPerHour: 3,         // tilt guard (acting against your own signal)
  },
  onViolation: 'pause',                    // 'pause' blocks bad trades · 'alert' warns · 'log' records only
  ai: { enabled: !!process.env.WATCHDOG_AI_API_KEY }, // LLM incident reports if a key is set
  fleet: { register: true },              // appear on the public leaderboard
});

// ── 2. your trading loop ──────────────────────────────────────────────
async function tradingLoop() {
  // TODO: replace with your real signal/decision logic
  const myIntendedTrade = {
    type: 'open' as const,
    symbol: 'BTCUSDT',
    sizeUsdt: 100,
    direction: 'long' as const,
  };

  // (optional) tell WATCHDOG what your signal said, so it can catch tilt
  watchdog.reportSignal({ signal: 'bullish', action: 'open-long' });

  // ASK PERMISSION before every order
  const decision = await watchdog.checkTrade(myIntendedTrade);

  if (decision.approved) {
    // TODO: replace with your real Bitget order call, e.g.
    //   await bitget.placeOrder({ symbol, side, size })
    console.log(`✅ trade approved — trust ${decision.trustScore}`);

    // when the position later closes, report the outcome:
    const pnlUsdt = -12; // TODO: your realised PnL
    watchdog.reportTradeClosed({ symbol: myIntendedTrade.symbol, pnlUsdt });
  } else {
    // WATCHDOG blocked it — your agent is misbehaving
    console.log(`⛔ blocked: ${decision.reason}`);
    console.log(`   trust score: ${decision.trustScore}`);
    if (decision.forecasts.length) {
      console.log(`   forecast: ${decision.forecasts[0].detail}`);
    }
  }
}

// ── 3. read the intelligence anytime ──────────────────────────────────
function inspect() {
  console.log('\n── WATCHDOG snapshot ──');
  console.log('trust:     ', watchdog.getTrustScore());     // { score, band, trend }
  console.log('forecast:  ', watchdog.getForecast());       // upcoming breaches
  console.log('diagnosis: ', watchdog.getLastDiagnosis());  // AI postmortem (or null)
  const audit = watchdog.verifyAuditChain();
  console.log('audit:     ', audit.valid ? 'intact ✓' : `BROKEN at ${audit.brokenAt}`);
}

(async () => {
  await tradingLoop();
  inspect();

  // OPTIONAL: launch the live dashboard at http://localhost:3000
  // (requires the optional `express` dependency)
  //
  //   import { createDashboardServer } from 'watchdog-agent/server';
  //   await createDashboardServer(watchdog, 3000);
})();
