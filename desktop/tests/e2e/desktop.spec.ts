import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, test, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import type { AppSnapshot, StoredState } from '../../src/shared/contracts';
import { startSite } from '../helpers/site';
import { defaultState } from '../../src/main/state';

const desktopRoot = resolve(__dirname, '../..');
const exec = promisify(execFile);
const executablePath = process.env.SEARCHGAL_TEST_EXECUTABLE;

test.describe('Electron search and download flow', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let directory: string;
  let site: Awaited<ReturnType<typeof startSite>>;
  let errors: string[];

  async function launch() {
    app = await electron.launch({
      executablePath,
      args: [...(executablePath ? [] : [desktopRoot]), `--user-data-dir=${directory}`],
      env: { ...process.env, SEARCHGAL_E2E: '1', SEARCHGAL_DATA_DIR: directory, SEARCHGAL_API: site.url },
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '找到想玩的游戏。' })).toBeVisible();
    expect((await snapshot()).packaged).toBe(Boolean(executablePath));
    const runtime = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), executable: process.execPath }));
    expect(resolve(runtime.userData)).toBe(resolve(directory));
    if (executablePath) expect(resolve(runtime.executable)).toBe(resolve(executablePath));
  }

  async function snapshot(): Promise<AppSnapshot> { return page.evaluate(() => window.searchgal.snapshot()); }

  async function search(query: string) {
    await page.getByRole('button', { name: '发现作品' }).click();
    await page.getByRole('textbox', { name: '游戏名称' }).fill(query);
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect.poll(async () => (await snapshot()).search.status).toBe('complete');
    await expect(page.getByTestId('result-card').first()).toBeVisible();
  }

  async function activeDownload(query: string) {
    await search(query);
    await page.getByRole('button', { name: '自动选源下载' }).click();
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'downloading');
    await expect.poll(async () => (await snapshot()).tasks[0].files[0]?.receivedBytes ?? 0).toBeGreaterThan(64 * 1024);
    return card;
  }

  test.beforeEach(async () => {
    errors = [];
    directory = await mkdtemp(join(tmpdir(), 'searchgal-electron-'));
    const chinese = join(directory, '中文 下载与设置');
    await mkdir(chinese);
    directory = chinese;
    site = await startSite();
    const initialState = defaultState(join(directory, 'downloads'), site.url);
    initialState.settings.notifications = false;
    await writeFile(join(directory, 'state.json'), JSON.stringify(initialState));
    await launch();
  });

  test.afterEach(async ({}, info: TestInfo) => {
    try {
      if (app && !page.isClosed()) {
        await page.screenshot({ path: info.outputPath('manager.png'), animations: 'disabled' });
        await writeFile(info.outputPath('snapshot.json'), JSON.stringify(await snapshot(), null, 2));
      }
      if (app) await app.close();
    } finally {
      app = undefined;
      if (site) await site.close();
      if (directory) await rm(dirname(directory), { recursive: true, force: true });
    }
    assert.deepEqual(errors, [], 'renderer errors');
  });

  test('search → pause → exact Range resume → ZIP extraction in a Chinese path', async ({}, info) => {
    const card = await activeDownload('续传演示');
    await card.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(card).toHaveAttribute('data-status', 'paused');
    const paused = (await snapshot()).tasks[0];
    const destination = join(paused.outputDirectory, 'demo.zip');
    const partial = (await stat(destination + '.part')).size;
    expect(partial).toBeGreaterThan(0); expect(partial).toBeLessThan(site.archive.bytes.length);
    await page.screenshot({ path: info.outputPath('paused.png'), animations: 'disabled' });
    await card.getByRole('button', { name: '继续下载' }).click();
    if (process.platform === 'darwin') {
      // Native traffic lights are outside the renderer; exercise the same close event.
      await (await app!.browserWindow(page)).evaluate(window => window.close());
    } else await page.getByRole('button', { name: '隐藏到托盘' }).click();
    expect(await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    await expect(card).toHaveAttribute('data-status', 'completed');
    await page.evaluate(() => window.searchgal.showPanel('downloads'));
    expect(site.requests.some(request => request.method === 'GET' && request.range === `bytes=${partial}-` && request.ifRange === '"demo-v1"')).toBe(true);
    expect((await readFile(destination)).equals(site.archive.bytes)).toBe(true);
    expect(await readdir(paused.outputDirectory)).toEqual(['demo.zip']);
    const extracted = join(directory, '解压 检验');
    if (process.platform === 'win32') {
      await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SEARCHGAL_TEST_ARCHIVE -DestinationPath $env:SEARCHGAL_TEST_EXTRACT -ErrorAction Stop'], {
        env: { ...process.env, SEARCHGAL_TEST_ARCHIVE: destination, SEARCHGAL_TEST_EXTRACT: extracted }, timeout: 15000,
      });
    } else await exec('unzip', ['-q', destination, '-d', extracted], { timeout: 15000 });
    for (const [name, bytes] of site.archive.entries) expect((await readFile(join(extracted, name))).equals(bytes)).toBe(true);
  });

  test('entering a name automatically falls back and downloads into the chosen directory', async ({}, info) => {
    const destination = join(directory, '指定游戏目录');
    await mkdir(destination);
    await app!.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, destination);
    await page.getByRole('button', { name: '更改位置', exact: true }).click();
    await expect(page.locator('.search-destination')).toContainText(destination);
    // Both direct archive URLs have equal rank, so the unavailable source is tried first.
    site.setSources([{ platform: '失效来源', path: '/missing.zip' }, { platform: '可用来源', path: '/demo.zip' }]);
    await page.getByRole('textbox', { name: '游戏名称' }).fill('一键下载测试');
    await page.screenshot({ path: info.outputPath('automatic-download-home.png'), animations: 'disabled' });
    await page.getByRole('textbox', { name: '游戏名称' }).press('Enter');
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'completed');
    const state = await snapshot();
    expect(state.tasks).toHaveLength(1);
    expect(state.search.taskId).toBe(state.tasks[0].id);
    expect(dirname(state.tasks[0].outputDirectory)).toBe(destination);
    expect(state.tasks[0].attemptIndex).toBe(1);
    expect(site.requests.some(request => request.path === '/missing.zip')).toBe(true);
    expect((await readFile(join(state.tasks[0].outputDirectory, 'demo.zip'))).equals(site.archive.bytes)).toBe(true);
    await page.screenshot({ path: info.outputPath('automatic-download-completed.png'), animations: 'disabled' });
    site.setSources([]);
    await page.getByRole('button', { name: '发现作品', exact: true }).click();
    await page.getByRole('textbox', { name: '游戏名称' }).fill('不存在的游戏');
    await page.getByRole('button', { name: '自动下载', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('没有找到足够匹配');
    expect((await snapshot()).tasks).toHaveLength(1);
  });

  test('candidate fallback cannot complete a missing volume; retry safely reuses the finished volume', async () => {
    site.setSources([{ platform: '失效来源', path: '/unavailable' }, { platform: '备用来源', path: '/bundle' }]);
    site.resources.get('/game.7z.002')!.status = 404;
    await search('分卷测试');
    await page.getByRole('button', { name: '自动选源下载' }).click();
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'failed');
    const failed = (await snapshot()).tasks[0];
    expect(failed.attemptIndex).toBe(1);
    expect(failed.files).toHaveLength(2);
    expect(failed.files[0].state).toBe('completed');
    expect(failed.files[1].state).not.toBe('completed');
    expect(site.requests.some(request => request.path === '/unavailable')).toBe(true);
    site.resources.get('/game.7z.002')!.status = undefined;
    await card.getByRole('button', { name: '重试', exact: true }).click();
    await expect(card).toHaveAttribute('data-status', 'completed');
    expect(site.requests.filter(request => request.method === 'GET' && request.path === '/game.7z.001')).toHaveLength(1);
    for (const name of ['game.7z.001', 'game.7z.002']) {
      expect((await readFile(join(failed.outputDirectory, name))).equals(site.resources.get('/' + name)!.body)).toBe(true);
    }
  });

  test('one automatic-download click selects a source even when the search stream breaks', async ({}, info) => {
    site.resources.get('/demo.zip')!.delayMs = undefined;
    site.setSources([{ platform: '失效来源', path: '/missing.zip' }, { platform: '可用来源', path: '/demo.zip' }]);
    site.setSearchInterruption(true);
    await page.getByRole('textbox', { name: '游戏名称' }).fill('自动接续测试');
    await page.getByRole('button', { name: '自动下载', exact: true }).click();
    await expect(page.getByTestId('result-card').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '自动选源下载', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('automatic-search.png'), animations: 'disabled' });
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'completed');
    const state = await snapshot();
    expect(state.search.status).toBe('failed');
    expect(state.tasks).toHaveLength(1);
    expect(state.search.taskId).toBe(state.tasks[0].id);
    expect(state.tasks[0].attemptIndex).toBe(1);
    expect((await readFile(join(state.tasks[0].outputDirectory, 'demo.zip'))).equals(site.archive.bytes)).toBe(true);
    await page.screenshot({ path: info.outputPath('automatic-completed.png'), animations: 'disabled' });
  });

  test('abrupt exit restores a paused task; cancelled tasks stay cancelled after relaunch', async () => {
    await activeDownload('异常退出恢复');
    await expect.poll(async () => JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).tasks[0].status).toBe('downloading');
    const first = (await snapshot()).tasks[0];
    const exited = new Promise<void>(resolve => app!.process().once('exit', () => resolve()));
    await app!.evaluate(({ app }) => { setImmediate(() => app.exit(23)); });
    await exited;
    app = undefined;
    const persisted = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')) as StoredState;
    expect(persisted.tasks[0].status).toBe('downloading');
    await launch();
    await page.getByRole('button', { name: '下载任务', exact: true }).click();
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'paused');
    expect((await snapshot()).tasks[0].id).toBe(first.id);
    await card.getByRole('button', { name: '继续下载' }).click();
    await expect(card).toHaveAttribute('data-status', 'completed');
    expect((await readFile(join(first.outputDirectory, 'demo.zip'))).equals(site.archive.bytes)).toBe(true);
    const cancelling = await activeDownload('取消演示');
    await cancelling.getByRole('button', { name: '取消 取消演示', exact: true }).click();
    await expect(cancelling).toHaveAttribute('data-status', 'cancelled');
    await app!.close(); app = undefined;
    await launch();
    await page.getByRole('button', { name: '下载任务', exact: true }).click();
    await expect(page.getByTestId('task-card').first()).toHaveAttribute('data-status', 'cancelled');
    expect((await snapshot()).tasks[1].status).toBe('completed');
  });

  test('directory selection and companion preferences persist without creating a substitute character', async ({}, info) => {
    const chosenDirectory = join(directory, '我的游戏');
    await mkdir(chosenDirectory);
    await app!.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, chosenDirectory);
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByRole('button', { name: '更改', exact: true }).click();
    await expect.poll(async () => (await snapshot()).settings.downloadDirectory).toBe(chosenDirectory);
    await page.screenshot({ path: info.outputPath('settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '我的伙伴', exact: true }).click();
    await expect(page.getByRole('button', { name: /添加第一位伙伴/ })).toBeVisible();
    await page.getByRole('textbox', { name: '伙伴昵称' }).fill('星星');
    await page.getByRole('button', { name: '保存昵称', exact: true }).click();
    await page.getByRole('combobox', { name: '角色大小' }).selectOption('220');
    await expect.poll(async () => (await snapshot()).settings.nickname).toBe('星星');
    await page.screenshot({ path: info.outputPath('companions.png'), animations: 'disabled' });
    await app!.close(); app = undefined;
    await launch();
    const restored = await snapshot();
    expect(restored.settings.downloadDirectory).toBe(chosenDirectory);
    expect(restored.settings.nickname).toBe('星星');
    expect(restored.settings.petSize).toBe(220);
    expect(restored.characters).toEqual([]);
    expect(app!.windows()).toHaveLength(1);
  });

  test('LLM settings drive strict fallback and persist a copyable password without exposing the API key', async ({}, info) => {
    const key = 'fixture-private-api-key';
    const password = "public-'$(literal)-" + 'long-password-'.repeat(10);
    site.resources.get('/demo.zip')!.delayMs = undefined;
    site.resources.set('/llm-blocked', { body: Buffer.from('<p>Password requires payment</p><a href="/blocked.zip">game</a>'), type: 'text/html' });
    site.resources.set('/llm-public', { body: Buffer.from(`<p>password: ${password}</p><a href="/demo.zip">game</a>`), type: 'text/html' });
    site.setSources([{ platform: 'blocked', path: '/llm-blocked' }, { platform: 'public', path: '/llm-public' }]);
    site.llmResponses.push(
      { canExtractWithoutExtraPassword: false, hasPassword: true, riskType: 'need_payment', reason: '需付费获取密码' },
      { canExtractWithoutExtraPassword: true, hasPassword: true, extractedPassword: password, riskType: 'none', reason: '正文已提供公开密码' },
    );
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByLabel('启用 LLM 检查').check();
    await page.getByLabel('LLM 接口地址').fill(site.url + '/v1');
    await page.getByLabel('模型名称').fill('fixture-model');
    await page.getByLabel(/^API Key/).fill(key);
    await page.getByLabel('密码检查策略').selectOption('skip');
    await page.getByRole('button', { name: '保存 LLM 设置', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('LLM 设置已保存');
    await expect(page.getByLabel(/^API Key/)).toHaveValue('');
    expect((await snapshot()).llmKeyConfigured).toBe(true);
    expect(JSON.stringify(await snapshot())).not.toContain(key);
    expect(await readFile(join(directory, 'state.json'), 'utf8')).not.toContain(key);
    await (await app!.browserWindow(page)).evaluate(window => window.setSize(1080, 920));
    await page.locator('.llm-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('llm-settings.png') });
    await search('LLM 密码测试');
    await page.getByRole('button', { name: '自动选源下载' }).click();
    const card = page.getByTestId('task-card').first();
    await expect(card).toHaveAttribute('data-status', 'completed');
    await expect(card.locator('.task-password code')).toHaveText(password);
    await expect(card.locator('.password-assessment')).toContainText('已找到公开密码');
    expect(site.llmRequests).toHaveLength(2);
    expect(site.llmRequests[0].authorization).toBe(`Bearer ${key}`);
    expect(site.llmRequests[0].body.model).toBe('fixture-model');
    expect(site.requests.some(request => request.path === '/blocked.zip')).toBe(false);
    await card.getByRole('button', { name: '复制解压密码' }).click();
    expect(await app!.evaluate(({ clipboard }) => clipboard.readText())).toBe(password);
    await expect(card.getByRole('status')).toContainText('密码已复制');
    await page.screenshot({ path: info.outputPath('llm-password.png') });
    await (await app!.browserWindow(page)).evaluate(window => window.setSize(860, 620));
    expect(await card.locator('.task-password').evaluate(element => {
      const code = element.querySelector('code')!.getBoundingClientRect();
      const button = element.querySelector('button')!.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth && code.right <= button.left;
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('llm-password-compact.png') });
    await app!.close(); app = undefined;
    await launch();
    expect((await snapshot()).tasks[0].password).toBe(password);
    expect((await snapshot()).settings.llm.failureMode).toBe('skip');
    expect((await snapshot()).llmKeyConfigured).toBe(true);
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await expect(page.getByLabel(/^API Key/)).toHaveValue('');
    await page.getByLabel('启用 LLM 检查').uncheck();
    await page.getByRole('button', { name: '保存 LLM 设置', exact: true }).click();
    await expect.poll(async () => (await snapshot()).settings.llm.enabled).toBe(false);
    site.setSources([{ platform: 'public', path: '/llm-public' }]);
    await search('关闭检查测试');
    await page.getByRole('button', { name: '自动选源下载' }).click();
    await expect(page.getByTestId('task-card').first()).toHaveAttribute('data-status', 'completed');
    expect(site.llmRequests).toHaveLength(2);
    await expect(page.getByTestId('task-card').first().locator('.task-password')).toHaveCount(0);
    await page.getByRole('button', { name: '偏好设置', exact: true }).click();
    await page.getByRole('button', { name: '删除 API Key' }).click();
    await expect.poll(async () => (await snapshot()).llmKeyConfigured).toBe(false);
    await app!.close(); app = undefined;
    await launch();
    expect((await snapshot()).llmKeyConfigured).toBe(false);
    expect((await snapshot()).settings.llm.enabled).toBe(false);
  });
});
