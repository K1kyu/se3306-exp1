import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { posts } from '../shared/posts.js';
import { escapeHtml, renderContent } from '../shared/render.js';
import { createApp } from '../lab1-ssr/server.js';
import { build } from '../lab1-ssg/build-ssg.js';
import { listen } from '../scripts/servers.js';

test('shared data contains ten distinct articles', () => {
  assert.equal(posts.length, 10);
  assert.equal(new Set(posts.map(post => post.id)).size, 10);
});

test('article text cannot inject HTML or attributes', () => {
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
  const html = renderContent({ mode: 'SSR', generatedAt: new Date().toISOString(), generationId: 'test', posts: [{ id: 1, tag: '" onmouseover="bad', title: '<script>bad()</script>', body: '<img src=x onerror=bad()>' }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img'));
});

test('CSR source and production HTML contain no article text', async () => {
  for (const file of ['../lab1-csr/index.html', '../lab1-csr/dist/index.html']) {
    const html = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(html, /<div id="app"><\/div>/);
    for (const post of posts) assert.ok(!html.includes(post.title));
  }
});

test('SSR renders all articles on each request and prevents response caching', async () => {
  const server = createServer(createApp());
  const url = await listen(server);
  try {
    const first = await fetch(url);
    const htmlA = await first.text();
    const htmlB = await (await fetch(url)).text();
    for (const post of posts) assert.ok(htmlA.includes(post.title));
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.match(htmlA, /data-request-count="1"/);
    assert.match(htmlB, /data-request-count="2"/);
    assert.notEqual(htmlA.match(/data-generation-id="([^"]+)"/)[1], htmlB.match(/data-generation-id="([^"]+)"/)[1]);
    assert.ok(!htmlA.includes('<script'));
    assert.equal((await fetch(`${url}missing`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('SSG stays identical until an explicit rebuild', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'se3306-ssg-'));
  const directory = pathToFileURL(temporaryDirectory + '/');
  try {
    await build(directory);
    const first = await readFile(new URL('index.html', directory), 'utf8');
    assert.equal(first, await readFile(new URL('index.html', directory), 'utf8'));
    for (const post of posts) assert.ok(first.includes(post.title));
    assert.ok(!first.includes('<script'));
    const changedPosts = posts.map(post => ({ ...post, title: `Updated: ${post.title}` }));
    assert.ok(!first.includes(changedPosts[0].title));
    assert.equal(first, await readFile(new URL('index.html', directory), 'utf8'));
    await build(directory, changedPosts);
    const rebuilt = await readFile(new URL('index.html', directory), 'utf8');
    assert.notEqual(first, rebuilt);
    assert.ok(rebuilt.includes(changedPosts[0].title));
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
});

test('SSR reads an updated data provider on the next request', async () => {
  let content = posts;
  const server = createServer(createApp(() => content));
  const url = await listen(server);
  try {
    const original = await (await fetch(url)).text();
    content = posts.map(post => ({ ...post, title: `Updated: ${post.title}` }));
    const updated = await (await fetch(url)).text();
    assert.ok(!original.includes(content[0].title));
    assert.ok(updated.includes(content[0].title));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
