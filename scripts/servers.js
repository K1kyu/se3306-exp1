import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sirv from 'sirv';
import { createApp } from '../lab1-ssr/server.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function staticServer(relativeDirectory) {
  const directory = fileURLToPath(new URL(`../${relativeDirectory}/`, import.meta.url));
  return createServer(sirv(directory, { dev: true, etag: false }));
}

export function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(`http://127.0.0.1:${server.address().port}/`);
    });
  });
}

export async function startSuite(preferred = {}) {
  const running = [];
  const urls = {};
  try {
    for (const [mode, create] of [
      ['csr', () => staticServer('lab1-csr/dist')],
      ['ssr', () => createServer(createApp())],
      ['ssg', () => staticServer('lab1-ssg/dist')],
    ]) {
      let server = create();
      try { urls[mode] = await listen(server, preferred[mode] || 0); }
      catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        server = create();
        urls[mode] = await listen(server);
      }
      running.push(server);
    }
  } catch (error) {
    await Promise.all(running.map(server => new Promise(resolve => server.close(resolve))));
    throw error;
  }
  return {
    urls,
    close: () => Promise.all(running.map(server => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }))),
  };
}
