import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { transparentFixturePng } from '../helpers/image';

const executablePath = process.env.SEARCHGAL_TEST_EXECUTABLE;

test('a transparent image imports, hit-tests, moves, persists and can be removed', async ({}, info) => {
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-companion-'));
  const source = join(directory, 'transparent-fixture.png');
  await writeFile(source, transparentFixturePng());
  let app: ElectronApplication | undefined;
  let panel: Page;
  const errors: string[] = [];
  async function launch() {
    app = await electron.launch({ executablePath,
      args: [...(executablePath ? [] : [resolve(__dirname, '../..')]), `--user-data-dir=${directory}`],
      env: { ...process.env, SEARCHGAL_E2E: '1' },
    });
    panel = await app.firstWindow();
    await expect(panel.getByRole('button', { name: '我的伙伴', exact: true })).toBeVisible();
    panel.on('pageerror', error => errors.push(error.message));
  }
  try {
    await launch();
    await app!.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, source);
    await panel!.getByRole('button', { name: '我的伙伴', exact: true }).click();
    await panel!.getByRole('button', { name: '导入角色', exact: true }).click();
    await expect.poll(async () => (await panel!.evaluate(() => window.searchgal.snapshot())).characters.length).toBe(1);
    await expect.poll(() => app!.windows().length).toBe(2);
    const pet = app!.windows().find(window => window !== panel)!;
    pet.on('pageerror', error => errors.push(error.message));
    await expect(pet.locator('.pet-art')).toBeVisible();
    await expect.poll(() => pet.locator('.pet-art').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(369);
    await pet.emulateMedia({ reducedMotion: 'no-preference' });
    await panel!.evaluate(() => window.searchgal.hidePanel());
    // Sample running frames before disabling animations for hit-testing and screenshots.
    // The pet must keep visibly moving when the manager window is hidden.
    const animation = await pet.locator('.pet-art').evaluate(async (img: HTMLImageElement) => {
      const samples = [];
      for (let i = 0; i < 18; i++) {
        const rect = img.getBoundingClientRect();
        const running = img.getAnimations()[0];
        samples.push({ top: rect.top, height: rect.height, time: Number(running?.currentTime ?? 0), playState: running?.playState });
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return { name: getComputedStyle(img).animationName, visibility: document.visibilityState, samples };
    });
    await writeFile(info.outputPath('animation.json'), JSON.stringify(animation, null, 2));
    expect(animation.name).toBe('breathe');
    expect(animation.visibility).toBe('visible');
    expect(animation.samples.every(frame => frame.playState === 'running')).toBe(true);
    expect(animation.samples.at(-1)!.time - animation.samples[0].time).toBeGreaterThan(2500);
    const tops = animation.samples.map(frame => frame.top);
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(10);
    await pet.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => pet.locator('.pet-art').evaluate(img => img.getAnimations().length)).toBe(0);
    const sample = await pet.locator('.pet-art').evaluate((img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0);
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0, opaque = 0;
      for (let i = 3; i < bytes.length; i += 4) { if (bytes[i] === 0) transparent++; if (bytes[i] > 240) opaque++; }
      return { transparent, opaque, width: canvas.width, height: canvas.height };
    });
    expect(sample).toMatchObject({ width: 369, height: 544 });
    expect(sample.transparent).toBeGreaterThan(10000);
    expect(sample.opaque).toBeGreaterThan(10000);
    // Observe calls to Electron's native hit-test API; this does not simulate physical OS clicks.
    await app!.evaluate(({ BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!;
      const original = pet.setIgnoreMouseEvents.bind(pet);
      (globalThis as any).petIgnored = undefined;
      pet.setIgnoreMouseEvents = (ignore, options) => { (globalThis as any).petIgnored = ignore; original(ignore, options); };
    });
    await pet.mouse.move(1, 1);
    await expect.poll(() => app!.evaluate(() => (globalThis as any).petIgnored)).toBe(true);
    const rect = await pet.locator('.pet-art').boundingBox();
    await pet.mouse.move(rect!.x + rect!.width * .48, rect!.y + rect!.height * .3);
    await expect.poll(() => app!.evaluate(() => (globalThis as any).petIgnored)).toBe(false);
    await pet.screenshot({ path: info.outputPath('pet.png'), omitBackground: true, animations: 'disabled' });

    const baseline = await panel!.evaluate(() => window.searchgal.snapshot());
    for (const status of ['searching', 'failed'] as const) {
      const state = { ...baseline, search: { ...baseline.search, status, query: '测试作品' } };
      await app!.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!.webContents.send('app:state', state);
      }, state);
      await expect(pet.locator('.pet-shell')).toHaveAttribute('data-state', status === 'searching' ? 'searching' : 'error');
      await expect(pet.locator('.pet-bubble')).toContainText(status === 'searching' ? '正在寻找' : '遇到一点问题');
    }
    await app!.evaluate(({ BrowserWindow }, state) => {
      BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!.webContents.send('app:state', state);
    }, baseline);

    // Supply cursor coordinates to exercise the native movement loop deterministically.
    const moved = await app!.evaluate(({ BrowserWindow, screen }) => {
      const pet = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!;
      const work = screen.getPrimaryDisplay().workArea;
      pet.setPosition(work.x + 30, work.y + 30);
      (globalThis as any).cursor = { x: work.x + 80, y: work.y + 80 };
      (globalThis as any).cursorReads = 0;
      screen.getCursorScreenPoint = () => { (globalThis as any).cursorReads++; return { ...(globalThis as any).cursor }; };
      return { x: work.x + 80, y: work.y + 90 };
    });
    await pet.evaluate(() => window.searchgal.petDrag('start'));
    await expect.poll(() => app!.evaluate(() => (globalThis as any).cursorReads)).toBeGreaterThan(0);
    await app!.evaluate(() => { (globalThis as any).cursor.x += 50; (globalThis as any).cursor.y += 60; });
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => {
      const [x, y] = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!.getPosition();
      return { x, y };
    })).toEqual(moved);
    await pet.evaluate(() => window.searchgal.petDrag('end'));
    await expect.poll(async () => (await panel!.evaluate(() => window.searchgal.snapshot())).settings.petPosition).toEqual(moved);
    await panel!.evaluate(() => window.searchgal.showPanel('companions'));
    await panel!.getByRole('combobox', { name: '角色大小' }).selectOption('220');
    await pet.getByRole('button', { name: '隐藏伙伴' }).click();
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!.isVisible())).toBe(false);
    await panel!.evaluate(() => window.searchgal.updateSettings({ petVisible: true, nickname: '千早' }));
    await app!.close(); app = undefined;
    await launch();
    const restored = await panel!.evaluate(() => window.searchgal.snapshot());
    expect(restored.settings).toMatchObject({ nickname: '千早', petSize: 220, petPosition: moved, petVisible: true });
    expect(restored.characters).toHaveLength(1);
    await expect.poll(() => app!.windows().length).toBe(2);
    await panel!.getByRole('button', { name: '我的伙伴', exact: true }).click();
    await panel!.screenshot({ path: info.outputPath('companions.png'), animations: 'disabled' });
    const imported = join(directory, 'characters', restored.characters[0].image);
    expect((await readFile(imported)).length).toBeGreaterThan(0);
    await panel!.getByRole('button', { name: /^移除 / }).click();
    await expect.poll(async () => (await panel!.evaluate(() => window.searchgal.snapshot())).characters.length).toBe(0);
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!.isVisible())).toBe(false);
    await expect(readFile(imported)).rejects.toThrow();
    expect((await readFile(source)).length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    try { if (app) await app.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
