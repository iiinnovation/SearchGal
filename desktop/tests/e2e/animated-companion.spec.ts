import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test';

const desktopRoot = resolve(__dirname, '../..');
const executablePath = process.env.SEARCHGAL_TEST_EXECUTABLE;

async function pixels(page: Page) {
  return page.locator('canvas.pet-art').evaluate(async (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const samples = [];
    for (let i = 0; i < 15; i++) {
      samples.push({
        left: Array.from(context.getImageData(canvas.width / 4, canvas.height / 2, 1, 1).data),
        right: Array.from(context.getImageData(canvas.width * 3 / 4, canvas.height / 2, 1, 1).data),
      });
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return samples;
  });
}

function expectMoving(samples: Awaited<ReturnType<typeof pixels>>) {
  expect(samples.some(frame => frame.left[3] === 255 && frame.right[3] === 0)).toBe(true);
  expect(samples.some(frame => frame.left[3] === 0 && frame.right[3] === 255)).toBe(true);
}

for (const format of ['gif', 'webp']) {
  test(`${format} preserves frames, updates stationary-pointer hit testing, respects reduced motion and survives restart`, async ({}, info) => {
    const directory = await mkdtemp(join(tmpdir(), 'searchgal-animated-'));
    const source = join(desktopRoot, 'tests/fixtures', `moving.${format}`);
    const original = await readFile(source);
    const errors: string[] = [];
    let app: ElectronApplication | undefined;
    let panel: Page;
    async function launch() {
      app = await electron.launch({ executablePath,
        args: [...(executablePath ? [] : [desktopRoot]), `--user-data-dir=${directory}`],
        env: { ...process.env, SEARCHGAL_E2E: '1' },
      });
      panel = await app.firstWindow();
      panel.on('pageerror', error => errors.push(error.message));
      await expect(panel.getByRole('button', { name: '我的伙伴', exact: true })).toBeVisible();
    }
    async function petWindow() {
      await expect.poll(() => app!.windows().length).toBe(2);
      const pet = app!.windows().find(page => page !== panel)!;
      pet.on('pageerror', error => errors.push(error.message));
      await expect(pet.locator('canvas.pet-art')).toBeVisible();
      await expect.poll(() => pet.locator('canvas.pet-art').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(64);
      return pet;
    }
    try {
      await launch();
      await app!.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
      await panel!.getByRole('button', { name: '我的伙伴', exact: true }).click();
      await panel!.getByRole('button', { name: '导入角色', exact: true }).click();
      await expect.poll(async () => (await panel!.evaluate(() => window.searchgal.snapshot())).characters.length).toBe(1);
      const character = (await panel!.evaluate(() => window.searchgal.snapshot())).characters[0];
      expect(character).toMatchObject({ width: 64, height: 64, frameCount: 2 });
      expect(character.image).toBe(`${character.id}.${format}`);
      expect((await readFile(join(directory, 'characters', character.image))).equals(original)).toBe(true);
      expect((await readFile(join(directory, 'characters', character.preview!))).length).toBeGreaterThan(0);
      await expect(panel!.getByText('循环动图', { exact: true })).toBeVisible();
      let pet = await petWindow();
      const types = await pet.evaluate(async id => {
        const image = await fetch(`searchgal-asset://characters/${id}`);
        const preview = await fetch(`searchgal-asset://characters/${id}?preview=1`);
        return { image: image.headers.get('content-type'), preview: preview.headers.get('content-type') };
      }, character.id);
      expect(types).toEqual({ image: `image/${format}`, preview: 'image/png' });
      await pet.emulateMedia({ reducedMotion: 'no-preference' });
      await panel!.evaluate(() => window.searchgal.hidePanel());
      expectMoving(await pixels(pet));

      await app!.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#pet'))!;
        const original = window.setIgnoreMouseEvents.bind(window);
        (globalThis as any).animatedPointerStates = [];
        window.setIgnoreMouseEvents = (ignore, options) => { (globalThis as any).animatedPointerStates.push(ignore); original(ignore, options); };
      });
      await pet.locator('canvas.pet-art').evaluate(canvas => {
        const rect = canvas.getBoundingClientRect();
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + rect.width / 4, clientY: rect.top + rect.height / 2 }));
      });
      await expect.poll(() => app!.evaluate(() => {
        const states = (globalThis as any).animatedPointerStates as boolean[];
        return states.includes(true) && states.includes(false);
      })).toBe(true);

      await pet.emulateMedia({ reducedMotion: 'reduce' });
      await expect.poll(() => pet.locator('canvas.pet-art').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(16, 32, 1, 1).data[3])).toBe(255);
      const reduced = await pixels(pet);
      expect(new Set(reduced.map(frame => JSON.stringify(frame))).size).toBe(1);
      expect(reduced[0].right[3]).toBe(0);
      await pet.emulateMedia({ reducedMotion: 'no-preference' });
      const resumed = await pixels(pet);
      expectMoving(resumed);
      await writeFile(info.outputPath('frames.json'), JSON.stringify({ format, character, reduced, resumed }, null, 2));
      await pet.screenshot({ path: info.outputPath('animated-pet.png'), omitBackground: true });

      await app!.close(); app = undefined;
      await launch();
      expect((await panel!.evaluate(() => window.searchgal.snapshot())).characters[0]).toEqual(character);
      pet = await petWindow();
      await pet.emulateMedia({ reducedMotion: 'no-preference' });
      expectMoving(await pixels(pet));
      await panel!.getByRole('button', { name: '我的伙伴', exact: true }).click();
      await panel!.getByRole('button', { name: /^移除 / }).click();
      await expect.poll(async () => (await panel!.evaluate(() => window.searchgal.snapshot())).characters.length).toBe(0);
      await expect.poll(() => readdir(join(directory, 'characters'))).toEqual([]);
      expect((await readFile(source)).equals(original)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      try { if (app) await app.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  });
}

test('a corrupt animation is rejected before saving a companion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-invalid-animation-'));
  let app: ElectronApplication | undefined;
  try {
    const source = join(directory, 'broken.gif');
    const bytes = await readFile(join(desktopRoot, 'tests/fixtures/moving.gif'));
    await writeFile(source, bytes.subarray(0, 13));
    app = await electron.launch({ executablePath,
      args: [...(executablePath ? [] : [desktopRoot]), `--user-data-dir=${directory}`],
      env: { ...process.env, SEARCHGAL_E2E: '1' },
    });
    const panel = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, source);
    await panel.getByRole('button', { name: '我的伙伴', exact: true }).click();
    await panel.getByRole('button', { name: '导入角色', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('图片无法读取');
    expect((await panel.evaluate(() => window.searchgal.snapshot())).characters).toEqual([]);
    expect(await readdir(join(directory, 'characters'))).toEqual([]);
  } finally {
    try { if (app) await app.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
