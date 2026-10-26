import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';
import { startSuite } from './servers.js';
import { browserExecutable } from './browser.js';
import { posts } from '../shared/posts.js';
import { escapeHtml } from '../shared/render.js';

const output = new URL('../evidence/', import.meta.url);
for (const directory of ['source/', 'screenshots/']) await mkdir(new URL(directory, output), { recursive: true });
const saveJson = (name, value) => writeFile(new URL(name, output), JSON.stringify(value, null, 2) + '\n');
const screenshotPath = name => fileURLToPath(new URL(`screenshots/${name}.png`, output));
const hash = value => createHash('sha256').update(value).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const profiles = {
  local: { latency: 0, downloadBytesPerSecond: -1, uploadBytesPerSecond: -1, cpuRate: 1 },
  slow: { latency: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 93750, cpuRate: 4 },
};
const suite = await startSuite();
let browser;
try {
  browser = await chromium.launch({ executablePath: browserExecutable(), headless: true });
  const evidence = {
    collectedAt: new Date().toISOString(),
    environment: { node: process.version, browser: browser.version(), os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryGB: Math.round(os.totalmem() / 1024 ** 3), viewport: { width: 1280, height: 900 }, timezone: 'Asia/Shanghai' },
    method: 'One discarded warm-up per mode/profile, then three fresh-context navigations per mode/profile. Round-robin order. Cache disabled via CDP. Median of each metric. No artificial application delay. Values describe this local experiment only.',
    profiles,
    sources: {}, behavior: {}, samples: [], summary: {},
  };
  const makeContext = options => browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', ...options });

  for (const [mode, url] of Object.entries(suite.urls)) {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const source = await response.text();
    await writeFile(new URL(`source/${mode}.html`, output), source);
    const bodyMatches = posts.filter(post => source.includes(post.body)).length;
    assert.equal(bodyMatches, mode === 'csr' ? 0 : 10);
    evidence.sources[mode] = { bytes: Buffer.byteLength(source), sha256: hash(source), articleBodiesInHtml: bodyMatches, headers: Object.fromEntries(response.headers) };

    const context = await makeContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.locator('article').last().waitFor();
    assert.equal(await page.locator('article').count(), 10);
    assert.equal(await page.locator('h3').allTextContents().then(titles => titles.join('|')), posts.map(post => post.title).join('|'));
    await page.locator('.cover').evaluate(image => image.decode());
    await page.screenshot({ path: screenshotPath(`${mode}-desktop`), fullPage: true });
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${mode}: overflow at ${width}px`);
      if (width === 375) await page.screenshot({ path: screenshotPath(`${mode}-mobile`), fullPage: true });
    }
    assert.deepEqual(errors, []);
    await context.close();

    const disabled = await makeContext({ javaScriptEnabled: false });
    const disabledPage = await disabled.newPage();
    await disabledPage.goto(url);
    const disabledCount = await disabledPage.locator('article').count();
    assert.equal(disabledCount, mode === 'csr' ? 0 : 10);
    await disabledPage.screenshot({ path: screenshotPath(`${mode}-no-js`), fullPage: true });
    let refreshWorksWithoutJs = null;
    if (mode !== 'csr') {
      const before = await disabledPage.locator('main').getAttribute('data-generation-id');
      await Promise.all([disabledPage.waitForNavigation(), disabledPage.getByRole('button', { name: '刷新页面' }).click()]);
      const after = await disabledPage.locator('main').getAttribute('data-generation-id');
      assert.equal(before === after, mode === 'ssg');
      refreshWorksWithoutJs = true;
    }
    evidence.behavior[mode] = { articlesWithJs: 10, articlesWithoutJs: disabledCount, refreshWorksWithoutJs, mobileWidthsPassed: [375, 320], pageErrors: errors };
    await disabled.close();

    const sourceContext = await makeContext();
    const sourcePage = await sourceContext.newPage();
    await sourcePage.setContent(`<html lang="zh-CN"><meta charset="UTF-8"><style>body{margin:24px;font:14px/1.6 Consolas,monospace;background:#f7f8fa;color:#25312d}h1{font:20px system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>${mode.toUpperCase()} HTTP response / ${Buffer.byteLength(source)} bytes</h1><pre>${escapeHtml(source)}</pre></html>`);
    await sourcePage.screenshot({ path: screenshotPath(`${mode}-source`), fullPage: true });
    await sourceContext.close();
  }

  const vite = await createViteServer({ root: fileURLToPath(new URL('../lab1-csr/', import.meta.url)), server: { host: '127.0.0.1', port: 5173, strictPort: false } });
  try {
    await vite.listen();
    const url = vite.resolvedUrls.local[0];
    const context = await makeContext();
    const page = await context.newPage();
    const requests = [];
    page.on('response', response => requests.push({ path: new URL(response.url()).pathname, status: response.status(), type: response.request().resourceType() }));
    await page.goto(url, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('article').count(), 10);
    assert.ok(requests.some(request => request.path === '/src/main.js' && request.status === 200));
    await page.screenshot({ path: screenshotPath('csr-dev'), fullPage: true });
    await saveJson('csr-dev.json', { url, collectedAt: new Date().toISOString(), articles: 10, requests });
    await page.setContent(`<html lang="zh-CN"><meta charset="UTF-8"><style>body{font:16px/1.7 system-ui;margin:36px;color:#25312d}h1{font-size:24px}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #ccd6d0;padding:10px;text-align:left;overflow-wrap:anywhere}th{background:#e0f0e8}th:first-child{width:70%}p{color:#59655e}</style><h1>CSR 开发服务器的实际网络请求</h1><p>${escapeHtml(url)} · 浏览器自动化采集的响应记录，非 DevTools 截图</p><table><tr><th>请求路径</th><th>类型</th><th>HTTP 状态</th></tr>${requests.map(request => `<tr><td>${escapeHtml(request.path)}</td><td>${escapeHtml(request.type)}</td><td>${request.status}</td></tr>`).join('')}</table></html>`);
    await page.screenshot({ path: screenshotPath('csr-dev-network'), fullPage: true });
    await context.close();
  } finally { await vite.close(); }

  const refreshContext = await makeContext();
  const refreshPage = await refreshContext.newPage();
  const requests = [];
  for (let index = 1; index <= 2; index += 1) {
    await refreshPage.goto(suite.urls.ssr);
    requests.push(await refreshPage.locator('main').evaluate(main => ({ id: main.dataset.generationId, count: Number(main.dataset.requestCount), generatedAt: main.querySelector('time').dateTime })));
    await refreshPage.screenshot({ path: screenshotPath(`ssr-request-${index}`) });
    if (index === 1) await refreshPage.waitForTimeout(1100);
  }
  assert.notEqual(requests[0].id, requests[1].id);
  assert.notEqual(requests[0].generatedAt, requests[1].generatedAt);
  evidence.behavior.ssr.requests = requests;
  const staticA = await (await fetch(suite.urls.ssg)).text();
  const staticB = await (await fetch(suite.urls.ssg)).text();
  assert.equal(staticA, staticB);
  evidence.behavior.ssg.repeatedResponseSha256 = [hash(staticA), hash(staticB)];
  await refreshContext.close();

  async function measure(mode, profile, round) {
    const context = await makeContext();
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const settings = profiles[profile];
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: settings.latency, downloadThroughput: settings.downloadBytesPerSecond, uploadThroughput: settings.uploadBytesPerSecond });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: settings.cpuRate });
      const requests = [];
      page.on('request', request => requests.push({ path: new URL(request.url()).pathname, type: request.resourceType() }));
      await page.addInitScript(() => {
        window.labMetrics = { lcp: null, shifts: [] };
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.labMetrics.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.labMetrics.shifts.push({ value: entry.value, startTime: entry.startTime });
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(suite.urls[mode], { waitUntil: 'networkidle' });
      await page.locator('article').last().waitFor();
      await page.waitForTimeout(1000);
      const values = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        let cls = 0, current = 0, start = 0, last = 0;
        for (const shift of window.labMetrics.shifts) {
          if (current && shift.startTime - last < 1000 && shift.startTime - start < 5000) current += shift.value;
          else { current = shift.value; start = shift.startTime; }
          last = shift.startTime;
          cls = Math.max(cls, current);
        }
        return { fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, lcp: window.labMetrics.lcp, cls, ttfb: navigation.responseStart - navigation.startTime, resources: performance.getEntriesByType('resource').map(resource => ({ path: new URL(resource.name).pathname, initiatorType: resource.initiatorType, transferSize: resource.transferSize, decodedBodySize: resource.decodedBodySize, duration: resource.duration })) };
      });
      assert.ok(Number.isFinite(values.fcp) && Number.isFinite(values.lcp), 'Paint metrics missing');
      return { mode, profile, round, warmup: round === 0, ...values, requests, jsRequests: requests.filter(request => request.type === 'script').length };
    } finally { await context.close(); }
  }

  for (const profile of Object.keys(profiles)) {
    for (let round = 0; round <= 3; round += 1) {
      for (const mode of ['csr', 'ssr', 'ssg']) {
        const sample = await measure(mode, profile, round);
        evidence.samples.push(sample);
        console.log(`${profile} ${mode} round=${round} FCP=${sample.fcp.toFixed(1)}ms LCP=${sample.lcp.toFixed(1)}ms`);
      }
    }
    evidence.summary[profile] = {};
    for (const mode of ['csr', 'ssr', 'ssg']) {
      const samples = evidence.samples.filter(sample => sample.profile === profile && sample.mode === mode && !sample.warmup);
      evidence.summary[profile][mode] = Object.fromEntries(['fcp', 'lcp', 'cls', 'ttfb', 'jsRequests'].map(key => [key, median(samples.map(sample => sample[key]))]));
    }
  }
  evidence.asset = { file: 'shared/books.jpg', bytes: (await readFile(new URL('../shared/books.jpg', import.meta.url))).length };
  await saveJson('metrics.json', evidence);
  const rows = [];
  for (const profile of Object.keys(profiles)) for (const mode of ['csr', 'ssr', 'ssg']) {
    const value = evidence.summary[profile][mode];
    rows.push(`| ${profile} | ${mode.toUpperCase()} | ${evidence.sources[mode].bytes} | ${value.fcp.toFixed(1)} | ${value.lcp.toFixed(1)} | ${value.ttfb.toFixed(1)} | ${value.cls.toFixed(4)} | ${value.jsRequests} | ${evidence.sources[mode].articleBodiesInHtml} |`);
  }
  await writeFile(new URL('results.md', output), `# 本机实测结果\n\n采集时间（UTC）：${evidence.collectedAt}\n\n浏览器：${evidence.environment.browser}；Node.js：${evidence.environment.node}。\n\n| 网络 | 模式 | HTML 字节 | FCP ms | LCP ms | TTFB ms | CLS | JS 请求数 | HTML 中的正文篇数 |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\n每种条件先预热一次，再取三个独立上下文样本的中位数；local 为无节流，slow 为 150 ms 延迟、1.6 Mbps 下行、0.75 Mbps 上行与 4 倍 CPU 降速。两个档位均禁用缓存，视口均为 1280 × 900。HTML 大小为 UTF-8 响应正文大小，不含响应头，也不代表页面全部下载量。原始值及网络请求记录见 metrics.json。\n\n截图由自动化浏览器真实采集；source 截图是原始 HTTP 响应的排版展示，不是 DevTools 截图。未通过这组加载测试测量 INP。\n`);
  console.log('Evidence and behavior checks complete.');
} finally {
  if (browser) await browser.close();
  await suite.close();
}
