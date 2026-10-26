import { access, writeFile } from 'node:fs/promises';
import { startSuite } from './servers.js';

for (const path of ['lab1-csr/dist/index.html', 'lab1-ssg/dist/index.html']) {
  try { await access(new URL(`../${path}`, import.meta.url)); }
  catch { throw new Error('Build files missing. Run pnpm build first.'); }
}
const suite = await startSuite({ csr: 4173, ssr: 3000, ssg: 8080 });
await writeFile(new URL('../.local-servers.json', import.meta.url), JSON.stringify({ pid: process.pid, ...suite.urls }, null, 2));
for (const [mode, url] of Object.entries(suite.urls)) console.log(`${mode.toUpperCase()}: ${url}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await suite.close(); process.exit(0); });
