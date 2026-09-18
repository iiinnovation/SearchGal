import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test, expect, type ElectronApplication } from '@playwright/test';

test('embedded Electron search queries real platforms without a separate API', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-live-search-'));
  let app: ElectronApplication | undefined;
  try {
    const executablePath = process.env.SEARCHGAL_TEST_EXECUTABLE;
    app = await electron.launch({
      executablePath,
      args: [...(executablePath ? [] : [resolve(__dirname, '../..')]), `--user-data-dir=${directory}`],
      env: { ...process.env, SEARCHGAL_E2E: '1', SEARCHGAL_DATA_DIR: directory, SEARCHGAL_API: '' },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('textbox', { name: '游戏名称' })).toBeVisible();
    const before = await page.evaluate(() => window.searchgal.snapshot());
    expect(before.settings.apiUrl).toBe('');
    expect(before.packaged).toBe(Boolean(executablePath));
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(directory);
    await page.getByRole('textbox', { name: '游戏名称' }).fill('千恋万花');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.searchgal.snapshot())).search.status, {
      timeout: 100_000, intervals: [250, 500, 1000],
    }).toMatch(/^(complete|failed)$/);
    const { search, platform } = await page.evaluate(() => window.searchgal.snapshot());
    const runtime = await app.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node }));
    const result = {
      timestamp: new Date().toISOString(), platform, packaged: before.packaged, runtime,
      scope: 'real external search in the bundled Electron utility worker; no download attempted',
      query: search.query, status: search.status, completedPlatforms: search.completed, totalPlatforms: search.total,
      resultPlatforms: new Set(search.candidates.map(candidate => candidate.platform)).size,
      candidateCount: search.candidates.length, platformErrors: search.errors, error: search.error,
      candidates: search.candidates.map(({ name, platform, url }) => ({ name, platform, url })),
      rendererErrors: errors,
    };
    await writeFile(info.outputPath('live-search.json'), JSON.stringify(result, null, 2));
    await page.screenshot({ path: info.outputPath('live-search.png'), animations: 'disabled' });
    console.log(JSON.stringify({ status: result.status, completed: result.completedPlatforms, total: result.totalPlatforms,
      resultPlatforms: result.resultPlatforms, candidates: result.candidateCount, platformErrors: result.platformErrors.length }));
    expect(search.status).toBe('complete');
    expect(search.completed).toBe(search.total);
    expect(search.candidates.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
