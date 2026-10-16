import assert from 'node:assert/strict';

const origin = process.argv[2] || 'https://simki.cc';
async function page(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.text();
}
const sitemap = await page('/sitemap.xml');
assert.ok(!sitemap.includes('turkey-turkcell-20gb'));
assert.ok(!sitemap.includes('/country/turkey'));
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1].replaceAll('&amp;', '&'));
assert.ok(urls.length >= 13);
for (const url of urls) {
  assert.equal(new URL(url).origin, new URL(origin).origin);
  await page(url);
}
console.log(`PASS sitemap: ${urls.length} URLs return 200; removed demo URLs absent`);
const catalog = await page('/catalog');
assert.ok(catalog.includes('Каталог пока пуст'));
assert.ok(!catalog.includes('Измените или сбросьте выбранные фильтры.'));
assert.ok(catalog.includes('Больше 5 и до 20 ГБ'));
console.log('PASS empty catalog and data-range description');
const home = await page('/');
assert.ok(home.includes('Каталог пока пуст'));
assert.ok(!home.includes('QR-код и инструкция приходят'));
const delivery = await page('/delivery');
assert.ok(delivery.includes('Код активации и инструкция'));
assert.ok(!delivery.includes('QR-код и инструкция отправляются'));
console.log('PASS home and delivery match activation-code fulfillment');
