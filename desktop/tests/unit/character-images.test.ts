import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { inspectCharacterImage } from '../../src/main/character-images';
import { transparentFixturePng } from '../helpers/image';

test('reads real PNG, animated GIF/WebP, and simple lossless/lossy WebP headers', async () => {
  const png = transparentFixturePng();
  assert.deepEqual(inspectCharacterImage(png), { format: 'png', width: 369, height: 544 });
  for (const filename of ['moving.gif', 'moving.webp', 'static-lossless.webp', 'static-lossy.webp']) {
    const bytes = await readFile(resolve(__dirname, '../fixtures', filename));
    assert.deepEqual(inspectCharacterImage(bytes), { format: filename.endsWith('.gif') ? 'gif' : 'webp', width: 64, height: 64 });
  }
});

test('rejects excessive dimensions and truncated containers before frame decoding', async () => {
  const gif = await readFile(resolve(__dirname, '../fixtures/moving.gif'));
  gif.writeUInt16LE(65535, 6);
  assert.throws(() => inspectCharacterImage(gif), /4096/);
  const png = transparentFixturePng();
  png.writeUInt32BE(100000, 20);
  assert.throws(() => inspectCharacterImage(png), /4096/);
  const webp = await readFile(resolve(__dirname, '../fixtures/moving.webp'));
  assert.throws(() => inspectCharacterImage(webp.subarray(0, webp.length - 1)), /无法读取/);
  assert.throws(() => inspectCharacterImage(Buffer.from('GIF89a')), /无法读取/);
  assert.throws(() => inspectCharacterImage(Buffer.from('<svg onload="alert(1)"></svg>')), /无法读取/);
});
