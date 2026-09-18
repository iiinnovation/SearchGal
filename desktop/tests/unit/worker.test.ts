import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { executeJob } from '../../src/main/worker-runtime';
import { PLATFORMS_GAL } from '../../../src/core';
import type { WorkerResponse } from '../../src/shared/contracts';
import { startSite } from '../helpers/site';
import { DEFAULT_CONFIG } from '../../../downloader/src/utils/config';

test('worker parses fragmented search responses and streams results before completion', async t => {
  const site = await startSite();
  t.after(() => site.close());
  const messages: WorkerResponse[] = [];
  await executeJob({ kind: 'search', query: '中文游戏', apiUrl: site.url, proxyUrl: '' }, new AbortController().signal, message => messages.push(message));
  const result = messages.find(message => message.kind === 'search-event' && message.event.result);
  assert.equal(result?.kind === 'search-event' && result.event.result?.items[0].name, '中文游戏');
  const last = messages.at(-1);
  assert.equal(last?.kind, 'search-complete');
  if (last?.kind === 'search-complete') {
    assert.equal(last.outcome.total, 1);
    assert.equal(last.outcome.results[0].items[0].url, site.url + '/demo.zip');
  }
});

test('embedded search calls the shared search core without a separately started API', async t => {
  const original = [...PLATFORMS_GAL];
  t.after(() => { PLATFORMS_GAL.splice(0, PLATFORMS_GAL.length, ...original); });
  PLATFORMS_GAL.splice(0, PLATFORMS_GAL.length, {
    name: '内置平台测试', color: 'lime', tags: ['NoReq'], magic: false,
    search: async query => ({ count: 1, items: [{ name: query, url: 'https://example.test/demo.zip' }] }),
  }, {
    name: '不可用平台', color: 'red', tags: [], magic: false,
    search: async () => ({ count: 0, items: [], error: 'fixture offline' }),
  });
  const messages: WorkerResponse[] = [];
  await executeJob({ kind: 'search', query: '内置搜索', apiUrl: '', proxyUrl: '' }, new AbortController().signal, message => messages.push(message));
  const last = messages.at(-1);
  assert.equal(last?.kind, 'search-complete');
  if (last?.kind === 'search-complete') {
    assert.equal(last.outcome.results[0].items[0].name, '内置搜索');
    assert.equal(last.outcome.errors[0].error, 'fixture offline');
    assert.equal(last.outcome.total, 2);
  }
});

test('a wrong remote API address gives a desktop settings hint', async t => {
  const site = await startSite();
  t.after(() => site.close());
  site.resources.set('/wrong/gal', { body: Buffer.from('<html>not an API</html>'), type: 'text/html' });
  const messages: WorkerResponse[] = [];
  await executeJob({ kind: 'search', query: '作品', apiUrl: site.url + '/wrong', proxyUrl: '' }, new AbortController().signal, message => messages.push(message));
  const last = messages.at(-1);
  assert.equal(last?.kind, 'error');
  if (last?.kind === 'error') {
    assert.match(last.error, /偏好设置/);
    assert.doesNotMatch(last.error, /pnpm|wrangler|--api/);
  }
});

test('worker downloads required volumes and sends an explicit abort without falling back', async t => {
  const site = await startSite();
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-worker-'));
  t.after(async () => { await site.close(); await rm(directory, { recursive: true, force: true }); });
  const candidate = { name: 'game', platform: 'local', url: site.url + '/bundle', score: 1, reasons: [], platformTags: [] };
  const messages: WorkerResponse[] = [];
  await executeJob({ kind: 'download', queue: [candidate], outputDirectory: directory, checkpoints: [], proxyUrl: '' }, new AbortController().signal, message => messages.push(message));
  assert.equal(messages.filter(message => message.kind === 'download-event' && message.event.type === 'file-complete').length, 2);
  const last = messages.at(-1);
  assert.equal(last?.kind === 'download-complete' && last.result.success, true);
  assert.ok((await readFile(join(directory, 'game.7z.002'))).equals(site.resources.get('/game.7z.002')!.body));
  const controller = new AbortController();
  const aborted: WorkerResponse[] = [];
  await executeJob({
    kind: 'download', queue: [{ ...candidate, url: site.url + '/demo.zip' }, candidate],
    outputDirectory: directory, checkpoints: [], proxyUrl: '',
  }, controller.signal, message => {
    aborted.push(message);
    if (message.kind === 'download-event' && message.event.type === 'file-progress' && message.event.progress.receivedBytes > 0) controller.abort();
  });
  assert.equal(aborted.at(-1)?.kind, 'aborted');
  assert.equal(aborted.filter(message => message.kind === 'download-event' && message.event.type === 'candidate').length, 1);
  assert.ok(!aborted.some(message => message.kind === 'download-complete'));
});

test('worker applies strict LLM policy, falls back and returns the successful password', async t => {
  const site = await startSite();
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-llm-worker-'));
  t.after(async () => { await site.close(); await rm(directory, { recursive: true, force: true }); });
  site.resources.set('/blocked', { body: Buffer.from('<p>Password needs payment</p><a href="/blocked.zip">game</a>'), type: 'text/html' });
  site.resources.set('/public', { body: Buffer.from('<p>password: public-secret</p><a href="/game.7z.001">1</a><a href="/game.7z.002">2</a>'), type: 'text/html' });
  site.llmResponses.push(
    { canExtractWithoutExtraPassword: false, hasPassword: true, riskType: 'need_payment', reason: 'payment required' },
    { canExtractWithoutExtraPassword: true, hasPassword: true, extractedPassword: 'public-secret', riskType: 'none', reason: 'public' },
  );
  const candidate = { name: 'game', platform: 'local', url: site.url + '/blocked', score: 1, reasons: [], platformTags: [] };
  const config = { llm: { ...DEFAULT_CONFIG.llm, enabled: true, baseURL: site.url + '/v1', apiKey: 'test-key', model: 'test-model' }, passwordCheck: { enabled: true, failureMode: 'skip' as const } };
  const messages: WorkerResponse[] = [];
  await executeJob({ kind: 'download', queue: [candidate, { ...candidate, url: site.url + '/public' }], outputDirectory: directory, checkpoints: [], proxyUrl: '', llm: config }, new AbortController().signal, message => messages.push(message));
  const last = messages.at(-1);
  assert.equal(last?.kind === 'download-complete' && last.result.password, 'public-secret');
  assert.equal(last?.kind === 'download-complete' && last.result.success, true);
  assert.equal(site.llmRequests.length, 2);
  assert.equal(site.llmRequests[0].authorization, 'Bearer test-key');
  assert.equal(site.llmRequests[0].body.model, 'test-model');
  assert.equal(site.requests.some(request => request.path === '/blocked.zip'), false);
  assert.equal(messages.filter(message => message.kind === 'download-event' && message.event.type === 'password-assessment').length, 2);

  const disabled: WorkerResponse[] = [];
  config.llm.enabled = false;
  await executeJob({ kind: 'download', queue: [candidate], outputDirectory: directory, checkpoints: [], proxyUrl: '', llm: config }, new AbortController().signal, message => disabled.push(message));
  assert.equal(site.llmRequests.length, 2);
  const disabledLast = disabled.at(-1);
  assert.equal(disabledLast?.kind === 'download-complete' && disabledLast.result.success, false);

  config.llm.enabled = true;
  const continuing: WorkerResponse[] = [];
  await executeJob({
    kind: 'download', queue: [{ ...candidate, url: site.url + '/public' }], outputDirectory: directory,
    checkpoints: [], proxyUrl: '', llm: { ...config, passwordCheck: { enabled: true, failureMode: 'continue' } },
  }, new AbortController().signal, message => continuing.push(message));
  const continued = continuing.at(-1);
  assert.equal(continued?.kind === 'download-complete' && continued.result.success, true);
  assert.equal(continued?.kind === 'download-complete' && continued.result.password, undefined);
  const plan = continuing.find(message => message.kind === 'download-event' && message.event.type === 'plan');
  assert.match(plan?.kind === 'download-event' && plan.event.type === 'plan' ? plan.event.note ?? '' : '', /密码检查未完成/);
});
