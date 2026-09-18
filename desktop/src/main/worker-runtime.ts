import { handleSearchRequestStream, PLATFORMS_GAL } from '../../../src/core';
import { DownloadEngine } from '../../../downloader/src/core/DownloadEngine';
import { SearchClient } from '../../../downloader/src/core/SearchClient';
import { configureProxyFromEnv } from '../../../downloader/src/utils/proxy';
import { LLMService } from '../../../downloader/src/services/LLMService';
import type { SearchOutcome } from '../../../downloader/src/types';
import type { WorkerRequest, WorkerResponse, SearchEvent } from '../shared/contracts';

export async function executeJob(
  job: Exclude<WorkerRequest, { kind: 'abort' }>, signal: AbortSignal, send: (message: WorkerResponse) => void,
): Promise<void> {
  if (job.proxyUrl) {
    for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']) process.env[key] = job.proxyUrl;
  }
  configureProxyFromEnv();
  try {
    if (job.kind === 'download') {
      const engine = new DownloadEngine({ aria2c: false });
      const result = await engine.run(job.queue, {
        outputDir: job.outputDirectory, signal, quiet: true, checkpoints: job.checkpoints,
        enablePasswordCheck: job.llm?.passwordCheck.enabled ?? false,
        passwordCheckFailureMode: job.llm?.passwordCheck.failureMode,
        assessor: job.llm && job.llm.llm.enabled !== false && job.llm.llm.apiKey ? new LLMService(job.llm.llm) : undefined,
        onEvent: event => send({ kind: 'download-event', event }),
      });
      send({ kind: 'download-complete', result });
    } else if (job.apiUrl) {
      const outcome = await new SearchClient(job.apiUrl, '请检查“偏好设置”中的搜索服务地址和网络连接；清空该地址可以恢复本地搜索。').searchGal(job.query,
        (completed, total) => send({ kind: 'search-event', event: { progress: { completed, total } } }),
        { signal, onResult: result => send({ kind: 'search-event', event: { result } }) },
      );
      send({ kind: 'search-complete', outcome });
    } else {
      const outcome: SearchOutcome = { results: [], errors: [], total: PLATFORMS_GAL.length };
      const decoder = new TextDecoder();
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          signal.throwIfAborted();
          for (const line of decoder.decode(chunk).trim().split('\n')) {
            const event = JSON.parse(line) as SearchEvent;
            if (event.result) {
              if (event.result.error) outcome.errors.push(event.result);
              else if (event.result.items.length) outcome.results.push(event.result);
            }
            send({ kind: 'search-event', event });
          }
        },
      });
      const writer = writable.getWriter();
      try {
        await handleSearchRequestStream(job.query, PLATFORMS_GAL, writer, {
          TOUCHGAL_API_TOKEN: process.env.TOUCHGAL_API_TOKEN,
        });
      } finally { writer.releaseLock(); }
      send({ kind: 'search-complete', outcome });
    }
  } catch (error) {
    if (signal.aborted) send({ kind: 'aborted' });
    else send({ kind: 'error', error: error instanceof Error ? error.message : String(error) });
  }
}
