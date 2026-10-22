BEGIN;

INSERT INTO countries (name, slug, iso_code, flag, region, description, seo_title, seo_description, h1, publication_status, noindex, sort_order, archived_at, updated_at)
VALUES
  ('Польша', 'poland', 'PL', '🇵🇱', 'Европа', 'eSIM польских операторов для связи в Польше и поездок по Европе.', 'eSIM для Польши: операторы и условия', 'Сравните опубликованные eSIM польских операторов, условия активации, наличие и стоимость.', 'eSIM для Польши', 'PUBLISHED', FALSE, 10, NULL, CURRENT_TIMESTAMP),
  ('Грузия', 'georgia', 'GE', '🇬🇪', 'Азия', 'eSIM операторов Грузии для местной связи и роуминга.', 'eSIM для Грузии: Silknet и Cellfie', 'Сравните eSIM операторов Грузии, комплектацию, условия активации, наличие и стоимость.', 'eSIM для Грузии', 'PUBLISHED', FALSE, 20, NULL, CURRENT_TIMESTAMP),
  ('Испания', 'spain', 'ES', '🇪🇸', 'Европа', 'eSIM испанских операторов для местной связи и поездок по Евросоюзу.', 'eSIM для Испании: операторы и условия', 'Сравните опубликованные eSIM испанских операторов, условия использования, наличие и стоимость.', 'eSIM для Испании', 'PUBLISHED', FALSE, 30, NULL, CURRENT_TIMESTAMP)
ON CONFLICT (slug) DO UPDATE SET
  name=EXCLUDED.name, iso_code=EXCLUDED.iso_code, flag=EXCLUDED.flag, region=EXCLUDED.region,
  description=EXCLUDED.description, seo_title=EXCLUDED.seo_title, seo_description=EXCLUDED.seo_description,
  h1=EXCLUDED.h1, publication_status='PUBLISHED', noindex=FALSE, archived_at=NULL, updated_at=CURRENT_TIMESTAMP;

INSERT INTO operators (country_id, name, slug, description, publication_status, sort_order, archived_at, updated_at)
VALUES
  ((SELECT id FROM countries WHERE slug='poland'), 'Orange', 'orange', 'Польский оператор связи Orange.', 'PUBLISHED', 10, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='poland'), 'T-Mobile', 't-mobile', 'Польский оператор связи T-Mobile.', 'PUBLISHED', 20, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='poland'), 'Plus', 'plus', 'Польский оператор связи Plus.', 'PUBLISHED', 30, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='poland'), 'Lyca Mobile', 'lyca-mobile', 'Оператор мобильной связи Lyca Mobile в Польше.', 'PUBLISHED', 40, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='georgia'), 'Silknet', 'silknet', 'Оператор мобильной связи Silknet в Грузии.', 'PUBLISHED', 10, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='georgia'), 'Cellfie', 'cellfie', 'Оператор мобильной связи Cellfie в Грузии.', 'PUBLISHED', 20, NULL, CURRENT_TIMESTAMP),
  ((SELECT id FROM countries WHERE slug='spain'), 'Vodafone', 'vodafone', 'Оператор мобильной связи Vodafone в Испании.', 'PUBLISHED', 10, NULL, CURRENT_TIMESTAMP)
ON CONFLICT (country_id, slug) DO UPDATE SET
  name=EXCLUDED.name, description=EXCLUDED.description, publication_status='PUBLISHED',
  archived_at=NULL, updated_at=CURRENT_TIMESTAMP;

INSERT INTO categories (id, name, slug, description, seo_title, seo_description, h1, is_published, noindex, sort_order, archived_at, updated_at)
VALUES ('esim', 'eSIM', 'esim', 'Электронные SIM-профили для совместимых устройств.', 'Каталог eSIM по странам и операторам', 'Выберите eSIM по стране, оператору, условиям использования, цене и наличию.', 'Каталог eSIM', TRUE, FALSE, 10, NULL, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
  name=EXCLUDED.name, slug=EXCLUDED.slug, description=EXCLUDED.description, seo_title=EXCLUDED.seo_title,
  seo_description=EXCLUDED.seo_description, h1=EXCLUDED.h1, is_published=TRUE, noindex=FALSE,
  archived_at=NULL, updated_at=CURRENT_TIMESTAMP;

INSERT INTO products (
  name, sku, slug, country_id, operator_id, sim_type, price, currency,
  short_description, full_description, characteristics, validity_days, data_volume, data_mb,
  is_unlimited, has_calls, calls_details, has_sms, sms_details, roaming_terms, activation_terms,
  compatibility, instructions, esim_type, esim_delivery_method, popular, tone, available,
  availability_status, stock_quantity, publication_status, seo_title, seo_description, h1,
  sort_order, archived_at, updated_at
)
VALUES
(
  'eSIM Orange Польша', 'PL-ORANGE-ESIM', 'esim-orange-poland',
  (SELECT id FROM countries WHERE slug='poland'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='poland' AND o.slug='orange'),
  'eSIM', NULL, 'USD', 'Профиль eSIM Orange для Польши. Сейчас отсутствует в продаже.',
  'В комплект входят QR-код для активации и служебные данные eSIM. Параметры тарифа и условия использования будут опубликованы после следующего поступления.',
  '{"Комплектация":"QR-код, PIN, PUK и данные eSIM"}'::jsonb, NULL, 'Не указан', NULL,
  FALSE, FALSE, NULL, FALSE, NULL, 'Перед покупкой проверьте поддержку Orange и условия роуминга в нужной стране.',
  'QR-код используется для установки профиля eSIM. Полные данные передаются после подтверждения оплаты.',
  'Требуется разблокированное устройство с поддержкой eSIM.', 'Инструкция по установке предоставляется вместе с данными eSIM.',
  'consumer', 'email', FALSE, 'from-[#ff7900] to-[#d85400]', FALSE, 'OUT_OF_STOCK', 0, 'PUBLISHED',
  'eSIM Orange Польша', 'eSIM Orange для Польши: комплектация, условия активации и наличие.', 'eSIM Orange Польша', 10, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM Silknet Грузия', 'GE-SILKNET-SPLUS', 'esim-silknet-georgia',
  (SELECT id FROM countries WHERE slug='georgia'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='georgia' AND o.slug='silknet'),
  'eSIM', 15, 'USD', 'eSIM Silknet с тарифом S+ и грузинским номером.',
  'В комплект входят QR-код для активации, PIN1, PUK1, данные eSIM и номер телефона. QR-код предназначен для одной установки.',
  '{"Тариф":"S+","Комплектация":"QR-код, PIN1, PUK1, данные eSIM и номер телефона","QR-код":"Одноразовая установка"}'::jsonb, NULL, 'Тариф S+', NULL,
  FALSE, TRUE, 'По условиям тарифа S+', TRUE, 'По условиям тарифа S+',
  'Перед покупкой проверьте покрытие Silknet и условия роуминга в нужной стране.',
  'QR-код можно использовать один раз. Устанавливайте профиль на устройство, которым планируете пользоваться.',
  'Требуется разблокированное устройство с поддержкой eSIM.', 'Данные и инструкция по установке отправляются после подтверждения оплаты.',
  'consumer', 'email', FALSE, 'from-[#7b2cff] to-[#4a1397]', TRUE, 'IN_STOCK', 9, 'PUBLISHED',
  'eSIM Silknet Грузия, тариф S+', 'eSIM Silknet с тарифом S+, грузинским номером и отправкой данных на email.', 'eSIM Silknet Грузия', 20, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM Cellfie Грузия', 'GE-CELLFIE-ESIM', 'esim-cellfie-georgia',
  (SELECT id FROM countries WHERE slug='georgia'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='georgia' AND o.slug='cellfie'),
  'eSIM', 20, 'USD', 'eSIM Cellfie с грузинским номером. Тариф выбирается отдельно.',
  'В комплект входят QR-код, PIN1, PIN2, PUK2 и номер телефона. Тарифный пакет выбирается и оплачивается отдельно у Cellfie.',
  '{"Комплектация":"QR-код, PIN1, PIN2, PUK2 и номер телефона","Тариф":"Выбирается отдельно у Cellfie","QR-код":"Одноразовая установка","Срок QR":"До 24.02.2027"}'::jsonb, NULL, 'Без включённого пакета', NULL,
  FALSE, FALSE, NULL, FALSE, NULL, 'Перед покупкой проверьте покрытие Cellfie и условия роуминга в нужной стране.',
  'QR-код можно использовать один раз. Указанный продавцом срок QR-кода: до 24.02.2027.',
  'Требуется разблокированное устройство с поддержкой eSIM.', 'После получения eSIM выберите подходящий тариф на официальном сайте Cellfie.',
  'consumer', 'email', TRUE, 'from-[#ec1b5f] to-[#9a0d43]', TRUE, 'IN_STOCK', 16, 'PUBLISHED',
  'eSIM Cellfie Грузия', 'eSIM Cellfie с грузинским номером. Тариф выбирается отдельно.', 'eSIM Cellfie Грузия', 30, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM T-Mobile Польша', 'PL-TMOBILE-ESIM', 'esim-t-mobile-poland',
  (SELECT id FROM countries WHERE slug='poland'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='poland' AND o.slug='t-mobile'),
  'eSIM', NULL, 'USD', 'Профиль eSIM T-Mobile для Польши. Сейчас отсутствует в продаже.',
  'В комплект входят QR-код для активации, PIN, PUK и служебные данные eSIM. Параметры тарифа будут опубликованы после следующего поступления.',
  '{"Комплектация":"QR-код, PIN, PUK и данные eSIM"}'::jsonb, NULL, 'Не указан', NULL,
  FALSE, FALSE, NULL, FALSE, NULL, 'Перед покупкой проверьте поддержку T-Mobile и условия роуминга в нужной стране.',
  'QR-код используется для установки профиля eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
  'Инструкция по установке предоставляется вместе с данными eSIM.', 'consumer', 'email', FALSE,
  'from-[#e20074] to-[#9b0050]', FALSE, 'OUT_OF_STOCK', 0, 'PUBLISHED',
  'eSIM T-Mobile Польша', 'eSIM T-Mobile для Польши: комплектация, условия активации и наличие.', 'eSIM T-Mobile Польша', 40, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM Plus Польша', 'PL-PLUS-ESIM', 'esim-plus-poland',
  (SELECT id FROM countries WHERE slug='poland'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='poland' AND o.slug='plus'),
  'eSIM', NULL, 'USD', 'Профиль eSIM Plus для Польши. Сейчас отсутствует в продаже.',
  'В комплект входят QR-код для активации, PIN, PUK и данные eSIM. Параметры тарифа будут опубликованы после следующего поступления.',
  '{"Комплектация":"QR-код, PIN, PUK и данные eSIM"}'::jsonb, NULL, 'Не указан', NULL,
  FALSE, FALSE, NULL, FALSE, NULL, 'Перед покупкой проверьте поддержку Plus и условия роуминга в нужной стране.',
  'QR-код используется для установки профиля eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
  'Инструкция по установке предоставляется вместе с данными eSIM.', 'consumer', 'email', FALSE,
  'from-[#79b928] to-[#377b19]', FALSE, 'OUT_OF_STOCK', 0, 'PUBLISHED',
  'eSIM Plus Польша', 'eSIM Plus для Польши: комплектация, условия активации и наличие.', 'eSIM Plus Польша', 50, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM Vodafone Испания', 'ES-VODAFONE-ESIM', 'esim-vodafone-spain',
  (SELECT id FROM countries WHERE slug='spain'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='spain' AND o.slug='vodafone'),
  'eSIM', 42, 'USD', 'eSIM Vodafone España с испанским номером +34.',
  'В комплект входят QR-код, PIN, PUK, данные eSIM и испанский номер +34. Условия звонков, SMS и роуминга зависят от подключённого тарифа.',
  '{"Комплектация":"QR-код, PIN, PUK, данные eSIM и номер +34","Регион":"Испания и роуминг по ЕС по условиям тарифа"}'::jsonb, NULL, 'По условиям тарифа', NULL,
  FALSE, TRUE, 'По условиям тарифа Vodafone', TRUE, 'По условиям тарифа Vodafone',
  'Перед покупкой проверьте покрытие Vodafone и условия роуминга в нужной стране.',
  'QR-код используется для установки профиля eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
  'Данные и инструкция по установке отправляются после подтверждения оплаты.', 'consumer', 'email', FALSE,
  'from-[#e60000] to-[#990000]', TRUE, 'IN_STOCK', 1, 'PUBLISHED',
  'eSIM Vodafone Испания с номером +34', 'eSIM Vodafone España с номером +34, данными активации и отправкой на email.', 'eSIM Vodafone Испания', 60, NULL, CURRENT_TIMESTAMP
),
(
  'eSIM Lyca Mobile Польша, 70 ГБ', 'PL-LYCA-70-30', 'esim-lyca-mobile-poland-70gb',
  (SELECT id FROM countries WHERE slug='poland'),
  (SELECT o.id FROM operators o JOIN countries c ON c.id=o.country_id WHERE c.slug='poland' AND o.slug='lyca-mobile'),
  'eSIM', NULL, 'USD', 'eSIM Lyca Mobile с пакетом 70 ГБ на 30 дней. Сейчас отсутствует в продаже.',
  'Тариф включает 70 ГБ на 30 дней, безлимитные звонки и SMS по Польше, а также 12,15 ГБ в роуминге по ЕС, Украине и Молдове. Первая активация должна выполняться в Польше.',
  '{"Комплектация":"QR-код, SM-DP+ Address, Activation Code, PIN, PUK, ICCID и ID активации","Первая активация":"В Польше","Роуминг":"12,15 ГБ по ЕС, Украине и Молдове"}'::jsonb, 30, '70 ГБ', 71680,
  FALSE, TRUE, 'Безлимитные звонки по Польше', TRUE, 'Безлимитные SMS по Польше',
  'В роуминге доступно 12,15 ГБ по ЕС, Украине и Молдове. Перед покупкой проверьте поддержку оператора в нужной стране.',
  'Первая активация должна быть выполнена в Польше.', 'Требуется разблокированное устройство с поддержкой eSIM.',
  'QR-код и данные для ручной установки отправляются после подтверждения оплаты.', 'consumer', 'email', FALSE,
  'from-[#169c47] to-[#0a5d2a]', FALSE, 'OUT_OF_STOCK', 0, 'PUBLISHED',
  'eSIM Lyca Mobile Польша, 70 ГБ на 30 дней', 'eSIM Lyca Mobile Польша: 70 ГБ, 30 дней, условия активации и роуминга.', 'eSIM Lyca Mobile Польша, 70 ГБ', 70, NULL, CURRENT_TIMESTAMP
)
ON CONFLICT (sku) DO UPDATE SET
  name=EXCLUDED.name, slug=EXCLUDED.slug, country_id=EXCLUDED.country_id, operator_id=EXCLUDED.operator_id,
  sim_type=EXCLUDED.sim_type, price=EXCLUDED.price, currency=EXCLUDED.currency,
  short_description=EXCLUDED.short_description, full_description=EXCLUDED.full_description,
  characteristics=EXCLUDED.characteristics, validity_days=EXCLUDED.validity_days, data_volume=EXCLUDED.data_volume,
  data_mb=EXCLUDED.data_mb, is_unlimited=EXCLUDED.is_unlimited, has_calls=EXCLUDED.has_calls,
  calls_details=EXCLUDED.calls_details, has_sms=EXCLUDED.has_sms, sms_details=EXCLUDED.sms_details,
  roaming_terms=EXCLUDED.roaming_terms, activation_terms=EXCLUDED.activation_terms,
  compatibility=EXCLUDED.compatibility, instructions=EXCLUDED.instructions, esim_type=EXCLUDED.esim_type,
  esim_delivery_method=EXCLUDED.esim_delivery_method, popular=EXCLUDED.popular, tone=EXCLUDED.tone,
  available=EXCLUDED.available, availability_status=EXCLUDED.availability_status,
  stock_quantity=EXCLUDED.stock_quantity, publication_status='PUBLISHED', seo_title=EXCLUDED.seo_title,
  seo_description=EXCLUDED.seo_description, h1=EXCLUDED.h1, sort_order=EXCLUDED.sort_order,
  archived_at=NULL, updated_at=CURRENT_TIMESTAMP;

INSERT INTO product_categories (product_id, category_id)
SELECT id, 'esim' FROM products WHERE sku IN (
  'PL-ORANGE-ESIM','GE-SILKNET-SPLUS','GE-CELLFIE-ESIM','PL-TMOBILE-ESIM',
  'PL-PLUS-ESIM','ES-VODAFONE-ESIM','PL-LYCA-70-30'
)
ON CONFLICT DO NOTHING;

UPDATE products
SET publication_status='ARCHIVED', archived_at=CURRENT_TIMESTAMP, available=FALSE,
    availability_status='OUT_OF_STOCK', updated_at=CURRENT_TIMESTAMP
WHERE sku LIKE 'DEMO-%';

UPDATE categories
SET is_published=FALSE, noindex=TRUE, archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
WHERE id LIKE 'demo-%';

SELECT setval(pg_get_serial_sequence('countries', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM countries), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('operators', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM operators), 1), 1), TRUE);
SELECT setval(pg_get_serial_sequence('products', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM products), 1), 1), TRUE);

COMMIT;

