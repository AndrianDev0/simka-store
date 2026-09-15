import pg from "pg";

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL is not configured");
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_contact TEXT NOT NULL DEFAULT '',
      delivery_address TEXT,
      customer_comment TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL CHECK (payment_method IN ('crypto', 'manager')),
      status TEXT NOT NULL CHECK (status IN ('NEW', 'WAITING_FOR_MANAGER', 'WAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED')),
      total_amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE;

    -- Older deploys used a three-state check. Replace it with the extensible workflow.
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('NEW', 'WAITING_FOR_MANAGER', 'WAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'));

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sim_type TEXT NOT NULL CHECK (sim_type IN ('eSIM', 'SIM')),
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      line_total INTEGER NOT NULL
    );
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS countries (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      iso_code TEXT,
      flag TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      seo_title TEXT,
      seo_description TEXT,
      h1 TEXT,
      seo_text TEXT,
      canonical_url TEXT,
      faq JSONB NOT NULL DEFAULT '[]'::jsonb,
      publication_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
      noindex BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_countries_slug ON countries(slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_countries_iso_code ON countries(iso_code);
    CREATE INDEX IF NOT EXISTS idx_countries_publication_order ON countries(publication_status, archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS operators (
      id SERIAL PRIMARY KEY,
      country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      publication_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_country_slug ON operators(country_id, slug);
    CREATE INDEX IF NOT EXISTS idx_operators_country_publication ON operators(country_id, publication_status, sort_order);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      seo_title TEXT,
      seo_description TEXT,
      h1 TEXT,
      seo_text TEXT,
      canonical_url TEXT,
      og_title TEXT,
      og_description TEXT,
      og_image TEXT,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      noindex BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
    CREATE INDEX IF NOT EXISTS idx_categories_parent_order ON categories(parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_categories_published_order ON categories(is_published, archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      slug TEXT NOT NULL,
      country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
      operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
      sim_type TEXT NOT NULL CHECK (sim_type IN ('eSIM', 'SIM')),
      price INTEGER NOT NULL CHECK (price >= 0),
      old_price INTEGER CHECK (old_price IS NULL OR old_price >= 0),
      currency TEXT NOT NULL DEFAULT 'RUB',
      short_description TEXT NOT NULL DEFAULT '',
      full_description TEXT NOT NULL DEFAULT '',
      characteristics JSONB NOT NULL DEFAULT '{}'::jsonb,
      validity_days INTEGER NOT NULL CHECK (validity_days > 0),
      data_volume TEXT NOT NULL,
      data_mb INTEGER CHECK (data_mb IS NULL OR data_mb >= 0),
      is_unlimited BOOLEAN NOT NULL DEFAULT FALSE,
      has_calls BOOLEAN NOT NULL DEFAULT FALSE,
      calls_details TEXT,
      has_sms BOOLEAN NOT NULL DEFAULT FALSE,
      sms_details TEXT,
      roaming_terms TEXT NOT NULL DEFAULT '',
      activation_terms TEXT NOT NULL DEFAULT '',
      compatibility TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      popular BOOLEAN NOT NULL DEFAULT FALSE,
      tone TEXT NOT NULL DEFAULT 'from-[#1679f2] to-[#0d46ad]',
      available BOOLEAN NOT NULL DEFAULT FALSE,
      availability_status TEXT NOT NULL DEFAULT 'OUT_OF_STOCK' CHECK (availability_status IN ('IN_STOCK', 'OUT_OF_STOCK', 'PREORDER')),
      stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
      publication_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (publication_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
      seo_title TEXT,
      seo_description TEXT,
      h1 TEXT,
      seo_text TEXT,
      canonical_url TEXT,
      og_title TEXT,
      og_description TEXT,
      og_image TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_products_publication_order ON products(publication_status, archived_at, sort_order);
    CREATE INDEX IF NOT EXISTS idx_products_catalog_filters ON products(country_id, operator_id, sim_type, available);
    CREATE INDEX IF NOT EXISTS idx_products_price_validity_data ON products(price, validity_days, data_mb);

    CREATE TABLE IF NOT EXISTS product_variants (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      slug TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      currency TEXT NOT NULL DEFAULT 'RUB',
      data_volume TEXT,
      validity_days INTEGER CHECK (validity_days IS NULL OR validity_days > 0),
      characteristics JSONB NOT NULL DEFAULT '{}'::jsonb,
      available BOOLEAN NOT NULL DEFAULT FALSE,
      availability_status TEXT NOT NULL DEFAULT 'OUT_OF_STOCK' CHECK (availability_status IN ('IN_STOCK', 'OUT_OF_STOCK', 'PREORDER')),
      stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_slug ON product_variants(slug);
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_order ON product_variants(product_id, sort_order);

    CREATE TABLE IF NOT EXISTS product_images (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      alt TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_product_url ON product_images(product_id, url);
    CREATE INDEX IF NOT EXISTS idx_product_images_product_order ON product_images(product_id, sort_order);

    CREATE TABLE IF NOT EXISTS product_categories (
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (product_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_categories_category_id ON product_categories(category_id);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      admin_telegram_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at);

    CREATE TABLE IF NOT EXISTS seo_redirects (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('category', 'country', 'product')),
      entity_id TEXT NOT NULL,
      old_slug TEXT NOT NULL,
      new_slug TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_redirects_entity_old_slug ON seo_redirects(entity_type, old_slug);
    CREATE INDEX IF NOT EXISTS idx_seo_redirects_entity_id ON seo_redirects(entity_type, entity_id);
  `);

  // Existing category tables predate hierarchy. The named constraint is added
  // separately so restarting the service remains idempotent.
  await client.query(`
    DO $catalog$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'categories_parent_id_fkey'
      ) THEN
        ALTER TABLE categories
          ADD CONSTRAINT categories_parent_id_fkey
          FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE RESTRICT;
      END IF;
    END
    $catalog$;
  `);

  await client.query(`
    INSERT INTO countries (id, name, slug, iso_code, flag, region, description, publication_status, noindex, sort_order)
    VALUES
      (1, 'Турция', 'turkey', 'TR', '🇹🇷', 'Европа', 'SIM и eSIM для поездок в Турцию.', 'PUBLISHED', FALSE, 10),
      (2, 'Таиланд', 'thailand', 'TH', '🇹🇭', 'Азия', 'SIM и eSIM для поездок в Таиланд.', 'PUBLISHED', FALSE, 20),
      (3, 'ОАЭ', 'uae', 'AE', '🇦🇪', 'Ближний Восток', 'SIM и eSIM для поездок в ОАЭ.', 'PUBLISHED', FALSE, 30),
      (4, 'Германия', 'germany', 'DE', '🇩🇪', 'Европа', 'SIM и eSIM для поездок в Германию.', 'PUBLISHED', FALSE, 40),
      (5, 'США', 'usa', 'US', '🇺🇸', 'Америка', 'SIM и eSIM для поездок в США.', 'PUBLISHED', FALSE, 50),
      (6, 'Япония', 'japan', 'JP', '🇯🇵', 'Азия', 'SIM и eSIM для поездок в Японию.', 'PUBLISHED', FALSE, 60)
    ON CONFLICT DO NOTHING;

    INSERT INTO operators (id, country_id, name, slug, publication_status, sort_order)
    VALUES
      (1, 1, 'Turkcell', 'turkcell', 'PUBLISHED', 10),
      (2, 2, 'AIS', 'ais', 'PUBLISHED', 20),
      (3, 3, 'du', 'du', 'PUBLISHED', 30),
      (4, 4, 'O2', 'o2', 'PUBLISHED', 40),
      (5, 5, 'T-Mobile', 't-mobile', 'PUBLISHED', 50),
      (6, 6, 'KDDI', 'kddi', 'PUBLISHED', 60)
    ON CONFLICT DO NOTHING;

    UPDATE countries AS country
    SET
      seo_title = COALESCE(country.seo_title, seed.seo_title),
      seo_description = COALESCE(country.seo_description, seed.seo_description),
      h1 = COALESCE(country.h1, seed.h1),
      seo_text = COALESCE(country.seo_text, seed.seo_text)
    FROM (VALUES
      (1, 'Турция: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в Турцию: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для Турции', 'На странице собраны доступные тарифы для поездки в Турцию. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.'),
      (2, 'Таиланд: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в Таиланд: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для Таиланда', 'На странице собраны доступные тарифы для поездки в Таиланд. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.'),
      (3, 'ОАЭ: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в ОАЭ: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для ОАЭ', 'На странице собраны доступные тарифы для поездки в ОАЭ. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.'),
      (4, 'Германия: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в Германию: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для Германии', 'На странице собраны доступные тарифы для поездки в Германию. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.'),
      (5, 'США: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в США: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для США', 'На странице собраны доступные тарифы для поездки в США. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.'),
      (6, 'Япония: eSIM и SIM для путешествий', 'Сравните опубликованные SIM и eSIM для поездки в Японию: операторы, объём интернета, срок действия, цены и наличие.', 'SIM и eSIM для Японии', 'На странице собраны доступные тарифы для поездки в Японию. Сравните формат SIM, оператора, пакет интернета, срок действия и условия активации до оформления заказа.')
    ) AS seed(id, seo_title, seo_description, h1, seo_text)
    WHERE country.id = seed.id;
  `);

  await client.query(`
    INSERT INTO products (
      id, name, sku, slug, country_id, operator_id, sim_type, price, old_price, currency,
      short_description, full_description, characteristics, validity_days, data_volume, data_mb,
      is_unlimited, has_calls, calls_details, has_sms, sms_details, roaming_terms, activation_terms,
      compatibility, instructions, popular, tone, available, availability_status, stock_quantity,
      publication_status, seo_title, seo_description, h1, seo_text, canonical_url, og_title,
      og_description, og_image, sort_order
    ) VALUES
      (1, 'Турция · 20 ГБ · 30 дней', 'TR-ESIM-20-30', 'turkey-turkcell-20gb', 1, 1, 'eSIM', 2490, 2890, 'RUB',
       'eSIM оператора Turkcell для поездки в Турцию.', 'eSIM оператора Turkcell для поездки в Турцию. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Европа', 'operator', 'Turkcell', 'data', '20 ГБ', 'validityDays', 30), 30, '20 ГБ', 20480,
       FALSE, FALSE, NULL, FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
       'Инструкция предоставляется после подтверждения оплаты.', TRUE, 'from-[#1679f2] to-[#0d46ad]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'Турция: 20 ГБ на 30 дней — SIMKA', 'eSIM Turkcell для Турции: 20 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.', 'Турция · 20 ГБ · 30 дней', NULL,
       NULL, 'Турция: 20 ГБ на 30 дней — SIMKA',
       'eSIM Turkcell для Турции: 20 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.', NULL, 10),

      (2, 'Таиланд · Безлимит · 15 дней', 'TH-ESIM-UNL-15', 'thailand-ais-unlimited', 2, 2, 'eSIM', 3190, NULL, 'RUB',
       'eSIM оператора AIS для поездки в Таиланд.', 'eSIM оператора AIS для поездки в Таиланд. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Азия', 'operator', 'AIS', 'data', 'Безлимит', 'validityDays', 15), 15, 'Безлимит', NULL,
       TRUE, TRUE, '15 минут', FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
       'Инструкция предоставляется после подтверждения оплаты.', FALSE, 'from-[#7047eb] to-[#4020a7]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'Таиланд: Безлимит на 15 дней — SIMKA', 'eSIM AIS для Таиланда: безлимитный интернет на 15 дней. Условия активации, совместимость, цена и наличие.', 'Таиланд · Безлимит · 15 дней', NULL,
       NULL, 'Таиланд: Безлимит на 15 дней — SIMKA',
       'eSIM AIS для Таиланда: безлимитный интернет на 15 дней. Условия активации, совместимость, цена и наличие.', NULL, 20),

      (3, 'ОАЭ · 10 ГБ · 28 дней', 'AE-SIM-10-28', 'uae-du-10gb', 3, 3, 'SIM', 3590, NULL, 'RUB',
       'SIM оператора du для поездки в ОАЭ.', 'SIM оператора du для поездки в ОАЭ. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Ближний Восток', 'operator', 'du', 'data', '10 ГБ', 'validityDays', 28), 28, '10 ГБ', 10240,
       FALSE, TRUE, '30 минут', FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с подходящим SIM-слотом.',
       'Инструкция предоставляется после подтверждения оплаты.', FALSE, 'from-[#ef6a39] to-[#bb2c21]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'ОАЭ: 10 ГБ на 28 дней — SIMKA', 'SIM du для ОАЭ: 10 ГБ на 28 дней. Звонки, условия активации, доставка, цена и наличие в карточке тарифа.', 'ОАЭ · 10 ГБ · 28 дней', NULL,
       NULL, 'ОАЭ: 10 ГБ на 28 дней — SIMKA',
       'SIM du для ОАЭ: 10 ГБ на 28 дней. Звонки, условия активации, доставка, цена и наличие в карточке тарифа.', NULL, 30),

      (4, 'Германия · 30 ГБ · 30 дней', 'DE-ESIM-30-30', 'germany-o2-30gb', 4, 4, 'eSIM', 2790, NULL, 'RUB',
       'eSIM оператора O2 для поездки в Германию.', 'eSIM оператора O2 для поездки в Германию. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Европа', 'operator', 'O2', 'data', '30 ГБ', 'validityDays', 30), 30, '30 ГБ', 30720,
       FALSE, FALSE, NULL, FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
       'Инструкция предоставляется после подтверждения оплаты.', TRUE, 'from-[#10a985] to-[#08705c]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'Германия: 30 ГБ на 30 дней — SIMKA', 'eSIM O2 для Германии: 30 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.', 'Германия · 30 ГБ · 30 дней', NULL,
       NULL, 'Германия: 30 ГБ на 30 дней — SIMKA',
       'eSIM O2 для Германии: 30 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.', NULL, 40),

      (5, 'США · 20 ГБ · 30 дней', 'US-ESIM-20-30', 'usa-tmobile-20gb', 5, 5, 'eSIM', 3990, NULL, 'RUB',
       'eSIM оператора T-Mobile для поездки в США.', 'eSIM оператора T-Mobile для поездки в США. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Америка', 'operator', 'T-Mobile', 'data', '20 ГБ', 'validityDays', 30), 30, '20 ГБ', 20480,
       FALSE, TRUE, 'Безлимит', FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с поддержкой eSIM.',
       'Инструкция предоставляется после подтверждения оплаты.', FALSE, 'from-[#ef3f92] to-[#a20d5d]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'США: 20 ГБ на 30 дней — SIMKA', 'eSIM T-Mobile для США: 20 ГБ на 30 дней. Звонки, активация, совместимость, цена и наличие в карточке.', 'США · 20 ГБ · 30 дней', NULL,
       NULL, 'США: 20 ГБ на 30 дней — SIMKA',
       'eSIM T-Mobile для США: 20 ГБ на 30 дней. Звонки, активация, совместимость, цена и наличие в карточке.', NULL, 50),

      (6, 'Япония · 15 ГБ · 16 дней', 'JP-SIM-15-16', 'japan-kddi-15gb', 6, 6, 'SIM', 2890, NULL, 'RUB',
       'SIM оператора KDDI для поездки в Японию.', 'SIM оператора KDDI для поездки в Японию. Точные условия использования подтверждаются перед оплатой.',
       jsonb_build_object('region', 'Азия', 'operator', 'KDDI', 'data', '15 ГБ', 'validityDays', 16), 16, '15 ГБ', 15360,
       FALSE, FALSE, NULL, FALSE, NULL, 'Условия использования за пределами указанной страны уточняются перед оплатой.',
       'Активация выполняется по инструкции после получения SIM или eSIM.', 'Требуется разблокированное устройство с подходящим SIM-слотом.',
       'Инструкция предоставляется после подтверждения оплаты.', FALSE, 'from-[#27344a] to-[#111827]', TRUE, 'IN_STOCK', NULL, 'PUBLISHED',
       'Япония: 15 ГБ на 16 дней — SIMKA', 'SIM KDDI для Японии: 15 ГБ на 16 дней. Условия активации, доставка, цена и наличие в карточке тарифа.', 'Япония · 15 ГБ · 16 дней', NULL,
       NULL, 'Япония: 15 ГБ на 16 дней — SIMKA',
       'SIM KDDI для Японии: 15 ГБ на 16 дней. Условия активации, доставка, цена и наличие в карточке тарифа.', NULL, 60)
    ON CONFLICT DO NOTHING;

    UPDATE products AS product
    SET seo_description = seed.new_description
    FROM (VALUES
      (1, 'eSIM оператора Turkcell: 20 ГБ, срок действия 30 дней.', 'eSIM Turkcell для Турции: 20 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.'),
      (2, 'eSIM оператора AIS: Безлимит, срок действия 15 дней.', 'eSIM AIS для Таиланда: безлимитный интернет на 15 дней. Условия активации, совместимость, цена и наличие.'),
      (3, 'SIM оператора du: 10 ГБ, срок действия 28 дней.', 'SIM du для ОАЭ: 10 ГБ на 28 дней. Звонки, условия активации, доставка, цена и наличие в карточке тарифа.'),
      (4, 'eSIM оператора O2: 30 ГБ, срок действия 30 дней.', 'eSIM O2 для Германии: 30 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.'),
      (5, 'eSIM оператора T-Mobile: 20 ГБ, срок действия 30 дней.', 'eSIM T-Mobile для США: 20 ГБ на 30 дней. Звонки, активация, совместимость, цена и наличие в карточке.'),
      (6, 'SIM оператора KDDI: 15 ГБ, срок действия 16 дней.', 'SIM KDDI для Японии: 15 ГБ на 16 дней. Условия активации, доставка, цена и наличие в карточке тарифа.')
    ) AS seed(id, old_description, new_description)
    WHERE product.id = seed.id AND (product.seo_description IS NULL OR product.seo_description = seed.old_description);

    UPDATE products AS product
    SET og_description = seed.new_description
    FROM (VALUES
      (1, 'eSIM оператора Turkcell: 20 ГБ, срок действия 30 дней.', 'eSIM Turkcell для Турции: 20 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.'),
      (2, 'eSIM оператора AIS: Безлимит, срок действия 15 дней.', 'eSIM AIS для Таиланда: безлимитный интернет на 15 дней. Условия активации, совместимость, цена и наличие.'),
      (3, 'SIM оператора du: 10 ГБ, срок действия 28 дней.', 'SIM du для ОАЭ: 10 ГБ на 28 дней. Звонки, условия активации, доставка, цена и наличие в карточке тарифа.'),
      (4, 'eSIM оператора O2: 30 ГБ, срок действия 30 дней.', 'eSIM O2 для Германии: 30 ГБ на 30 дней. Условия активации, совместимость, цена и наличие в карточке тарифа.'),
      (5, 'eSIM оператора T-Mobile: 20 ГБ, срок действия 30 дней.', 'eSIM T-Mobile для США: 20 ГБ на 30 дней. Звонки, активация, совместимость, цена и наличие в карточке.'),
      (6, 'SIM оператора KDDI: 15 ГБ, срок действия 16 дней.', 'SIM KDDI для Японии: 15 ГБ на 16 дней. Условия активации, доставка, цена и наличие в карточке тарифа.')
    ) AS seed(id, old_description, new_description)
    WHERE product.id = seed.id AND (product.og_description IS NULL OR product.og_description = seed.old_description);

    INSERT INTO product_variants (
      id, product_id, name, sku, slug, price, currency, data_volume, validity_days,
      characteristics, available, availability_status, stock_quantity, sort_order
    )
    SELECT
      id, id, 'Основной вариант', sku, slug || '-default', price, currency, data_volume,
      validity_days, '{}'::jsonb, available, availability_status, stock_quantity, 0
    FROM products
    WHERE id BETWEEN 1 AND 6
    ON CONFLICT DO NOTHING;

    SELECT setval(pg_get_serial_sequence('countries', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM countries), 1), 1), TRUE);
    SELECT setval(pg_get_serial_sequence('operators', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM operators), 1), 1), TRUE);
    SELECT setval(pg_get_serial_sequence('products', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM products), 1), 1), TRUE);
    SELECT setval(pg_get_serial_sequence('product_variants', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM product_variants), 1), 1), TRUE);
  `);

  // Existing deployments did not have a product FK. NOT VALID protects startup
  // from legacy orphan rows while enforcing the relationship for all new data.
  await client.query(`
    DO $catalog$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_categories_product_id_fkey'
      ) THEN
        ALTER TABLE product_categories
          ADD CONSTRAINT product_categories_product_id_fkey
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT NOT VALID;
      END IF;
    END
    $catalog$;
  `);

  await client.query("COMMIT");
  console.log("Postgres schema ready");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
