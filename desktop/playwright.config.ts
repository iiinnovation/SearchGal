import { defineConfig } from '@playwright/test';

const outputDir = process.env.SEARCHGAL_TEST_EXECUTABLE ? './test-results-installed' : './test-results';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: `${outputDir}/results.json` }]],
});
