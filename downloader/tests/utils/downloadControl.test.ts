import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { downloadWithNode } from '../../src/utils/nodeDownload.js';
import { DirectDownloader } from '../../src/tools/DirectDownloader.js';
import { startServer } from '../helpers/httpServer.js';

describe('Download progress, pause and resume', () => {
  it('cancels a live transfer promptly, retains only valid partial state and resumes exact bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'searchgal-control-'));
    const destPath = join(directory, 'game.bin');
    const bytes = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const ranges: Array<string | undefined> = [];
    let slow = true;
    const server = await startServer((request, response) => {
      const range = request.headers.range;
      ranges.push(range);
      const start = Number(range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0);
      response.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length - start), ETag: '"control-v1"',
        ...(range ? { 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}),
      });
      if (!slow) { response.end(bytes.subarray(start)); return; }
      let offset = start;
      const timer = setInterval(() => {
        const end = Math.min(offset + 8192, bytes.length);
        response.write(bytes.subarray(offset, end));
        offset = end;
        if (offset === bytes.length) { clearInterval(timer); response.end(); }
      }, 8);
      response.once('close', () => clearInterval(timer));
    });
    try {
      const controller = new AbortController();
      const progress: number[] = [];
      const download = downloadWithNode({
        url: server.url + '/game.bin', destPath, expectedSize: bytes.length, quiet: true, signal: controller.signal,
        onProgress: value => {
          progress.push(value.receivedBytes);
          if (value.receivedBytes > bytes.length / 4 && value.receivedBytes < bytes.length) controller.abort(new Error('pause'));
        },
      });
      await expect(download).rejects.toThrow('pause');
      expect(existsSync(destPath)).toBe(false);
      expect(existsSync(destPath + '.part.json')).toBe(true);
      const partial = (await stat(destPath + '.part')).size;
      expect(partial).toBeGreaterThan(0);
      expect(partial).toBeLessThan(bytes.length);
      expect(ranges).toHaveLength(1);
      expect(progress[0]).toBe(0);
      slow = false;
      await downloadWithNode({ url: server.url + '/game.bin', destPath, expectedSize: bytes.length, quiet: true });
      expect(ranges[1]).toBe(`bytes=${partial}-`);
      expect((await readFile(destPath)).equals(bytes)).toBe(true);
      expect(existsSync(destPath + '.part')).toBe(false);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not retry a cancelled probe as a range request or convert cancellation into download failure', async () => {
    let requests = 0;
    const controller = new AbortController();
    const server = await startServer(() => { requests++; controller.abort(new Error('stop probe')); });
    try {
      const result = new DirectDownloader({ aria2c: false }).download(
        { kind: 'http', url: server.url + '/file' },
        { outputDir: tmpdir(), signal: controller.signal, quiet: true },
      );
      await expect(result).rejects.toThrow('stop probe');
      expect(requests).toBe(1);
    } finally {
      await server.close();
    }
  });
});
