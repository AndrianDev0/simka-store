BEGIN;

-- Only revise imported copy that still matches the audited wording.
UPDATE products SET full_description = replace(full_description,
  'Параметры тарифа и условия использования будут опубликованы после следующего поступления.',
  'Сейчас нет в наличии. Условия поступления уточняйте у поддержки.'), updated_at = CURRENT_TIMESTAMP
WHERE sku = 'PL-ORANGE-ESIM'
  AND full_description LIKE '%Параметры тарифа и условия использования будут опубликованы после следующего поступления.%';

UPDATE products SET full_description = replace(full_description,
  'Параметры тарифа будут опубликованы после следующего поступления.',
  'Сейчас нет в наличии. Условия поступления уточняйте у поддержки.'), updated_at = CURRENT_TIMESTAMP
WHERE sku IN ('PL-PLUS-ESIM', 'PL-TMOBILE-ESIM')
  AND full_description LIKE '%Параметры тарифа будут опубликованы после следующего поступления.%';

UPDATE products SET calls_details = 'Зависят от выбранного тарифа', updated_at = CURRENT_TIMESTAMP
WHERE sku = 'GE-CELLFIE-ESIM' AND calls_details IS NULL;
UPDATE products SET sms_details = 'Зависят от выбранного тарифа', updated_at = CURRENT_TIMESTAMP
WHERE sku = 'GE-CELLFIE-ESIM' AND sms_details IS NULL;

COMMIT;
