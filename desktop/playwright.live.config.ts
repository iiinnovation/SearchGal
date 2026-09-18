import { defineConfig } from '@playwright/test';

/** Opt-in external-site smoke test; excluded from the repeatable local suite. */
export default defineConfig({
  testDir: './tests/live',
  outputDir: './test-results-live',
  workers: 1,
  timeout: 120_000,
  reporter: [['list'], ['json', { outputFile: 'test-results-live/results.json' }]],
});
