import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildMain() {
  await bundle({
    absWorkingDir: root,
    entryPoints: { index: 'src/main/index.ts', worker: 'src/main/worker.ts' },
    outdir: 'out/main', outExtension: { '.js': '.cjs' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['electron'], nodePaths: [resolve(root, 'node_modules')], sourcemap: true,
  });
  await bundle({
    absWorkingDir: root, entryPoints: ['src/preload/index.ts'],
    outfile: 'out/preload/index.cjs', bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], target: 'node22', sourcemap: true,
  });
  await mkdir(resolve(root, 'out'), { recursive: true });
  await copyFile(resolve(root, '../LICENSE'), resolve(root, 'out/LICENSE'));
  await copyFile(resolve(root, '../NOTICE'), resolve(root, 'out/NOTICE'));
}

export const rendererConfig = {
  root: resolve(root, 'src/renderer'), base: './',
  build: { outDir: resolve(root, 'out/renderer'), emptyOutDir: true },
  esbuild: { jsx: 'automatic' },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMain();
  await buildRenderer(rendererConfig);
}
