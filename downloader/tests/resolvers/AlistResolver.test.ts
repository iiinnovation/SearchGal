import { AlistResolver, pickArchiveSet } from '../../src/resolvers/AlistResolver.js';
import { startServer } from '../helpers/httpServer.js';

function file(name: string, size = 100, directory = '/games') {
  return { path: `${directory}/${name}`, entry: { name, size, is_dir: false } };
}

const names = (files: ReturnType<typeof file>[]) => files.map(f => f.entry.name).sort();

describe('Alist archive selection', () => {
  it.each([
    ['game.zip', 'game.z01', 'game.z02'],
    ['game.rar', 'game.r00', 'game.r01'],
    ['GAME.ZIP', 'game.z01'],
    ['GAME.RAR', 'game.r00'],
    ['game.part1.rar', 'game.part2.rar', 'game.part3.rar'],
    ['game.7z.001', 'game.7z.002'],
    ['game.zip.001', 'game.zip.002'],
    ['game.001', 'game.002'],
  ])('includes every volume in %j', (...archiveNames) => {
    const chosen = pickArchiveSet(archiveNames.map(name => file(name)));
    expect(names(chosen)).toEqual([...archiveNames].sort());
  });

  it.each([
    ['game.z01', 'game.z02'],
    ['game.r00', 'game.r01'],
    ['game.zip', 'game.z02'],
    ['game.rar', 'game.r01'],
    ['game.zip', 'game.z01', 'game.z03'],
    ['game.part2.rar', 'game.part3.rar'],
    ['game.7z.001', 'game.7z.003'],
  ])('rejects missing primary volumes or gaps in %j', (...archiveNames) => {
    expect(pickArchiveSet(archiveNames.map(name => file(name)))).toEqual([]);
  });

  it('does not combine identically named archives of different formats', () => {
    const chosen = pickArchiveSet([
      file('game.zip', 1), file('game.z01', 20), file('game.z02', 20),
      file('game.rar', 2), file('game.r00', 30), file('game.r01', 30),
      file('game.part1.rar', 10), file('game.part2.rar', 10),
    ]);
    expect(names(chosen)).toEqual(['game.r00', 'game.r01', 'game.rar']);
  });

  it('requires the primary volume in the same directory', () => {
    const chosen = pickArchiveSet([
      file('game.z01', 100, '/a'), file('game.z02', 100, '/a'),
      file('game.zip', 1, '/b'), file('game.z01', 10, '/b'),
    ]);
    expect(chosen.map(f => f.path).sort()).toEqual(['/b/game.z01', '/b/game.zip']);
  });

  it('falls back to an independent archive when another set is incomplete', () => {
    expect(names(pickArchiveSet([
      file('broken.rar', 1000), file('broken.r01', 1000), file('complete.7z', 10),
    ]))).toEqual(['complete.7z']);
  });

  it('does not report a README as the archive when the required volumes are missing', () => {
    expect(pickArchiveSet([file('game.z01'), file('game.z02'), file('README.txt', 1)])).toEqual([]);
  });
});

describe('Alist resolution and pagination', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let entries: ReturnType<typeof file>['entry'][];
  let pages: number[];
  let mode: 'normal' | 'empty' | 'repeat' | 'changed' | 'error' | 'missing' | 'limit';

  beforeEach(async () => {
    entries = ['game.7z.001', 'game.7z.002', 'game.7z.003'].map(name => file(name).entry);
    pages = [];
    mode = 'normal';
    server = await startServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body) as { path: string; page?: number; per_page?: number };
      const withUrl = (entry: typeof entries[number]) => ({ ...entry, raw_url: `${server.url}/files/${encodeURIComponent(entry.name)}` });
      let data: unknown;
      let code = 200;
      if (request.url === '/api/fs/get') {
        const entry = entries.find(entry => input.path.endsWith('/' + entry.name));
        data = entry ? withUrl(entry) : { name: 'games', size: 0, is_dir: true };
      } else {
        const page = input.page!;
        pages.push(page);
        const listed = mode === 'missing' ? entries.slice(1) : entries;
        const start = (page - 1) * input.per_page!;
        let content = listed.slice(start, start + input.per_page!).map(withUrl);
        if (page > 1 && mode === 'empty') content = [];
        if (page > 1 && mode === 'repeat') content = listed.slice(0, input.per_page!).map(withUrl);
        if (page > 1 && mode === 'error') code = 500;
        data = {
          content,
          total: mode === 'limit' ? 10_001 : listed.length + (page > 1 && mode === 'changed' ? 1 : 0),
        };
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ code, message: code === 200 ? 'success' : 'failure', data }));
    });
  });

  afterEach(async () => { await server.close(); });

  const candidate = (path: string) => ({
    platform: 'local', platformTags: [], name: 'game', score: 0, reasons: [], url: server.url + path,
  });
  const resolve = (path = '/games') => new AlistResolver().resolve(candidate(path));
  const paginate = () => {
    entries = [...Array.from({ length: 198 }, (_, i) => file(`${i}.txt`).entry), ...entries];
  };

  it.each(['game.7z.001', 'game.7z.002'])('collects every sibling when the candidate points to %s', async name => {
    const plans = await resolve('/games/' + name);
    expect(plans).toHaveLength(1);
    expect(plans[0].files.map(f => f.filename)).toEqual(['game.7z.001', 'game.7z.002', 'game.7z.003']);
    expect(pages).toEqual([1]);
  });

  it.each([
    ['game.zip', 'game.z01', 'game.z02'],
    ['game.rar', 'game.r00', 'game.r01'],
  ])('finds old-style volumes when the candidate is %s', async (...names) => {
    entries = names.map(name => file(name).entry);
    const plans = await resolve('/games/' + names[0]);
    expect(plans[0].files.map(f => f.filename).sort()).toEqual([...names].sort());
  });

  it('does not replace a selected archive with a larger unrelated group', async () => {
    entries.push(file('other.part1.rar', 10000).entry, file('other.part2.rar', 10000).entry);
    const plans = await resolve('/games/game.7z.002');
    expect(plans[0].files.map(f => f.filename)).toEqual(['game.7z.001', 'game.7z.002', 'game.7z.003']);
  });

  it('rejects a selected incomplete group even if another complete archive exists', async () => {
    entries = [file('game.7z.002').entry, file('other.zip').entry];
    expect(await resolve('/games/game.7z.002')).toEqual([]);
  });

  it('keeps a standalone RAR downloadable after checking its directory', async () => {
    entries = [file('game.rar').entry];
    expect((await resolve('/games/game.rar'))[0].files.map(f => f.filename)).toEqual(['game.rar']);
  });

  it('reads a second page before selecting a directory archive', async () => {
    paginate();
    const plans = await resolve();
    expect(pages).toEqual([1, 2]);
    expect(plans[0].files.map(f => f.filename)).toEqual(['game.7z.001', 'game.7z.002', 'game.7z.003']);
  });

  it('also reads all pages when looking up the siblings of one volume', async () => {
    paginate();
    const plans = await resolve('/games/game.7z.001');
    expect(pages).toEqual([1, 2]);
    expect(plans[0].files).toHaveLength(3);
  });

  it.each(['empty', 'repeat', 'changed', 'error'] as const)('rejects %s pagination instead of publishing a partial group', async failure => {
    paginate();
    mode = failure;
    await expect(resolve()).rejects.toThrow(/目录|分页/);
    expect(pages).toEqual([1, 2]);
  });

  it('rejects a listing that no longer contains the selected file', async () => {
    mode = 'missing';
    await expect(resolve('/games/game.7z.001')).rejects.toThrow('找不到候选文件');
  });

  it('fails explicitly when the directory exceeds the supported bound', async () => {
    mode = 'limit';
    await expect(resolve()).rejects.toThrow('超过 10000');
    expect(pages).toEqual([1]);
  });

  it('accepts an empty directory without downloading anything', async () => {
    entries = [];
    expect(await resolve()).toEqual([]);
  });
});
