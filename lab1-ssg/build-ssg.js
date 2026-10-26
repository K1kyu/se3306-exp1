import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { posts } from '../shared/posts.js';
import { renderDocument } from '../shared/render.js';

export async function build(outputDirectory = new URL('./dist/', import.meta.url), content = posts) {
  const assets = new URL('assets/', outputDirectory);
  await mkdir(assets, { recursive: true });
  const generatedAt = new Date().toISOString();
  const html = renderDocument({ mode: 'SSG', generatedAt, generationId: randomUUID(), posts: content });
  await writeFile(new URL('index.html', outputDirectory), html, 'utf8');
  await copyFile(new URL('../shared/style.css', import.meta.url), new URL('style.css', assets));
  await copyFile(new URL('../shared/books.jpg', import.meta.url), new URL('books.jpg', assets));
  return { generatedAt, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log('SSG build:', await build());
}
