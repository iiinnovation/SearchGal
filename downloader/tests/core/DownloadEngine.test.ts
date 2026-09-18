import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DownloadEngine, type DownloadEvent, type FileCheckpoint } from '../../src/core/DownloadEngine.js';
import type { Candidate } from '../../src/types/index.js';
import { startServer } from '../helpers/httpServer.js';

describe('DownloadEngine task boundaries and checkpoints', () => {
  let directory: string;
  let server: Awaited<ReturnType<typeof startServer>>;
  let gets: string[];
  let brokenSecond: boolean;
  let version: string;
  let contents: Record<string, string>;
  const engine = new DownloadEngine({ aria2c: false });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'searchgal-engine-'));
    gets = [];
    brokenSecond = false;
    version = 'v1';
    contents = { '/game.7z.001': 'AAAAAAAAAA', '/game.7z.002': 'BBBBBBBBBB' };
    server = await startServer((request, response) => {
      const url = request.url ?? '';
      if (request.method === 'GET') gets.push(url);
      if (url === '/page') {
        const body = '<a href="/game.7z.001">1</a><a href="/game.7z.002">2</a>';
        response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': String(Buffer.byteLength(body)) });
        response.end(request.method === 'HEAD' ? undefined : body);
      } else if (contents[url] && !(brokenSecond && url.endsWith('002'))) {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '10', ETag: `"${version}"` });
        response.end(request.method === 'HEAD' ? undefined : contents[url]);
      } else response.writeHead(404).end();
    });
  });

  afterEach(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  function candidate(path = '/page'): Candidate {
    return { name: 'game', url: server.url + path, platform: 'fixture', platformTags: [], score: 1, reasons: [] };
  }

  async function run(checkpoints: FileCheckpoint[] = []) {
    const events: DownloadEvent[] = [];
    const result = await engine.run([candidate()], {
      outputDir: directory, quiet: true, checkpoints, onEvent: event => events.push(event),
    });
    return { result, events, checkpoints: events.flatMap(event => event.type === 'file-complete' && event.checkpoint ? [event.checkpoint] : []) };
  }

  it('only completes a task after every required volume succeeds', async () => {
    brokenSecond = true;
    const failed = await run();
    expect(failed.result.success).toBe(false);
    expect(failed.events.filter(event => event.type === 'file-complete')).toHaveLength(1);
    expect(failed.events.some(event => event.type === 'complete')).toBe(false);
    brokenSecond = false;
    const completed = await run(failed.checkpoints);
    expect(completed.result.success).toBe(true);
    expect(completed.result.paths).toHaveLength(2);
    expect(completed.events.at(-1)?.type).toBe('complete');
  });

  it('reuses a completed volume only after checking its source, ETag, size and SHA-256', async () => {
    const first = await run();
    expect(first.checkpoints).toHaveLength(2);
    gets = [];
    const resumed = await run(first.checkpoints);
    expect(resumed.result.success).toBe(true);
    expect(gets).toEqual(['/page']);
    expect(resumed.events.filter(event => event.type === 'file-complete' && event.reused)).toHaveLength(2);
  });

  it('redownloads an unrelated same-sized replacement of a previously completed volume', async () => {
    const first = await run();
    await writeFile(first.checkpoints[0].filepath, 'XXXXXXXXXX');
    gets = [];
    const resumed = await run(first.checkpoints);
    expect(resumed.result.success).toBe(true);
    expect(gets).toEqual(['/page', '/game.7z.001']);
    expect(await readFile(first.checkpoints[0].filepath, 'utf8')).toBe('AAAAAAAAAA');
  });

  it('does not reuse completed files if the upstream version changed', async () => {
    const first = await run();
    version = 'v2';
    contents = { '/game.7z.001': 'CCCCCCCCCC', '/game.7z.002': 'DDDDDDDDDD' };
    const resumed = await run(first.checkpoints);
    expect(resumed.events.filter(event => event.type === 'file-complete' && event.reused)).toHaveLength(0);
    expect(await readFile(join(directory, 'game.7z.001'), 'utf8')).toBe('CCCCCCCCCC');
  });

  it('cancellation stops candidate fallback and does not publish a completion event', async () => {
    const controller = new AbortController();
    const events: DownloadEvent[] = [];
    const pending = engine.run([candidate(), candidate('/other')], {
      outputDir: directory, quiet: true, signal: controller.signal,
      onEvent: event => {
        events.push(event);
        if (event.type === 'file-start') controller.abort(new Error('paused by user'));
      },
    });
    await expect(pending).rejects.toThrow('paused by user');
    expect(events.filter(event => event.type === 'candidate')).toHaveLength(1);
    expect(events.some(event => event.type === 'complete')).toBe(false);
    expect(gets).toEqual(['/page']);
  });
});
