import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const docs = path.resolve(import.meta.dirname, "../docs");
const routes = JSON.parse(await readFile(path.join(docs, "generated-pages.json"), "utf8"));

test("every generated route has a crawlable HTML page with its own canonical", async () => {
  for (const route of routes) {
    const html = await readFile(path.join(docs, route, "index.html"), "utf8");
    assert.match(html, /<!-- SIMKA_GENERATED_PAGE -->/);
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.ok(html.includes(`<link rel="canonical" href="https://andriandev0.github.io/simka-store/${route}/">`), route);
    assert.ok(html.includes('<meta name="description" content="'), route);
    assert.ok(html.includes('<script src="/simka-store/site.js?v='), route);
  }
});

test("sitemap excludes search and empty categories", async () => {
  const sitemap = await readFile(path.join(docs, "sitemap.xml"), "utf8");
  const categories = await readFile(path.join(docs, "categories/index.html"), "utf8");
  assert.ok(!sitemap.includes("/search/"));
  if (categories.includes("Категорий пока нет.")) {
    assert.match(categories, /<meta name="robots" content="noindex, follow">/);
    assert.ok(!sitemap.includes("/categories/"));
  }
});

test("product page has structured offer data", async () => {
  const html = await readFile(path.join(docs, "product/japan-20gb-30days/index.html"), "utf8");
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"priceCurrency":"RUB"/);
});
