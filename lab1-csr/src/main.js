import { posts } from '../../shared/posts.js';
import { renderContent } from '../../shared/render.js';
import '../../shared/style.css';
import booksUrl from '../../shared/books.jpg';

document.querySelector('#app').innerHTML = renderContent({
  mode: 'CSR',
  generatedAt: new Date().toISOString(),
  generationId: crypto.randomUUID(),
  posts,
  imageUrl: booksUrl,
});
