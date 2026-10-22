import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin = 'https://simki.cc';
for (const path of ['/', '/catalog', '/categories', '/countries', '/search', '/faq', '/payment', '/delivery', '/contacts', '/about', '/privacy', '/terms', '/returns', '/cookies', '/account/login', '/account/register']) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.ok((await response.text()).includes('</html>'), path);
  console.log('PAGE OK', path);
}
const health = await (await fetch(origin + '/api/health')).json();
assert.equal(health.database, 'ok');
console.log('DATABASE OK; email configured:', health.emailConfigured);
const catalog = await (await fetch(origin + '/api/pages/catalog')).json();
assert.equal(catalog.products.length, 0);
console.log('EMPTY CATALOG OK');
const password = randomUUID() + 'Aa1!';
const email = `deployment-${randomUUID()}@example.invalid`;
const post = (path, fields, cookie = '') => fetch(origin + path, {
  method: 'POST', redirect: 'manual',
  headers: { Origin: origin, Cookie: cookie },
  body: new URLSearchParams(fields),
});
const register = await post('/api/account/register', { name: 'Deployment check', email, password, passwordConfirmation: password });
assert.equal(register.status, 303);
assert.ok(register.headers.get('location').includes('/account?analytics=sign_up'), register.headers.get('location'));
const cookie = register.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
assert.ok(cookie);
try {
  const account = await fetch(origin + '/account', { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(account.status, 200);
  assert.ok((await account.text()).includes(email));
  console.log('REGISTER AND ACCOUNT OK');
  const login = await post('/api/account/login', { email, password });
  assert.equal(login.status, 303);
  assert.ok(!login.headers.get('location').includes('error='));
  console.log('LOGIN OK');
} finally {
  const deleted = await post('/api/account/delete', { password, confirm: 'yes' }, cookie);
  assert.equal(deleted.status, 303);
  assert.ok(!deleted.headers.get('location').includes('error='));
  console.log('TEST ACCOUNT REMOVED');
}
const rejected = await fetch(origin + '/api/orders', {
  method: 'POST', headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, body: '{}',
});
assert.equal(rejected.status, 403);
console.log('CROSS-ORIGIN ORDER REJECTED');
