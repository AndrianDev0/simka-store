import { mkdir, writeFile } from "node:fs/promises";

// GitHub Pages is the previous address; all live commerce runs on the own-domain server.
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>SIMKA переехала</title><link rel="canonical" href="https://simki.cc/"></head><body><main><h1>SIMKA теперь на simki.cc</h1><p>Открываем актуальную версию магазина.</p><a href="https://simki.cc/">Перейти на сайт</a></main><script>
const prefix = '/simka-store';
const path = location.pathname === prefix ? '/' : location.pathname.startsWith(prefix + '/') ? location.pathname.slice(prefix.length) : '/';
const target = new URL('https://simki.cc/');
target.pathname = path.replace(/index\\.html$/, '');
target.search = location.search;
target.hash = location.hash;
document.querySelector('a').href = target.href;
location.replace(target.href);
</script></body></html>`;
await mkdir('.pages-redirect', { recursive: true });
await Promise.all(['index.html', '404.html'].map(name => writeFile('.pages-redirect/' + name, html)));
await writeFile('.pages-redirect/.nojekyll', '');
