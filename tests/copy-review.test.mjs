import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('registration and checkout copy do not promise unsupported order linking or manager email for crypto', () => {
  assert.match(source('app/account/register/page.tsx'), /оформленные после входа в аккаунт/);
  assert.doesNotMatch(source('app/account/register/page.tsx'), /заказы с этим email/);
  assert.doesNotMatch(source('app/storefront.tsx'), /Менеджер отправит реквизиты для оплаты на этот email/);
  assert.match(source('app/storefront.tsx'), /Реквизиты придут на указанный email/);
});

test('missing service details are not displayed as an absence of calls or SMS', () => {
  for (const path of ['app/product/[slug]/page.tsx']) {
    const text = source(path);
    assert.match(text, /product\.calls \|\| \(product\.hasCalls \? "Включены" : "Не уточнено"\)/);
    assert.match(text, /product\.sms \|\| \(product\.hasSms \? "Включены" : "Не уточнено"\)/);
  }
  const summary = source('lib/product-presentation.ts');
  assert.match(summary, /product\.calls \|\| \(product\.hasCalls \? "Включены" : ""\)/);
  assert.match(summary, /product\.sms \|\| \(product\.hasSms \? "Включены" : ""\)/);
  assert.doesNotMatch(summary, /Нет звонков|Без звонков|Нет SMS|Без SMS/);
});

test('copy does not promise missing countries or complete activation terms', () => {
  assert.match(source('app/countries/page.tsx'), /!country\.slug\.startsWith\("demo-"\)/);
  assert.doesNotMatch(source('app/categories/page.tsx'), /Тарифы для Таиланда, Японии/);
  assert.doesNotMatch(source('app/faq/page.tsx'), /Точное условие активации указано/);
  assert.doesNotMatch(source('app/about/page.tsx'), /В каталоге есть цифровые и физические варианты/);
});

test('linked analytics are not called anonymous', () => {
  for (const path of ['app/components/analytics-provider.tsx', 'app/cookies/page.tsx', 'app/privacy/page.tsx']) {
    assert.doesNotMatch(source(path), /обезличенную статистику|собственную обезличенную аналитику|обезличенный Client ID/);
  }
});
