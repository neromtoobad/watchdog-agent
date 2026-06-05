import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.ts', 'chaos/**/*.ts'],
      exclude: [
        'src/server/dashboard.ts', // exercised by HTTP smoke, not unit-tested
        'src/market/context.ts',   // exercised by live bgc, not unit-tested (requires shell-out)
        'chaos/benchmark.ts',      // CLI runner — exercised by `npm run benchmark`
        '**/*.test.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
