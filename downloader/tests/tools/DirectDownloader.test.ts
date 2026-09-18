import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { DirectDownloader } from '../../src/tools/DirectDownloader.js';
import { runInherit, type RunResult } from '../../src/utils/process.js';
import { startServer } from '../helpers/httpServer.js';

// 外部进程的边界测试；真实 aria2 的下载与续传另由 manual 回归执行。
jest.mock('../../src/utils/process.js', () => ({ runInherit: jest.fn() }));

describe('Direct download publication and aria2 state', () => {
  let directory: string;
  let dest: string;
  let server: Awaited<ReturnType<typeof startServer>>;
  let etag: string | undefined;
  let payload: string;
  let declaredSize: number;
  let gzip: boolean;
  let requests: Array<{ method?: string; encoding?: string; ifMatch?: string | string[] }>;
  let transfer: (path: string, args: string[]) => Promise<RunResult>;
  let inputs: Array<{ path: string; existing?: string; args: string[]; final?: string }>;
  const run = jest.mocked(runInherit);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'searchgal-aria-state-'));
    dest = join(directory, 'game.bin');
    etag = '"v1"';
    payload = '1234567890';
    declaredSize = 10;
    gzip = false;
    requests = [];
    inputs = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    server = await startServer((request, response) => {
      requests.push({ method: request.method, encoding: request.headers['accept-encoding'], ifMatch: request.headers['if-match'] });
      if (request.headers['if-match'] && request.headers['if-match'] !== etag) {
        response.writeHead(412);
        response.end();
        return;
      }
      const encoded = gzip && request.headers['accept-encoding']?.includes('gzip');
      const content = encoded ? gzipSync(payload) : Buffer.from(payload);
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(encoded ? content.length : request.method === 'HEAD' ? declaredSize : content.length),
        ...(encoded ? { 'Content-Encoding': 'gzip' } : {}),
        ...(etag ? { ETag: etag } : {}),
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    });
    transfer = async path => {
      await writeFile(path, payload);
      return { code: 0, signal: null };
    };
    run.mockReset();
    run.mockImplementation(async (_command, args) => {
      const path = join(args[args.indexOf('-d') + 1], args[args.indexOf('-o') + 1]);
      inputs.push({
        path, args, existing: existsSync(path) ? await readFile(path, 'utf8') : undefined,
        final: existsSync(dest) ? await readFile(dest, 'utf8') : undefined,
      });
      return transfer(path, args);
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function download(path = '/file', headers?: Record<string, string>, aria2c = true, size: number | undefined = 10) {
    return new DirectDownloader({ aria2c }).download(
      { kind: 'http', url: server.url + path, filename: 'game.bin', headers, size }, { outputDir: directory },
    );
  }

  async function seedPartial(path = '/file', headers?: Record<string, string>, control = true, content = '12345') {
    transfer = async part => {
      await writeFile(part, content);
      if (control) await writeFile(part + '.aria2', 'control-state');
      return { code: 7, signal: null };
    };
    expect((await download(path, headers)).success).toBe(false);
    const partial = inputs.at(-1)!.path;
    transfer = async part => {
      await writeFile(part, payload);
      await rm(part + '.aria2', { force: true });
      return { code: 0, signal: null };
    };
    return partial;
  }

  it('downloads into separate state and replaces an unrelated same-sized final file only after validation', async () => {
    await writeFile(dest, 'ABCDEFGHIJ');
    expect(await download()).toEqual({ success: true, filepath: dest });
    expect(inputs[0]).toMatchObject({ existing: undefined, final: 'ABCDEFGHIJ' });
    expect(inputs[0].path).not.toBe(dest);
    expect(await readFile(dest, 'utf8')).toBe(payload);
    expect(existsSync(inputs[0].path)).toBe(false);
    expect(existsSync(inputs[0].path + '.json')).toBe(false);
    expect(inputs[0].args).toContain('--header=if-match: "v1"');
    expect(requests.at(-1)?.ifMatch).toBe('"v1"');
  });

  it('rejects a successful child exit when only eight of ten expected bytes exist', async () => {
    await writeFile(dest, 'ABCDEFGHIJ');
    transfer = async path => {
      await writeFile(path, '12345678');
      return { code: 0, signal: null };
    };
    const result = await download();
    expect(result.success).toBe(false);
    expect(result.error).toContain('预期 10，实际 8');
    expect(await readFile(dest, 'utf8')).toBe('ABCDEFGHIJ');
    expect(existsSync(inputs[0].path)).toBe(false);
  });

  it('resumes only state with matching source, validator, size and control file', async () => {
    await seedPartial();
    expect((await download()).success).toBe(true);
    expect(inputs[1].existing).toBe('12345');
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('discards partial state when switching sources that happen to share the same ETag', async () => {
    await seedPartial('/a', undefined, true, 'ABCDE');
    expect((await download('/b')).success).toBe(true);
    expect(inputs[1].existing).toBeUndefined();
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('discards partial state when representation-affecting headers change', async () => {
    await seedPartial('/file', { Authorization: 'Bearer a' });
    expect((await download('/file', { Authorization: 'Bearer b' })).success).toBe(true);
    expect(inputs[1].existing).toBeUndefined();
  });

  it('starts fresh when the source changes ETag', async () => {
    await seedPartial();
    etag = '"v2"';
    expect((await download()).success).toBe(true);
    expect(inputs[1].existing).toBeUndefined();
  });

  it('does not trust a full-sized sparse or abandoned partial without its control file', async () => {
    await seedPartial('/file', undefined, false, 'ABCDEFGHIJ');
    expect((await download()).success).toBe(true);
    expect(inputs[1].existing).toBeUndefined();
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('does not trust corrupt sidecar metadata', async () => {
    const partial = await seedPartial();
    await writeFile(partial + '.json', '{broken');
    expect((await download()).success).toBe(true);
    expect(inputs[1].existing).toBeUndefined();
  });

  it('preserves the existing final file on process failure', async () => {
    await writeFile(dest, 'previous file');
    await seedPartial();
    expect(await readFile(dest, 'utf8')).toBe('previous file');
  });

  it('does not publish a download whose validator changes before the final probe', async () => {
    transfer = async path => {
      await writeFile(path, payload);
      etag = '"v2"';
      return { code: 0, signal: null };
    };
    const result = await download();
    expect(result.success).toBe(false);
    expect(result.error).toContain('版本或完整大小发生变化');
    expect(existsSync(dest)).toBe(false);
  });

  it('does not publish a full-sized file when the child leaves unfinished control state', async () => {
    transfer = async path => {
      await writeFile(path, payload);
      await writeFile(path + '.aria2', 'unfinished');
      return { code: 0, signal: null };
    };
    expect((await download()).success).toBe(false);
    expect(existsSync(dest)).toBe(false);
  });

  it.each([undefined, 'W/"v1"'])('uses the validated Node path without a strong ETag (%s)', async validator => {
    etag = validator;
    expect((await download()).success).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });

  it('uses identity encoding for both probes and the actual download when size is unknown', async () => {
    gzip = true;
    const result = await new DirectDownloader({ aria2c: false }).download({
      kind: 'http', url: server.url + '/file', filename: 'game.bin', headers: { 'accept-encoding': 'gzip' },
    }, { outputDir: directory });
    expect(result.success).toBe(true);
    expect(requests.map(r => r.encoding)).toEqual(['identity', 'identity']);
    expect(await readFile(dest, 'utf8')).toBe(payload);
  });
});
