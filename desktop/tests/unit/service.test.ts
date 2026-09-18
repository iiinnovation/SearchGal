import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { DesktopService, type JobProcess, type WorkerFactory } from '../../src/main/service';
import { StateStore, defaultState, type SecretCodec } from '../../src/main/state';
import type { WorkerRequest, WorkerResponse } from '../../src/shared/contracts';

interface Job extends JobProcess {
  request: Exclude<WorkerRequest, { kind: 'abort' }>;
  send(message: WorkerResponse): void;
  exit(code: number): void;
  autoAbort: boolean;
  killed: boolean;
}

async function until(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition() && Date.now() < deadline) await delay(5);
  assert.ok(condition(), 'timed out waiting for service state');
}

async function setup(t: TestContext, secrets?: SecretCodec) {
  const directory = await mkdtemp(join(tmpdir(), 'searchgal-service-'));
  const jobs: Job[] = [];
  const createWorker: WorkerFactory = (request, send, exit) => {
    const job: Job = {
      request, send, exit, autoAbort: true, killed: false,
      postMessage(message) { if (message.kind === 'abort' && job.autoAbort) queueMicrotask(() => send({ kind: 'aborted' })); },
      kill() { job.killed = true; return true; },
    };
    jobs.push(job);
    return job;
  };
  const store = new StateStore(directory, defaultState(join(directory, '中文 下载')), secrets);
  const service = new DesktopService(store, createWorker, { version: 'test', platform: process.platform, packaged: false });
  await service.initialize();
  t.after(async () => {
    for (const job of jobs) job.autoAbort = true;
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  return { service, jobs, store };
}

async function search(service: DesktopService, jobs: Job[], title = '作品') {
  await service.search(title);
  jobs.at(-1)!.send({
    kind: 'search-complete', outcome: {
      results: [
        { name: '来源一', color: 'lime', tags: ['NoReq'], items: [{ name: title, url: 'https://example.test/one.zip' }] },
        { name: '来源二', color: 'lime', tags: ['NoReq'], items: [{ name: title, url: 'https://example.test/two.zip' }] },
      ], errors: [], total: 2,
    },
  });
}

function searchOutcome(title: string): WorkerResponse {
  return { kind: 'search-complete', outcome: { results: [
    { name: '来源', color: 'lime', tags: ['NoReq'], items: [{ name: title, url: 'https://example.test/game.zip' }] },
  ], errors: [], total: 1 } };
}

test('automatic search enqueues once after completion and keeps the submitted destination', async t => {
  const { service, jobs, store } = await setup(t);
  const directory = service.settings.downloadDirectory;
  await service.search('自动作品', true);
  const job = jobs.at(-1)!;
  job.send({ kind: 'search-event', event: { result: { name: '来源', color: 'lime', tags: [], items: [{ name: '自动作品', url: 'https://example.test/game.zip' }] } } });
  assert.equal(service.snapshot().tasks.length, 0);
  await service.updateSettings({ downloadDirectory: join(directory, '新位置') });
  job.send(searchOutcome('自动作品'));
  job.send(searchOutcome('自动作品'));
  await until(() => Boolean(service.snapshot().search.taskId));
  const task = service.snapshot().tasks[0];
  assert.equal(service.snapshot().tasks.length, 1);
  assert.equal(service.snapshot().search.taskId, task.id);
  assert.equal(task.title, '自动作品');
  assert.equal(task.status, 'resolving');
  assert.ok(task.outputDirectory.startsWith(join(directory, '自动作品 - ')));
  assert.equal((await store.load()).tasks[0].id, task.id);
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 1);
});

test('cancelled, superseded and failed automatic searches cannot start a late download', async t => {
  const { service, jobs } = await setup(t);
  await service.search('已取消作品', true);
  const cancelled = jobs.at(-1)!;
  service.stopSearch();
  cancelled.send(searchOutcome('已取消作品'));
  await service.search('旧作品', true);
  const old = jobs.at(-1)!;
  await service.search('新作品');
  old.send(searchOutcome('旧作品'));
  jobs.at(-1)!.send(searchOutcome('新作品'));
  await service.search('失败作品', true);
  const failed = jobs.at(-1)!;
  failed.send({ kind: 'error', error: '连接失败' });
  failed.send(searchOutcome('失败作品'));
  assert.equal(service.snapshot().search.status, 'failed');
  assert.equal(service.snapshot().tasks.length, 0);
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 0);
});

test('automatic search reports empty or unrelated results without downloading them', async t => {
  const { service, jobs } = await setup(t);
  for (const name of ['', '完全无关的名字']) {
    await service.search('千恋万花', true);
    jobs.at(-1)!.send(name ? searchOutcome(name) : { kind: 'search-complete', outcome: { results: [], errors: [], total: 0 } });
    assert.match(service.snapshot().search.error ?? '', /没有找到足够匹配/);
    assert.equal(service.snapshot().tasks.length, 0);
  }
});

for (const ending of ['timeout', 'error', 'exit'] as const) {
  test(`automatic download uses partial search results after ${ending} without another click`, async t => {
    const { service, jobs } = await setup(t);
    if (ending === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    await service.search('作品', true);
    const job = jobs.at(-1)!;
    job.send({ kind: 'search-event', event: { progress: { completed: 1, total: 2 }, result: {
      name: '可用来源', color: 'lime', tags: ['NoReq'], items: [{ name: '作品', url: 'https://example.test/game.zip' }],
    } } });
    if (ending === 'timeout') { t.mock.timers.tick(90_000); t.mock.timers.reset(); }
    else if (ending === 'error') job.send({ kind: 'error', error: 'stream disconnected' });
    else job.exit(1);
    await until(() => Boolean(service.snapshot().search.taskId));
    job.send(searchOutcome('作品'));
    job.exit(1);
    const snapshot = service.snapshot();
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.tasks[0].id, snapshot.search.taskId);
    assert.equal(snapshot.search.autoDownload, true);
    assert.equal(snapshot.search.completed, 1);
    assert.equal(service.task(snapshot.tasks[0].id).queue[0].platform, '可用来源');
    assert.equal(jobs.filter(job => job.request.kind === 'download').length, 1);
    assert.ok(job.killed);
  });
}

test('cancel and search-only failures never download partial results', async t => {
  const { service, jobs } = await setup(t);
  for (const automatic of [true, false]) {
    await service.search('作品', automatic);
    const job = jobs.at(-1)!;
    job.send({ kind: 'search-event', event: { result: {
      name: '来源', color: 'lime', tags: [], items: [{ name: '作品', url: 'https://example.test/game.zip' }],
    } } });
    if (automatic) service.stopSearch();
    job.send({ kind: 'error', error: 'disconnected' });
    job.exit(1);
    assert.equal(service.snapshot().tasks.length, 0);
  }
});

test('automatic search and manual auto-selection build the same ranked candidate queue', async t => {
  const { service, jobs } = await setup(t);
  await search(service, jobs);
  const manual = await service.download();
  const queue = service.task(manual).queue;
  await service.search('作品', true);
  jobs.at(-1)!.send({ kind: 'search-complete', outcome: {
    results: queue.map(candidate => ({ name: candidate.platform, color: 'lime', tags: candidate.platformTags,
      items: [{ name: candidate.name, url: candidate.url }] })), errors: [], total: queue.length,
  } });
  await until(() => Boolean(service.snapshot().search.taskId));
  assert.deepEqual(service.task(service.snapshot().search.taskId!).queue, queue);
});

test('manual selection takes over a pending automatic search without a duplicate task', async t => {
  const { service, jobs } = await setup(t);
  await service.search('作品', true);
  const job = jobs.at(-1)!;
  job.send({ kind: 'search-event', event: { result: { name: '来源', color: 'lime', tags: [], items: [{ name: '作品', url: 'https://example.test/game.zip' }] } } });
  await service.download(service.snapshot().search.candidates[0].id);
  job.send(searchOutcome('作品'));
  assert.equal(service.snapshot().tasks.length, 1);
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 1);
  assert.ok(job.killed);
});

test('tasks run one at a time and snapshots do not expose persisted download internals', async t => {
  const { service, jobs } = await setup(t);
  await search(service, jobs);
  const first = await service.download();
  const second = await service.download();
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 1);
  assert.equal(service.task(first).status, 'resolving');
  assert.equal(service.task(second).status, 'queued');
  assert.notEqual(service.task(first).outputDirectory, service.task(second).outputDirectory);
  assert.ok(!('queue' in service.snapshot().tasks[0]));
  assert.ok(!('checkpoints' in service.snapshot().tasks[0]));
  jobs.at(-1)!.send({ kind: 'download-complete', result: { success: true, paths: [], manualHints: [] } });
  await until(() => service.task(second).status === 'resolving');
  assert.equal(service.task(first).status, 'completed');
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 2);
});

test('resume preserves candidate position and ignores late events from the previous process', async t => {
  const { service, jobs } = await setup(t);
  await search(service, jobs);
  const id = await service.download();
  const old = jobs.at(-1)!;
  const candidate = service.task(id).queue[1];
  old.send({ kind: 'download-event', event: { type: 'candidate', candidate, index: 1, total: 2 } });
  await service.pause(id);
  await until(() => service.task(id).status === 'paused');
  await service.resume(id);
  const current = jobs.at(-1)!;
  assert.notEqual(current, old);
  assert.equal(current.request.kind, 'download');
  if (current.request.kind === 'download') assert.deepEqual(current.request.queue, [candidate]);
  old.send({ kind: 'error', error: 'late error' });
  old.send({ kind: 'download-complete', result: { success: false, paths: [], error: 'late failure', manualHints: [] } });
  old.exit(1);
  assert.equal(service.task(id).status, 'resolving');
  assert.equal(current.killed, false);
  current.send({ kind: 'download-event', event: { type: 'candidate', candidate, index: 0, total: 1 } });
  assert.equal(service.task(id).attemptIndex, 1);
});

test('shutdown preserves cancellation and a racing completion cannot announce success', async t => {
  const { service, jobs, store } = await setup(t);
  await search(service, jobs);
  const id = await service.download();
  const job = jobs.at(-1)!;
  job.autoAbort = false;
  let notices = 0;
  service.on('completed', () => notices++);
  await service.cancel(id);
  const shuttingDown = service.shutdown();
  assert.equal(service.task(id).status, 'cancelling');
  job.send({ kind: 'download-complete', result: { success: true, paths: [], manualHints: [] } });
  await shuttingDown;
  assert.equal(service.task(id).status, 'cancelled');
  assert.equal(notices, 0);
  assert.equal((await store.load()).tasks[0].status, 'cancelled');
});

test('an outstanding pause wins over a racing failure and retains downloaded file progress', async t => {
  const { service, jobs } = await setup(t);
  await search(service, jobs);
  const id = await service.download();
  const job = jobs.at(-1)!;
  job.autoAbort = false;
  const candidate = service.task(id).queue[0];
  const file = { kind: 'http' as const, filename: '作品.zip', url: candidate.url, size: 8192 };
  job.send({ kind: 'download-event', event: { type: 'plan', candidate, files: [file] } });
  job.send({ kind: 'download-event', event: { type: 'file-start', file, index: 0, total: 1 } });
  job.send({ kind: 'download-event', event: { type: 'file-progress', file, index: 0, progress: { receivedBytes: 2048, totalBytes: 8192, bytesPerSecond: 512, etaSeconds: 12 } } });
  await service.pause(id);
  job.send({ kind: 'download-complete', result: { success: false, paths: [], manualHints: [], error: 'socket closed' } });
  assert.equal(service.task(id).status, 'paused');
  assert.equal(service.task(id).files[0].receivedBytes, 2048);
  assert.equal(service.task(id).bytesPerSecond, 0);
  assert.equal(service.task(id).error, undefined);
});

test('a new search cannot be overwritten by the old search process', async t => {
  const { service, jobs } = await setup(t);
  await service.search('旧作品');
  const old = jobs.at(-1)!;
  await search(service, jobs, '新作品');
  old.send({ kind: 'search-event', event: { result: { name: '旧来源', color: 'lime', tags: [], items: [{ name: '旧作品', url: 'https://old.example.test/' }] } } });
  old.exit(1);
  assert.equal(service.snapshot().search.status, 'complete');
  assert.equal(service.snapshot().search.query, '新作品');
  assert.equal(service.snapshot().search.candidates.length, 2);
  assert.ok(old.killed);
});

test('queued cancellation starts no worker and explicit retry requeues that task', async t => {
  const { service, jobs } = await setup(t);
  await search(service, jobs);
  const first = await service.download();
  const second = await service.download();
  await service.cancel(second);
  assert.equal(service.task(second).status, 'cancelled');
  assert.equal(jobs.filter(job => job.request.kind === 'download').length, 1);
  await service.resume(second);
  assert.equal(service.task(second).status, 'queued');
  await service.pause(first);
  await until(() => service.task(second).status === 'resolving');
  assert.equal(service.task(first).status, 'paused');
});

test('LLM settings reach only download workers and passwords survive completion and restart', async t => {
  const codec = { encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString() };
  const { service, jobs, store } = await setup(t, codec);
  const llm = { ...service.settings.llm, enabled: true, model: 'fixture-model', failureMode: 'skip' as const };
  await service.updateLLMSettings(llm, 'dummy-private-key');
  assert.equal(service.snapshot().llmKeyConfigured, true);
  assert.ok(!JSON.stringify(service.snapshot()).includes('dummy-private-key'));
  await search(service, jobs);
  assert.ok(!JSON.stringify(jobs.at(-1)!.request).includes('dummy-private-key'));
  const id = await service.download();
  const job = jobs.at(-1)!;
  assert.equal(job.request.kind, 'download');
  if (job.request.kind !== 'download') throw new Error('expected download');
  assert.equal(job.request.llm?.llm.apiKey, 'dummy-private-key');
  assert.equal(job.request.llm?.passwordCheck.failureMode, 'skip');
  const candidate = job.request.queue[0];
  const assessment = { canExtractWithoutExtraPassword: true, hasPassword: true, extractedPassword: 'first-password', riskType: 'none' as const, reason: 'public' };
  job.send({ kind: 'download-event', event: { type: 'password-assessment', candidate, assessment } });
  job.send({ kind: 'download-event', event: { type: 'plan', candidate, files: [], password: 'first-password' } });
  assert.equal(service.snapshot().tasks[0].password, 'first-password');
  job.send({ kind: 'download-event', event: { type: 'candidate', candidate: job.request.queue[1], index: 1, total: 2 } });
  assert.equal(service.task(id).password, undefined);
  assert.equal(service.task(id).passwordAssessment, undefined);
  job.send({ kind: 'download-event', event: { type: 'plan', candidate, files: [], password: 'final-password' } });
  job.send({ kind: 'download-complete', result: { success: true, paths: [], manualHints: [], password: 'final-password' } });
  await store.flush();
  assert.equal((await store.load()).tasks[0].password, 'final-password');
  assert.equal(service.snapshot().tasks[0].password, 'final-password');
  await service.updateLLMSettings({ ...llm, model: 'changed' });
  assert.equal((await store.load()).llmApiKey, 'dummy-private-key');
  await service.updateLLMSettings(llm, '');
  assert.equal(service.snapshot().llmKeyConfigured, false);
});

test('a failed credential save restores previous settings and never exposes the key', async t => {
  const { service } = await setup(t);
  await assert.rejects(service.updateLLMSettings({ ...service.settings.llm, enabled: true }, 'secret'), /安全存储/);
  assert.equal(service.snapshot().llmKeyConfigured, false);
  assert.equal(service.settings.llm.enabled, false);
});
