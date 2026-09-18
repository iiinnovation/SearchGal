import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/utils/config.js';

jest.mock('node:os', () => ({ ...jest.requireActual('node:os'), homedir: jest.fn() }));

describe('LLM configuration precedence', () => {
  let directory: string;
  const cwd = process.cwd();
  const environment = { ...process.env };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'searchgal-config-'));
    process.chdir(directory);
    (homedir as jest.Mock).mockReturnValue(join(directory, 'home'));
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('SEARCHGAL_LLM_') || name.startsWith('SEARCHGAL_PASSWORD_CHECK_')) delete process.env[name];
    }
  });
  afterEach(() => {
    process.chdir(cwd);
    process.env = { ...environment };
    rmSync(directory, { recursive: true, force: true });
  });

  it('merges local policy, user key, explicit file and environment by field', () => {
    mkdirSync(join(directory, 'downloader'));
    mkdirSync(join(homedir(), '.searchgal'), { recursive: true });
    writeFileSync(join(directory, 'downloader', '.config.json'), JSON.stringify({
      llm: { model: 'local-model', baseURL: 'http://localhost:1234/v1/' },
      passwordCheck: { enabled: true, failureMode: 'skip' },
    }));
    writeFileSync(join(homedir(), '.searchgal', 'config.json'), JSON.stringify({ llm: { apiKey: 'user-key' } }));
    const customPath = join(directory, 'custom.json');
    writeFileSync(customPath, JSON.stringify({ llm: { model: 'custom-model' } }));
    process.env.SEARCHGAL_LLM_MODEL = 'environment-model';
    const config = loadConfig(customPath);
    expect(config.llm).toMatchObject({ apiKey: 'user-key', model: 'environment-model', baseURL: 'http://localhost:1234/v1' });
    expect(config.passwordCheck).toEqual({ enabled: true, failureMode: 'skip' });
  });

  it.each(['file', 'environment'])('honors explicit disable from %s with checking enabled', source => {
    process.env.SEARCHGAL_LLM_API_KEY = 'test-key';
    process.env.SEARCHGAL_PASSWORD_CHECK_ENABLED = 'true';
    if (source === 'file') writeFileSync('.config.json', JSON.stringify({ llm: { enabled: false } }));
    else process.env.SEARCHGAL_LLM_ENABLED = 'false';
    expect(loadConfig().llm.enabled).toBe(false);
  });

  it('keeps unspecified enablement distinct from explicit disable', () => {
    process.env.SEARCHGAL_LLM_API_KEY = 'test-key';
    expect(loadConfig().llm.enabled).toBeUndefined();
    expect(loadConfig().passwordCheck.enabled).toBe(false);
  });
});
