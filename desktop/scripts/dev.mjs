import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildMain, rendererConfig, root } from './build.mjs';

await buildMain();
const server = await createServer({ ...rendererConfig, server: { host: '127.0.0.1', port: 5173, strictPort: false } });
await server.listen();
const child = spawn(electron, [root], {
  stdio: 'inherit', env: { ...process.env, SEARCHGAL_DEV_URL: server.resolvedUrls.local[0] },
});
child.once('exit', async code => { await server.close(); process.exit(code ?? 1); });
child.once('error', async error => { console.error(error); await server.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
