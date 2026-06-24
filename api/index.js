/**
 * Vercel serverless entry for the WATCHDOG dashboard.
 *
 * Runs the Express app (from the compiled dist/) as a single function. On the
 * first request per cold start it seeds a deterministic demo fleet, so any
 * visitor sees a populated, live-looking dashboard with no running process and
 * no API key. Only /api/* and /badge/* are routed here (see vercel.json) — the
 * static pages in public/ are served directly by Vercel's CDN.
 */
const { createDashboardApp } = require('../dist/server/dashboard');
const { seedFleet } = require('../dist/demo/seed');

let appPromise = null;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const primary = await seedFleet();
      return createDashboardApp(primary);
    })();
  }
  return appPromise;
}

module.exports = async (req, res) => {
  const app = await getApp();
  return app(req, res);
};
