import { GenericResolver } from '../../src/resolvers/GenericResolver.js';
import { startServer } from '../helpers/httpServer.js';

describe('Generic download plans', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let links: string[];

  beforeEach(async () => {
    links = [];
    server = await startServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { Location: '/pages/download/' });
        response.end();
        return;
      }
      if (request.url === '/page' || request.url === '/pages/download/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(links.map(link => `<a href="${link}">${link}</a>`).join('\n'));
      } else {
        response.setHeader('Content-Type', 'application/octet-stream');
        response.end('binary');
      }
    });
  });

  afterEach(async () => { await server.close(); });

  const resolve = (path = '/page') => new GenericResolver().resolve({
    platform: 'local', platformTags: [], name: 'game', score: 0, reasons: [], url: server.url + path,
  });

  it.each([
    ['game.7z.001', 'game.7z.002', 'game.7z.003'],
    ['game.zip.001', 'game.zip.002'],
    ['game.001', 'game.002'],
    ['game.part1.rar', 'game.part2.rar'],
    ['game.zip', 'game.z01', 'game.z02'],
    ['game.rar', 'game.r00', 'game.r01'],
  ])('puts every volume in one plan for %j', async (...names) => {
    links = names.map(name => '/files/' + name);
    const plans = await resolve();
    expect(plans).toHaveLength(1);
    expect(plans[0].files.map(f => f.filename).sort()).toEqual([...names].sort());
  });

  it('limits alternative plans without truncating a group of more than three volumes', async () => {
    links = ['game.7z.001', 'game.7z.002', 'game.7z.003', 'game.7z.004', 'game.rar', 'game.zip', 'game.iso'].map(name => '/files/' + name);
    const plans = await resolve();
    expect(plans).toHaveLength(3);
    expect(plans[0].files.map(f => f.filename)).toEqual(['game.7z.001', 'game.7z.002', 'game.7z.003', 'game.7z.004']);
    expect(plans.slice(1).every(plan => plan.files.length === 1)).toBe(true);
  });

  it.each([
    ['game.z01', 'game.z02'],
    ['game.r00', 'game.r01'],
    ['game.7z.001', 'game.7z.003'],
  ])('does not create successful alternatives from incomplete volumes %j', async (...names) => {
    links = names.map(name => '/files/' + name);
    expect(await resolve()).toEqual([]);
  });

  it('does not combine same-named volumes from different directories or mirrors', async () => {
    links = [
      'https://a.example/a/game.7z.001', 'https://a.example/b/game.7z.002',
      'https://b.example/a/game.7z.002',
    ];
    const plans = await resolve();
    expect(plans).toHaveLength(1);
    expect(plans[0].files.map(f => f.url)).toEqual([links[0]]);
  });

  it('groups filenames independently of signed URL query strings', async () => {
    links = ['/files/game.7z.001?token=a/b/1', '/files/game.7z.002?token=c/d/2'];
    const plans = await resolve();
    expect(plans).toHaveLength(1);
    expect(plans[0].files.map(f => f.url)).toEqual(links.map(link => server.url + link));
  });

  it('uses the final page location to resolve relative volume links', async () => {
    links = ['game.7z.001', 'game.7z.002'];
    const plans = await resolve('/redirect');
    expect(plans[0].files.map(f => f.url)).toEqual(links.map(link => `${server.url}/pages/download/${link}`));
  });

  it('preserves a separate magnet alternative', async () => {
    links = ['magnet:?xt=urn:btih:' + 'a'.repeat(40) + '&dn=game', '/files/game.zip'];
    const plans = await resolve();
    expect(plans).toHaveLength(2);
    expect(plans.flatMap(plan => plan.files.map(file => file.kind)).sort()).toEqual(['http', 'magnet']);
  });

  it('rejects an isolated direct volume when no complete group can be established', async () => {
    await expect(resolve('/game.7z.001')).rejects.toThrow('分卷');
  });
});
