/** Build first. Requires 7zz/7z and zip. Add --aria2 to exercise a real aria2c.
 * Optional env: ARIA2_BIN, DYLD_LIBRARY_PATH, SEVEN_ZIP. All HTTP traffic is local.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { AlistResolver } from '../../dist/resolvers/AlistResolver.js';
import { GenericResolver } from '../../dist/resolvers/GenericResolver.js';
import { DirectDownloader } from '../../dist/tools/DirectDownloader.js';

const withAria2 = process.argv.includes('--aria2');
const keep = process.argv.includes('--keep');
const reportArg = process.argv.indexOf('--report');
const reportPath = reportArg === -1 ? undefined : process.argv[reportArg + 1];
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'searchgal-roundtrip-'));
const fixture = join(root, 'fixtures');
await mkdir(fixture);
const sevenZip = process.env.SEVEN_ZIP || (spawnSync('7zz', ['i'], { stdio: 'ignore' }).status === 0 ? '7zz' : '7z');
const original = randomBytes(160000);
await writeFile(join(fixture, 'payload.bin'), original);
for (const [command, args] of [
  [sevenZip, ['a', '-t7z', '-mx=0', '-v64k', 'game.7z', 'payload.bin']],
  ['zip', ['-q', '-0', '-s', '64k', 'game.zip', 'payload.bin']],
]) {
  const packed = spawnSync(command, args, { cwd: fixture, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
}
const fixtureNames = (await readdir(fixture)).filter(name => name !== 'payload.bin').sort();
const families = {
  sevenZip: fixtureNames.filter(name => name.startsWith('game.7z.')),
  zip: fixtureNames.filter(name => /\.zip$|\.z\d+$/.test(name)),
};
assert.equal(families.sevenZip.length, 3);
assert.equal(families.zip.length, 3);
const volumes = new Map(await Promise.all(fixtureNames.map(async name => [name, await readFile(join(fixture, name))])));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const large = { a: randomBytes(8 * 1024 * 1024), b: randomBytes(8 * 1024 * 1024) };
const requests = [];
const children = new Set();
const results = { scope: 'local HTTP + production resolvers/downloaders/CLI + generated archives', root, cases: {} };
let family = families.sevenZip;
let pagination = false;
let slow = false;
let base;
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = request.url.startsWith('/api/') ? JSON.parse(body) : undefined;
  const record = { method: request.method, url: request.url, range: request.headers.range, ifMatch: request.headers['if-match'], encoding: request.headers['accept-encoding'], input, bytes: 0 };
  requests.push(record);
  const send = (content, headers = {}, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(Buffer.byteLength(content)), ...headers });
    response.end(request.method === 'HEAD' ? undefined : content);
  };
  const json = data => send(JSON.stringify({ code: 200, message: 'success', data }), { 'Content-Type': 'application/json' });
  const entry = name => ({ name, is_dir: false, size: volumes.get(name).length, raw_url: base + '/blob/' + name });
  if (request.url.endsWith('/gal')) {
    const source = request.url.includes('/source-a/') ? '/large-a.bin' : request.url.includes('/source-b/') ? '/large-b.bin' : '/page';
    const items = source === '/page' ? [{ name: 'game unavailable', url: base + '/unavailable.zip' }, { name: 'game', url: base + source }] : [{ name: 'game', url: base + source }];
    send([
      { total: 1 }, { result: { name: 'local fixture', color: 'blue', tags: ['NoReq'], items } },
      { progress: { completed: 1, total: 1 } }, { done: true },
    ].map(event => JSON.stringify(event)).join('\n') + '\n', { 'Content-Type': 'text/event-stream' });
  } else if (request.url === '/api/fs/get') {
    const name = input.path.split('/').at(-1);
    json(volumes.has(name) ? entry(name) : { name: 'games', is_dir: true, size: 0 });
  } else if (request.url === '/api/fs/list') {
    const content = [...(pagination ? Array.from({ length: 198 }, (_, i) => ({ name: `${i}.txt`, is_dir: false, size: 1 })) : []), ...family.map(entry)];
    const start = (input.page - 1) * input.per_page;
    json({ total: content.length, content: content.slice(start, start + input.per_page) });
  } else if (request.url.startsWith('/blob/')) {
    const name = request.url.slice('/blob/'.length);
    send(volumes.get(name), { ETag: `"${sha256(volumes.get(name))}"` });
  } else if (request.url === '/page') {
    send(families.sevenZip.map(name => `<a href="${base}/blob/${name}">${name}</a>`).join('\n'), { 'Content-Type': 'text/html' });
  } else if (request.url === '/encoded.bin') {
    const gzip = request.headers['accept-encoding']?.includes('gzip');
    send(gzip ? gzipSync('1234567890') : '1234567890', gzip ? { 'Content-Encoding': 'gzip' } : {});
  } else if (request.url === '/version-b.bin') {
    send('1234567890', { ETag: '"v2"' });
  } else if (request.url === '/short.bin') {
    send(request.method === 'HEAD' ? '1234567890' : '12345678', { ETag: '"short-v1"' });
  } else if (/^\/large-[ab]\.bin$/.test(request.url)) {
    const bytes = large[request.url.includes('-a.') ? 'a' : 'b'];
    if (request.headers['if-match'] && request.headers['if-match'] !== '"shared"') {
      send('', {}, 412);
      return;
    }
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(end - start + 1),
      'Content-Disposition': 'attachment; filename="game.bin"', ETag: '"shared"',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
    });
    if (request.method === 'HEAD') { response.end(); return; }
    let offset = start;
    let timer;
    const tick = () => {
      if (response.destroyed) return;
      const next = Math.min(offset + 65536, end + 1);
      response.write(bytes.subarray(offset, next));
      record.bytes += next - offset;
      offset = next;
      if (offset === end + 1) response.end();
      else timer = setTimeout(tick, slow ? start === 0 ? 15 : 100 : 1);
    };
    response.on('close', () => clearTimeout(timer));
    tick();
  } else send('', {}, 404);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
base = 'http://127.0.0.1:' + server.address().port;

const candidate = path => ({ platform: 'local', platformTags: [], name: 'game', url: base + path, score: 0, reasons: [] });
async function checkArchive(directory, primary) {
  const archive = join(directory, primary);
  const test = spawnSync(sevenZip, ['t', archive], { encoding: 'utf8' });
  assert.equal(test.status, 0, test.stdout + test.stderr);
  const extracted = join(directory, 'extracted');
  const extract = spawnSync(sevenZip, ['x', '-y', '-o' + extracted, archive], { encoding: 'utf8' });
  assert.equal(extract.status, 0, extract.stdout + extract.stderr);
  assert.deepEqual(await readFile(join(extracted, 'payload.bin')), original);
  return { archiveTestExit: test.status, extractExit: extract.status, extractedSha256: sha256(original) };
}
async function savePlan(plan, label, aria2c) {
  const directory = join(root, label);
  await mkdir(directory);
  for (const file of plan.files) {
    const result = await new DirectDownloader({ aria2c }).download(file, { outputDir: directory });
    assert.equal(result.success, true, result.error);
    assert.deepEqual(await readFile(result.filepath), volumes.get(file.filename));
  }
  assert.equal((await readdir(directory)).filter(name => /\.part|\.aria2|\.json$/.test(name)).length, 0);
  const primary = plan.files.some(f => f.filename === 'game.zip') ? 'game.zip' : 'game.7z.001';
  results.cases[label] = { files: plan.files.map(f => f.filename), ...await checkArchive(directory, primary) };
}
const childEnv = { ...process.env };
for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
  delete process.env[key];
  delete childEnv[key];
}
let pidFile;
if (withAria2) {
  const binary = process.env.ARIA2_BIN || 'aria2c';
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', env: childEnv });
  assert.equal(version.status, 0, version.stderr);
  results.aria2Version = version.stdout.split('\n')[0];
  const wrapperDirectory = join(root, 'bin');
  await mkdir(wrapperDirectory);
  pidFile = join(root, 'aria2.pid');
  await writeFile(join(wrapperDirectory, 'aria2c'), `#!/usr/bin/env node
const {spawn} = require('node:child_process');
const {writeFileSync} = require('node:fs');
// macOS removes DYLD_* when /usr/bin/env starts; restore the explicitly supplied test library path.
const env = {...process.env, ...${JSON.stringify(childEnv.DYLD_LIBRARY_PATH ? { DYLD_LIBRARY_PATH: childEnv.DYLD_LIBRARY_PATH } : {})}};
const child = spawn(${JSON.stringify(binary)}, process.argv.slice(2), {stdio:'inherit', env});
child.on('spawn', () => writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)));
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
`, { mode: 0o755 });
  // If the binary was found via PATH, preserve that absolute lookup before adding the wrapper.
  if (binary === 'aria2c') {
    const found = (childEnv.PATH ?? '').split(delimiter).map(directory => join(directory, 'aria2c')).find(path => existsSync(path));
    assert.ok(found, 'aria2c not found in PATH');
    const wrapper = await readFile(join(wrapperDirectory, 'aria2c'), 'utf8');
    await writeFile(join(wrapperDirectory, 'aria2c'), wrapper.replace(JSON.stringify(binary), JSON.stringify(found)));
  }
  process.env.PATH = childEnv.PATH = wrapperDirectory + delimiter + process.env.PATH;
}

function startCli(apiPath, directory, label) {
  const child = spawn(process.execPath, [cli, '--api', base + apiPath, 'download', 'game', '--dir', directory, '--max-attempts', '2'], { env: childEnv });
  children.add(child);
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 60000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', async code => {
      clearTimeout(watchdog);
      children.delete(child);
      await writeFile(join(root, label + '.log'), log);
      resolve({ code, log });
    });
  });
  return { child, done };
}
async function until(condition) {
  const deadline = Date.now() + 15000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for an active partial download');
    await delay(25);
  }
}
async function interruptPartial(directory, label) {
  slow = true;
  const start = requests.length;
  const run = startCli('/source-a', directory, label);
  await until(() => requests.slice(start).some(r => r.url === '/large-a.bin' && r.method === 'GET' && !r.range && r.bytes >= 1024 * 1024));
  process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGINT');
  const result = await run.done;
  assert.equal(result.code, 2, result.log);
  assert.ok(existsSync(join(directory, 'game.bin.aria2.part.aria2')), 'aria2 must save control state');
  assert.ok(existsSync(join(directory, 'game.bin.aria2.part.json')), 'source identity must be retained');
  assert.equal(existsSync(join(directory, 'game.bin')), false, 'an interrupted file must not be published');
  slow = false;
}

try {
  const resolver = new AlistResolver();
  for (const aria2c of withAria2 ? [false, true] : [false]) {
    const engine = aria2c ? 'aria2' : 'node';
    family = families.sevenZip;
    pagination = false;
    const direct = (await resolver.resolve(candidate('/games/game.7z.001')))[0];
    assert.equal(direct.files.length, 3);
    await savePlan(direct, engine + '-alist-volume', aria2c);
    pagination = true;
    const start = requests.length;
    const paged = (await resolver.resolve(candidate('/games')))[0];
    assert.equal(paged.files.length, 3);
    assert.deepEqual(requests.slice(start).filter(r => r.input?.page).map(r => r.input.page), [1, 2]);
    await savePlan(paged, engine + '-alist-pagination', aria2c);
    pagination = false;
    const generic = await new GenericResolver().resolve(candidate('/page'));
    assert.equal(generic.length, 1);
    assert.equal(generic[0].files.length, 3);
    await savePlan(generic[0], engine + '-generic-page', aria2c);
    family = families.zip;
    const splitZip = (await resolver.resolve(candidate('/games/game.zip')))[0];
    assert.equal(splitZip.files.length, 3);
    await savePlan(splitZip, engine + '-zip-primary', aria2c);
  }
  const encodedDir = join(root, 'encoding');
  await mkdir(encodedDir);
  const encoded = await new DirectDownloader({ aria2c: false }).download({ kind: 'http', url: base + '/encoded.bin', filename: 'game.bin' }, { outputDir: encodedDir });
  assert.equal(encoded.success, true, encoded.error);
  assert.equal(await readFile(encoded.filepath, 'utf8'), '1234567890');
  results.cases.encoding = { success: true, bytes: 10 };

  if (withAria2) {
    const directory = join(root, 'aria2-existing');
    await mkdir(directory);
    await writeFile(join(directory, 'game.bin'), 'ABCDEFGHIJ');
    const replaced = await new DirectDownloader({ aria2c: true }).download({ kind: 'http', url: base + '/version-b.bin', filename: 'game.bin', size: 10 }, { outputDir: directory });
    assert.equal(replaced.success, true, replaced.error);
    assert.equal(await readFile(replaced.filepath, 'utf8'), '1234567890');
    const rejected = await new DirectDownloader({ aria2c: true }).download({ kind: 'http', url: base + '/short.bin', filename: 'game.bin', size: 10 }, { outputDir: directory });
    assert.equal(rejected.success, false);
    assert.equal(await readFile(replaced.filepath, 'utf8'), '1234567890');
    results.cases.aria2Integrity = { oldFileReplaced: true, shortDownloadRejected: true, previousFilePreserved: true };

    const resumeDir = join(root, 'resume');
    await interruptPartial(resumeDir, 'resume-interrupted');
    const start = requests.length;
    const resumed = await startCli('/source-a', resumeDir, 'resume-completed').done;
    assert.equal(resumed.code, 0, resumed.log);
    assert.deepEqual(await readFile(join(resumeDir, 'game.bin')), large.a);
    const ranges = requests.slice(start).filter(r => r.url === '/large-a.bin' && r.range).map(r => r.range);
    assert.ok(ranges.some(range => Number(range.match(/bytes=(\d+)/)[1]) > 0), 'resume must issue ranges');
    results.cases.aria2Resume = { success: true, bytes: large.a.length, ranges, sha256: sha256(large.a) };

    const switchDir = join(root, 'switch-source');
    await interruptPartial(switchDir, 'source-a-interrupted');
    const switched = await startCli('/source-b', switchDir, 'source-b-completed').done;
    assert.equal(switched.code, 0, switched.log);
    assert.deepEqual(await readFile(join(switchDir, 'game.bin')), large.b);
    results.cases.aria2SourceSwitch = { success: true, sameNameSizeAndEtag: true, sha256: sha256(large.b) };
  }
  const cliDirectory = join(root, 'cli-fallback');
  const fallback = await startCli('/fallback', cliDirectory, 'cli-fallback').done;
  assert.equal(fallback.code, 0, fallback.log);
  assert.match(fallback.log, /\[2\/2\]/);
  results.cases.cliFallback = { exitCode: fallback.code, engine: fallback.log.includes('aria2c 下载中') ? 'aria2' : 'node', failedCandidateThenSucceeded: true, ...await checkArchive(cliDirectory, 'game.7z.001') };
  results.requests = requests;
  results.result = 'passed';
  if (reportPath) await writeFile(reportPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ...results, requests: undefined }, null, 2));
} finally {
  for (const child of children) child.kill('SIGTERM');
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (!keep) await rm(root, { recursive: true, force: true });
}
