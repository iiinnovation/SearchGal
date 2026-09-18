import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../../src/core/Harness.js';
import { DownloadEngine } from '../../src/core/DownloadEngine.js';
import { DEFAULT_CONFIG } from '../../src/utils/config.js';

jest.mock('../../src/utils/process.js', () => ({ commandExists: async () => false }));

describe('CLI password options reach the engine', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'searchgal-harness-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(async () => { jest.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

  it.each([undefined, false])('supports key-only setup and respects enabled=%s', async enabled => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.llm.apiKey = 'test-key';
    config.llm.enabled = enabled;
    const harness = await Harness.create(undefined, config);
    jest.spyOn(harness, 'search').mockResolvedValue({ outcome: { results: [], errors: [] }, candidates: [
      { name: 'game', url: 'https://example.test/page', platform: 'fixture', platformTags: [], score: 1, reasons: [] },
    ] });
    const download = jest.spyOn(DownloadEngine.prototype, 'downloadCandidate').mockResolvedValue({ success: false, paths: [], manualHints: [] });
    await harness.searchAndDownload('game', { outputDir: directory, interactive: false, maxAttempts: 1, checkPassword: true, strictPassword: true });
    const options = download.mock.calls[0][1];
    expect(options.enablePasswordCheck).toBe(true);
    expect(options.passwordCheckFailureMode).toBe('skip');
    expect(Boolean(options.assessor)).toBe(enabled !== false);
  });
});
