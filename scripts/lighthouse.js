import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';
import { startSuite } from './servers.js';
import { browserExecutable } from './browser.js';

const directory = new URL('../reports/', import.meta.url);
await mkdir(directory, { recursive: true });
const suite = await startSuite();
const profile = await mkdtemp(join(tmpdir(), 'se3306-lighthouse-'));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { executablePath: browserExecutable(), headless: true, args: ['--remote-debugging-port=0'] });
  const port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
  const summary = { collectedAt: new Date().toISOString(), note: 'Single Lighthouse simulated mobile run per production page. Independent from Performance API desktop measurements. TBT is not INP.', results: {} };
  for (const [mode, url] of Object.entries(suite.urls)) {
    const result = await lighthouse(url, { port, output: ['html', 'json'], logLevel: 'error', onlyCategories: ['performance'], locale: 'zh' });
    if (result.lhr.runtimeError) throw new Error(JSON.stringify(result.lhr.runtimeError));
    await writeFile(new URL(`${mode}.html`, directory), result.report[0]);
    await writeFile(new URL(`${mode}.json`, directory), result.report[1]);
    const reportPage = await browser.newPage();
    await reportPage.setViewportSize({ width: 1280, height: 1200 });
    await reportPage.goto(new URL(`${mode}.html`, directory).href);
    await reportPage.locator('.lh-metric').first().waitFor();
    await reportPage.screenshot({ path: fileURLToPath(new URL(`${mode}-lighthouse.png`, directory)) });
    await reportPage.close();
    const audits = result.lhr.audits;
    summary.results[mode] = { lighthouseVersion: result.lhr.lighthouseVersion, performanceScore: result.lhr.categories.performance.score, fcp: audits['first-contentful-paint'].numericValue, lcp: audits['largest-contentful-paint'].numericValue, tbt: audits['total-blocking-time'].numericValue, cls: audits['cumulative-layout-shift'].numericValue, settings: result.lhr.configSettings };
    console.log(`${mode}: score=${summary.results[mode].performanceScore}, FCP=${summary.results[mode].fcp.toFixed(1)}ms, LCP=${summary.results[mode].lcp.toFixed(1)}ms, TBT=${summary.results[mode].tbt.toFixed(1)}ms`);
  }
  await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await suite.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
