import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { posts } from '../shared/posts.js';
import { renderDocument } from '../shared/render.js';

const sharedDirectory = fileURLToPath(new URL('../shared/', import.meta.url));
const css = readFileSync(new URL('../shared/style.css', import.meta.url), 'utf8');

export function createApp(getPosts = () => posts) {
  const app = express();
  let requestCount = 0;
  app.disable('x-powered-by');
  app.disable('etag');
  app.get('/assets/style.css', (_req, res) => res.type('css').send(css));
  app.get('/assets/books.jpg', (_req, res) => res.sendFile('books.jpg', { root: sharedDirectory }));
  app.get('/', (_req, res) => {
    requestCount += 1;
    res.set('Cache-Control', 'no-store');
    res.type('html').send(renderDocument({
      mode: 'SSR',
      generatedAt: new Date().toISOString(),
      generationId: randomUUID(),
      requestCount,
      posts: getPosts(),
    }));
  });
  return app;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp().listen(port, host, () => {
    console.log(`SSR: http://${host}:${server.address().port}/`);
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
