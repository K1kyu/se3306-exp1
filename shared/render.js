export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const labels = { CSR: '浏览器生成', SSR: '请求时生成', SSG: '构建时生成' };

export function renderContent({ mode, generatedAt, generationId, requestCount, posts, imageUrl = './assets/books.jpg' }) {
  const safe = escapeHtml;
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium', hour12: false,
  }).format(new Date(generatedAt));
  return `<header class="topbar"><div class="topbar-inner"><span class="wordmark">学习札记</span><span class="edition">SE3306 / EXP.01</span></div></header>
  <main class="page" data-mode="${safe(mode)}" data-generation-id="${safe(generationId)}"${requestCount === undefined ? '' : ` data-request-count="${safe(requestCount)}"`}>
    <section class="heading" aria-labelledby="page-title">
      <div><p class="eyebrow">校园 · 阅读 · 实践</p><h1 id="page-title">校园学习札记</h1><p class="intro">十则关于阅读、编程与实验的记录。</p></div>
      <img class="cover" src="${safe(imageUrl)}" width="360" height="240" alt="图书馆书架上的书籍">
    </section>
    <div class="render-meta"><span class="mode">${safe(mode)}</span><span>${labels[mode]} <time datetime="${safe(generatedAt)}">${safe(time)}</time> <span class="timezone">UTC+8</span></span><form method="get"><button type="submit" title="重新请求当前页面">刷新页面</button></form></div>
    <div class="list-heading"><h2>全部札记</h2><span>${posts.length} 篇${requestCount === undefined ? '' : ` · 请求 #${safe(requestCount)}`}</span></div>
    <div class="post-list">${posts.map(post => `<article class="post"><span class="number" aria-hidden="true">${safe(String(post.id).padStart(2, '0'))}</span><div><span class="tag">${safe(post.tag)}</span><h3>${safe(post.title)}</h3><p>${safe(post.body)}</p></div></article>`).join('\n')}</div>
    <footer><span>黄子昊 · 2024034743029</span><span>学习札记 / 共 ${posts.length} 篇</span></footer>
  </main>`;
}

export function renderDocument(options) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="校园学习札记：十则学习与实践记录。"><link rel="icon" href="data:,"><link rel="stylesheet" href="./assets/style.css"><title>校园学习札记 | ${escapeHtml(options.mode)}</title></head><body>${renderContent(options)}</body></html>`;
}
