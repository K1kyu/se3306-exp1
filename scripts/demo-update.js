import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sirv from 'sirv';
import { posts } from '../shared/posts.js';
import { createApp } from '../lab1-ssr/server.js';
import { build } from '../lab1-ssg/build-ssg.js';
import { listen } from './servers.js';

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'se3306-update-'));
const destination = pathToFileURL(temporaryDirectory + '/');
let currentPosts = posts.map(post => ({ ...post }));
const originalTitle = currentPosts[0].title;
const updatedTitle = '更新实验：先提问，再验证';
const ssr = createServer(createApp(() => currentPosts));
const ssg = createServer(sirv(temporaryDirectory, { dev: true, etag: false }));
const observations = [];
async function capture(stage, mode, url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const html = await response.text();
  const observation = { stage, mode, showsUpdatedTitle: html.includes(updatedTitle), sha256: createHash('sha256').update(html).digest('hex') };
  observations.push(observation);
  console.log(`${stage.padEnd(18)} ${mode}: ${observation.showsUpdatedTitle ? updatedTitle : originalTitle}`);
  return observation;
}

try {
  await build(destination, currentPosts);
  const ssrUrl = await listen(ssr);
  const ssgUrl = await listen(ssg);
  await capture('before-change', 'SSR', ssrUrl);
  const originalStatic = await capture('before-change', 'SSG', ssgUrl);
  currentPosts = currentPosts.map((post, index) => index === 0 ? { ...post, title: updatedTitle } : post);
  const updatedDynamic = await capture('after-data-change', 'SSR', ssrUrl);
  const unchangedStatic = await capture('after-data-change', 'SSG', ssgUrl);
  assert.equal(updatedDynamic.showsUpdatedTitle, true);
  assert.equal(unchangedStatic.showsUpdatedTitle, false);
  assert.equal(originalStatic.sha256, unchangedStatic.sha256);
  await build(destination, currentPosts);
  const rebuilt = await capture('after-rebuild', 'SSG', ssgUrl);
  assert.equal(rebuilt.showsUpdatedTitle, true);
  const evidence = new URL('../evidence/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  await writeFile(new URL('content-update.json', evidence), JSON.stringify({
    collectedAt: new Date().toISOString(),
    method: 'Controlled in-memory dataset with a request-time SSR provider and a separate temporary SSG build. No project source or production build is modified.',
    originalTitle, updatedTitle, observations,
  }, null, 2) + '\n');
  console.log('PASS: SSR follows the data provider; SSG changes only after rebuilding.');
} finally {
  for (const server of [ssr, ssg]) {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
