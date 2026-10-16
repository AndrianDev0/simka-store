import assert from 'node:assert/strict';
const response = await fetch('https://simki.cc/');
assert.equal(response.status, 200);
const body = await response.text();
assert.ok(body.includes('Куда отправляетесь?'));
assert.ok(!body.includes('QR ready'));
assert.ok(!body.includes('ICCID'));
const aside = body.match(/<aside[\s\S]*?<\/aside>/)?.[0];
assert.ok(aside);
const links = [...aside.matchAll(/href="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
assert.equal(links.length, 5);
for (const link of links) {
  const result = await fetch(new URL(link, 'https://simki.cc'));
  assert.equal(result.status, 200, link);
  console.log('PASS', link);
}
console.log('PASS: fictional SIM mockups removed, destination links available');
