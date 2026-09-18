import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { StateStore, defaultState, recoverTasks, validatedSettings } from '../../src/main/state';
import type { StoredTask, TaskStatus } from '../../src/shared/contracts';

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), 'searchgal-state-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function task(outputDirectory: string, status: TaskStatus): StoredTask {
  return {
    id: randomUUID(), title: '中文作品', status, outputDirectory,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    attemptIndex: 0, attemptCount: 1, fileIndex: 0, bytesPerSecond: 512, etaSeconds: 20,
    files: [{ name: '作品.zip', state: 'downloading', receivedBytes: 1024, totalBytes: 4096 }],
    queue: [{ name: '作品', url: 'https://example.test/game.zip', platform: 'fixture', platformTags: [], score: 1, reasons: [] }],
    checkpoints: [], manualHints: [],
  };
}

test('restart preserves file progress and pauses network work without restarting cancelled tasks', async t => {
  const path = await directory(t);
  const state = defaultState(join(path, '中文 下载'));
  const statuses: TaskStatus[] = ['queued', 'resolving', 'downloading', 'pausing', 'cancelling', 'completed', 'failed'];
  state.tasks = statuses.map(status => task(state.settings.downloadDirectory, status));
  const store = new StateStore(path, state);
  await store.save(state);
  const restored = await store.load();
  assert.deepEqual(restored.tasks.map(task => task.status), ['paused', 'paused', 'paused', 'paused', 'cancelled', 'completed', 'failed']);
  assert.equal(restored.tasks[2].files[0].receivedBytes, 1024);
  assert.equal(restored.tasks[2].bytesPerSecond, 0);
  assert.equal(restored.tasks[2].etaSeconds, undefined);
  assert.deepEqual(restored.tasks[2].queue, state.tasks[2].queue);
  assert.equal(state.tasks[2].status, 'downloading');
});

test('overlapping saves commit whole snapshots in order', async t => {
  const path = await directory(t);
  const state = defaultState(path);
  const store = new StateStore(path, state);
  await store.load();
  const writes: Promise<void>[] = [];
  for (let i = 0; i < 25; i++) {
    state.settings.nickname = `伙伴 ${i}`;
    writes.push(store.save(state));
  }
  await Promise.all(writes);
  await store.flush();
  assert.equal(JSON.parse(await readFile(join(path, 'state.json'), 'utf8')).settings.nickname, '伙伴 24');
  assert.deepEqual(await readdir(path), ['state.json']);
});

test('corrupt state is backed up byte-for-byte and defaults can be saved again', async t => {
  const path = await directory(t);
  const broken = '{"tasks": [unfinished';
  await writeFile(join(path, 'state.json'), broken);
  const defaults = defaultState(path);
  const store = new StateStore(path, defaults);
  const restored = await store.load();
  assert.deepEqual(restored, defaults);
  assert.match(store.notice ?? '', /已保留备份/);
  const backup = (await readdir(path)).find(name => name.startsWith('state.unreadable-'))!;
  assert.equal(await readFile(join(path, backup), 'utf8'), broken);
  await store.save(restored);
  assert.equal(JSON.parse(await readFile(join(path, 'state.json'), 'utf8')).version, 1);
});

test('invalid persisted task data cannot be resumed as an executable or relative path', async t => {
  const path = await directory(t);
  const defaults = defaultState(path);
  const invalid = task(path, 'downloading');
  invalid.queue[0].url = 'javascript:alert(1)';
  await writeFile(join(path, 'state.json'), JSON.stringify({ ...defaults, tasks: [invalid] }));
  const store = new StateStore(path, defaults);
  assert.deepEqual((await store.load()).tasks, []);
  assert.ok(store.notice);
});

test('settings reject unusable paths, protocols and dimensions without mutating current settings', () => {
  const current = defaultState(tmpdir()).settings;
  assert.throws(() => validatedSettings({ downloadDirectory: '../downloads' }, current));
  assert.throws(() => validatedSettings({ apiUrl: 'file:///secret' }, current));
  assert.throws(() => validatedSettings({ proxyUrl: 'socks5://localhost:1080' }, current));
  assert.throws(() => validatedSettings({ petSize: NaN }, current));
  assert.throws(() => validatedSettings({ petPosition: { x: Infinity, y: 0 } }, current));
  assert.throws(() => validatedSettings({ nickname: '   ' }, current));
  assert.equal(validatedSettings({ apiUrl: ' https://search.example.test/ ', nickname: ' 星星 ' }, current).apiUrl, 'https://search.example.test');
  assert.equal(current.apiUrl, '');
  assert.deepEqual(recoverTasks([]), []);
});

test('legacy PNG companions and animated companions survive a restart together', async t => {
  const path = await directory(t);
  const state = defaultState(path);
  const stillId = randomUUID();
  const animatedId = randomUUID();
  state.characters = [
    { id: stillId, name: '旧立绘', image: `${stillId}.png`, width: 369, height: 544, createdAt: new Date().toISOString() },
    { id: animatedId, name: '动画', image: `${animatedId}.webp`, preview: `${animatedId}.preview.png`, frameCount: 24, width: 512, height: 720, createdAt: new Date().toISOString() },
  ];
  state.settings.characterId = animatedId;
  const store = new StateStore(path, defaultState(path));
  await store.save(state);
  const restored = await store.load();
  assert.deepEqual(restored.characters, state.characters);
  assert.equal(restored.settings.characterId, animatedId);
  assert.equal(store.notice, undefined);
});

test('a persisted animation preview cannot reference files outside its character directory', async t => {
  const path = await directory(t);
  const state = defaultState(path);
  const id = randomUUID();
  state.characters = [{ id, name: '动画', image: `${id}.gif`, preview: '../../private.png', frameCount: 2, width: 64, height: 64, createdAt: new Date().toISOString() }];
  const store = new StateStore(path, defaultState(path));
  await store.save(state);
  assert.deepEqual((await store.load()).characters, []);
  assert.match(store.notice ?? '', /已保留备份/);
});

test('LLM secrets are encrypted on disk and legacy settings receive disabled defaults', async t => {
  const path = await directory(t);
  const defaults = defaultState(path);
  const legacy = structuredClone(defaults) as any;
  delete legacy.settings.llm;
  await writeFile(join(path, 'state.json'), JSON.stringify(legacy));
  const codec = { encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString() };
  const store = new StateStore(path, defaults, codec);
  const state = await store.load();
  assert.equal(state.settings.llm.enabled, false);
  state.llmApiKey = 'dummy-secret-for-storage';
  state.settings.llm.enabled = true;
  state.tasks = [{ ...task(path, 'completed'), password: 'archive-secret', passwordNote: 'public password' }];
  await store.save(state);
  const raw = await readFile(join(path, 'state.json'), 'utf8');
  assert.ok(!raw.includes(state.llmApiKey));
  assert.equal(JSON.parse(raw).llmApiKey, undefined);
  const restored = await new StateStore(path, defaults, codec).load();
  assert.equal(restored.llmApiKey, state.llmApiKey);
  assert.equal(restored.tasks[0].password, 'archive-secret');
  const locked = await new StateStore(path, defaults, { ...codec, decrypt() { throw new Error('locked'); } }).load();
  assert.equal(locked.llmApiKey, undefined);
  assert.equal(locked.tasks[0].password, 'archive-secret');
  state.llmApiKey = undefined;
  await store.save(state);
  assert.equal(JSON.parse(await readFile(join(path, 'state.json'), 'utf8')).llmApiKeyEncrypted, undefined);
});

test('saving a key without secure storage fails instead of writing plaintext', async t => {
  const path = await directory(t);
  const state = defaultState(path);
  state.llmApiKey = 'secret';
  await assert.rejects(new StateStore(path, defaultState(path)).save(state), /安全存储/);
});

test('LLM settings reject invalid endpoints, timeouts and policies', () => {
  const settings = defaultState(tmpdir()).settings;
  for (const change of [
    { baseURL: 'file:///tmp/private' }, { baseURL: 'https://user:secret@example.com/v1' },
    { baseURL: 'https://example.com/v1?key=secret' }, { timeoutMs: Infinity },
    { timeoutMs: 0 }, { timeoutMs: 120001 }, { model: ' ' }, { failureMode: 'invalid' }, { enabled: 'true' },
  ]) assert.throws(() => validatedSettings({ llm: { ...settings.llm, ...change } as any }, settings));
  assert.equal(validatedSettings({ llm: { ...settings.llm, baseURL: 'http://localhost:1234/v1/' } }, settings).llm.baseURL, 'http://localhost:1234/v1');
  assert.equal(settings.llm.enabled, false);
});
