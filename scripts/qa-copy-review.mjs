import assert from 'node:assert/strict';

const base = process.env.COPY_REVIEW_URL || 'https://simki.cc';
const checks = [
  ['/', 'Перед оплатой проверьте состав пакета', 'Условия подключения указаны в каждом тарифе'],
  ['/about', 'Доступные предложения и наличие', 'В каталоге есть цифровые и физические варианты'],
  ['/faq', 'уточните его у поддержки до оплаты', 'Точное условие активации указано'],
  ['/categories', 'Предложения операторов стран Азии', 'Тарифы для Таиланда, Японии'],
  ['/countries', 'Польша', 'Демонстрационный пример'],
  ['/catalog', 'У некоторых eSIM тариф оплачивается отдельно', 'Звонки Нет'],
  ['/account/register', 'оформленные после входа в аккаунт', 'заказы с этим email'],
  ['/account/forgot?sent=1', 'Если письмо не пришло', 'почта настроена'],
  ['/privacy', 'случайный идентификатор посетителя', 'обезличенный Client ID'],
  ['/cookies', 'Политика cookie', 'Cookie Policy'],
  ['/product/esim-cellfie-georgia', 'Зависят от выбранного тарифа', 'Отслеживается менеджером'],
  ['/product/esim-plus-poland', 'Условия поступления уточняйте у поддержки', 'будут опубликованы после следующего поступления'],
  ['/product/esim-orange-poland', 'Условия поступления уточняйте у поддержки', 'будут опубликованы после следующего поступления'],
  ['/product/esim-t-mobile-poland', 'Условия поступления уточняйте у поддержки', 'будут опубликованы после следующего поступления'],
];

for (const [path, present, absent] of checks) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, path);
  const text = (await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(present), `${path}: missing expected text`);
  assert.ok(!text.includes(absent), `${path}: stale wording`);
  console.log(`PASS ${path}`);
}
console.log(`PASS ${checks.length} published copy checks`);
