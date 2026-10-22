import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { Client } = require('pg');
assert.equal(process.env.QA_ISOLATED, 'true');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/simka_qa');
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
assert.equal((await db.query('select current_database() name')).rows[0].name, 'simka_qa');
const base = 'http://127.0.0.1:3000';
const headers = { 'content-type': 'application/json', origin: base, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' };
const results = [];
const policyVersion = readFileSync('lib/analytics-policy.ts','utf8').match(/ANALYTICS_POLICY_VERSION = "([^"]+)"/)[1];
let update = Date.now();
async function post(path, body, expected = 200) {
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function callback(data) {
  writeFileSync('/tmp/qa-telegram.jsonl', '');
  const response = await fetch(base + '/api/telegram/webhook', { method: 'POST', headers: { ...headers, 'x-telegram-bot-api-secret-token': 'qa-secret' }, body: JSON.stringify({ update_id: update++, callback_query: { id: String(update), data, from: { id: 1 }, message: { message_id: 1, chat: { id: 1 } } } }), signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, data);
  const messages = readFileSync('/tmp/qa-telegram.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const text = messages.map(m => m.text || '').join('\n');
  assert.ok(messages.length, `${data}: no response`);
  assert.ok(!/не удалось|неизвестная команда/i.test(text), `${data}: ${text}`);
  return text;
}
try {
  await db.query("update products set availability_status='IN_STOCK' where sku='QA-SKU-1'");
  const clientId = randomUUID(), sessionId = randomUUID();
  const event = { eventId: randomUUID(), clientId, sessionId, name: 'page_view', path: '/catalog', occurredAt: new Date(Date.now() - 60000).toISOString(), attribution: { source: 'qa-google', medium: 'cpc', campaign: 'qa-e2e' }, device: { language: 'ru-RU', timezone: 'Asia/Yakutsk', automation: false } };
  await post('/api/analytics/events', event, 403);
  results.push('No consent: rejected');
  await post('/api/privacy/consent', { eventId: randomUUID(), consentId: clientId, decision: 'accepted', source: 'banner', policyVersion }, 201);
  await post('/api/analytics/events', event, 201);
  // Retrying the same event must not inflate the funnel.
  const retry = await fetch(base + '/api/analytics/events', { method: 'POST', headers, body: JSON.stringify(event) });
  assert.ok(retry.ok);
  assert.equal(Number((await db.query('select count(*) n from analytics_events where id=$1', [event.eventId])).rows[0].n), 1);
  const product = (await db.query("select id, name from products where sku='QA-SKU-1'")).rows[0];
  for (const [i, name] of ['view_item', 'add_to_cart', 'begin_checkout'].entries()) await post('/api/analytics/events', { ...event, eventId: randomUUID(), name, occurredAt: new Date(Date.now() - 45000 + i * 10000).toISOString(), params: { items: [{ item_id: String(product.id), item_name: product.name, quantity: 1 }] } }, 201);
  results.push('Consent, UTM and deduplication: passed');
  const request = { requestId: randomUUID(), customerName: 'QA Analytics', customerEmail: 'qa-analytics@example.com', customerContact: '', paymentMethod: 'manager', analytics: { clientId, source: 'qa-google', medium: 'cpc', campaign: 'qa-e2e' }, items: [{ productId: product.id, quantity: 1 }] };
  const response = await fetch(base + '/api/orders', { method: 'POST', headers, body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, await response.text());
  const order = (await db.query('select * from orders where request_id=$1', [request.requestId])).rows[0];
  assert.ok(order);
  assert.equal(order.first_party_client_id, clientId);
  assert.equal(order.analytics_source, 'qa-google');
  await callback(`order:paid_confirm:${order.order_number}`);
  assert.equal((await db.query('select status from orders where id=$1', [order.id])).rows[0].status, 'WAITING_FOR_MANAGER');
  // Isolated fixture only: email delivery is deliberately not configured here.
  await db.query('update orders set payment_instructions_sent_at=now() where id=$1', [order.id]);
  await callback(`order:paid_confirm:${order.order_number}`);
  const paid = (await db.query('select status, paid_at from orders where id=$1', [order.id])).rows[0];
  assert.equal(paid.status, 'PAID');
  assert.ok(paid.paid_at);
  results.push('Order attribution and guarded manager PAID transition: passed (email prerequisite simulated)');
  for (const data of [ ...[1,7,14,30,90,365,0].map(n=>`analytics:period:${n}`), 'analytics:calendar:today', 'analytics:calendar:yesterday', ...['revenue','traffic','products','vitals','countries','search','fraud'].map(n=>`analytics:${n}:7`), ...['first_click','last_click','linear','position_based','time_decay'].map(n=>`analytics:attr:${n}:7`), 'analytics:retention', 'analytics:unit_economics' ]) {
    const text = await callback(data);
    assert.ok(text.length > 20, data);
    results.push(`${data}: responded`);
  }
  const attribution = await callback('analytics:attr:last_click:7');
  assert.match(attribution, /qa-google/);
  results.push('Paid order source appears in attribution report');
  const stages = text => ['Посещение','Товар','Корзина','Checkout','Заказ','Оплата'].map(label => {
    const match = text.match(new RegExp(`${label}: (\\d+)`));
    assert.ok(match, `Missing funnel stage ${label}`);
    return Number(match[1]);
  });
  const before = stages(await callback('analytics:traffic:7'));
  const abandonedClient = randomUUID(), abandonedSession = randomUUID();
  await post('/api/privacy/consent', { eventId: randomUUID(), consentId: abandonedClient, decision: 'accepted', source: 'banner', policyVersion }, 201);
  for (const [i,name] of ['page_view','view_item','add_to_cart','begin_checkout','checkout_error','page_exit'].entries()) {
    await post('/api/analytics/events', { ...event, clientId: abandonedClient, sessionId: abandonedSession, eventId: randomUUID(), name, path: '/qa-abandoned-checkout', occurredAt: new Date(Date.now()-600000+i*15000).toISOString(), params: { error_type: 'qa_payment_unavailable', duration_ms: 75000 } }, 201);
  }
  const afterText = await callback('analytics:traffic:7');
  assert.deepEqual(stages(afterText), before.map((value,index)=>value+(index<4?1:0)));
  assert.match(afterText, /qa-abandoned-checkout/);
  assert.equal(Number((await db.query("select count(*) n from analytics_events where session_id=$1 and name='checkout_error'",[abandonedSession])).rows[0].n),1);
  results.push('Abandoned checkout: +1 visit/view/cart/checkout, no extra order or payment; error and exit recorded');
  // Unique synthetic currency isolates exact financial assertions from older QA runs.
  const currency = 'XQA';
  await db.query("update orders set currency='RUB' where currency='XQA'");
  await db.query("update marketing_costs set currency='RUB' where currency='XQA'");
  await db.query('update orders set currency=$1, delivery_expense_amount=0, payment_fee_amount=3, other_expense_amount=2, partner_code=null where id=$2',[currency,order.id]);
  await db.query('update order_items set unit_cost=30 where order_id=$1',[order.id]);
  const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
  await db.query('insert into marketing_costs(id,source,amount,currency,starts_at,ends_at,created_by) values($1,$2,10,$3,$4,$4,$5)',[randomUUID(),'qa-google',currency,yesterday,'qa']);
  const revenue = await callback('analytics:revenue:7');
  const money = (label,amount)=>assert.ok(revenue.includes(`${label}: ${amount} ${currency}`), `${label}: expected ${amount} ${currency}`);
  money('Чистая товарная выручка',101);
  money('Себестоимость','−30');
  money('Реклама','−10');
  money('Комиссии оплаты','−3');
  money('Прочие расходы','−2');
  money('Чистая прибыль',56);
  results.push('Financial report: 101 revenue - 30 cost - 10 ads - 3 fee - 2 other = 56 profit');
  await callback('analytics:csv:7');
  const exports = readFileSync('/tmp/qa-telegram.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(message=>message.document);
  assert.ok(exports.length);
  const csv=exports.map(message=>message.document).join('\n');
  assert.match(csv,/order_number/);assert.ok(csv.includes(order.order_number));assert.ok(csv.includes('qa-google'));
  results.push('CSV export includes the test order and its source');
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await db.end(); }
