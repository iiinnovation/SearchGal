import { executeJob } from './worker-runtime';
import type { WorkerRequest } from '../shared/contracts';

const port = process.parentPort;
if (!port) throw new Error('SearchGal worker requires a parent process');
const controller = new AbortController();
let started = false;
port.on('message', ({ data }: { data: WorkerRequest }) => {
  if (data.kind === 'abort') {
    controller.abort(new DOMException('任务已暂停', 'AbortError'));
  } else if (!started) {
    started = true;
    void executeJob(data, controller.signal, message => port.postMessage(message));
  }
});
