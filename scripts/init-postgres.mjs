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
    DO $do$
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_trgm is unavailable; catalog search will work without trigram acceleration';
    END
    $do$;

    CREATE TABLE IF NOT EXISTS customer_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      partner_code TEXT,
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      blocked_at TEXT,
      blocked_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS blocked_at TEXT;
    ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
    ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS partner_code TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_accounts_email ON customer_accounts(email);
    CREATE INDEX IF NOT EXISTS idx_customer_accounts_partner_code ON customer_accounts(partner_code);

    CREATE TABLE IF NOT EXISTS customer_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_sessions_token_hash ON customer_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_account_id ON customer_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expires_at ON customer_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS customer_password_resets (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_password_resets_token_hash ON customer_password_resets(token_hash);
    CREATE INDEX IF NOT EXISTS idx_customer_password_resets_account_id ON customer_password_resets(account_id);

    CREATE TABLE IF NOT EXISTS privacy_consent_events (
      id TEXT PRIMARY KEY,
      consent_id TEXT NOT NULL,
      account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL,
      decision TEXT NOT NULL CHECK (decision IN ('accepted', 'declined', 'withdrawn')),
      source TEXT NOT NULL CHECK (source IN ('banner', 'settings')),
      policy_version TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_privacy_consent_events_consent_id ON privacy_consent_events(consent_id);
    CREATE INDEX IF NOT EXISTS idx_privacy_consent_events_account_id ON privacy_consent_events(account_id);
    CREATE INDEX IF NOT EXISTS idx_privacy_consent_events_created_at ON privacy_consent_events(created_at);

    CREATE TABLE IF NOT EXISTS analytics_visitors (
      client_id TEXT PRIMARY KEY,
      account_id TEXT REFERENCES customer_accounts(id) ON DELETE CASCADE,
      first_source TEXT,
      first_medium TEXT,
      first_campaign TEXT,
      first_referrer_host TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      sessions_count INTEGER NOT NULL DEFAULT 0 CHECK (sessions_count >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_visitors_account_id ON analytics_visitors(account_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_visitors_last_seen_at ON analytics_visitors(last_seen_at);

    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES analytics_visitors(client_id) ON DELETE CASCADE,
      entry_path TEXT NOT NULL,
      exit_path TEXT NOT NULL,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      content TEXT,
      term TEXT,
      referrer_host TEXT,
      device_type TEXT NOT NULL,
      operating_system TEXT NOT NULL,
      browser TEXT NOT NULL,
      country_code TEXT,
      region TEXT,
      city TEXT,
      language TEXT,
      timezone TEXT,
      screen_width INTEGER,
      screen_height INTEGER,
      viewport_width INTEGER,
      viewport_height INTEGER,
      pixel_ratio_x100 INTEGER,
      connection_type TEXT,
      page_views INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      CONSTRAINT analytics_sessions_counts_nonnegative CHECK (page_views >= 0 AND event_count >= 0)
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_client_started ON analytics_sessions(client_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen_at ON analytics_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_source_started ON analytics_sessions(source, started_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES analytics_visitors(client_id) ON DELETE CASCADE,
      account_id TEXT REFERENCES customer_accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      params JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session_time ON analytics_events(session_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_client_time ON analytics_events(client_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_account_time ON analytics_events(account_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time ON analytics_events(name, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_path_time ON analytics_events(path, occurred_at);
    DELETE FROM analytics_events WHERE created_at::timestamptz < NOW() - INTERVAL '400 days';
    DELETE FROM analytics_sessions WHERE last_seen_at::timestamptz < NOW() - INTERVAL '400 days';
    DELETE FROM analytics_visitors WHERE last_seen_at::timestamptz < NOW() - INTERVAL '400 days';

    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
      discount_value INTEGER NOT NULL CHECK (discount_value > 0),
      currency TEXT NOT NULL DEFAULT 'RUB',
      min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
      usage_limit INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TEXT,
      ends_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT promo_codes_percent_below_100 CHECK (discount_type <> 'percent' OR discount_value < 100)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
    CREATE INDEX IF NOT EXISTS idx_promo_codes_active_dates ON promo_codes(active, starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps >= 0 AND commission_bps <= 10000),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_code ON partners(code);
    CREATE INDEX IF NOT EXISTS idx_partners_active_created_at ON partners(active, created_at);

    CREATE TABLE IF NOT EXISTS partner_clicks (
      id TEXT PRIMARY KEY,
      partner_code TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      click_count INTEGER NOT NULL DEFAULT 1 CHECK (click_count > 0),
      landing_path TEXT NOT NULL DEFAULT '/',
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_clicks_partner_visitor ON partner_clicks(partner_code, visitor_hash);
    CREATE INDEX IF NOT EXISTS idx_partner_clicks_last_seen_at ON partner_clicks(last_seen_at);
    DELETE FROM partner_clicks WHERE last_seen_at::timestamptz < NOW() - INTERVAL '365 days';

    CREATE TABLE IF NOT EXISTS marketing_costs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, campaign TEXT, amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'RUB', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_marketing_costs_period ON marketing_costs(starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_marketing_costs_source_campaign ON marketing_costs(source, campaign);

    CREATE TABLE IF NOT EXISTS request_rate_limits (
      key TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      window_started_at TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_request_rate_limits_updated_at ON request_rate_limits(updated_at);

    -- Expired authentication artifacts are not useful business records. Cleanup
    -- on every deploy keeps their retention bounded without a separate cron job.
    DELETE FROM customer_sessions WHERE expires_at::timestamptz < NOW();
    DELETE FROM customer_password_resets WHERE expires_at::timestamptz < NOW();
    DELETE FROM request_rate_limits WHERE updated_at::timestamptz < NOW() - INTERVAL '7 days';

    CREATE TABLE IF NOT EXISTS operational_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
      area TEXT NOT NULL,
      path TEXT NOT NULL,
      code TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operational_events_last_seen_at ON operational_events(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_operational_events_kind_last_seen ON operational_events(kind, last_seen_at);
    DELETE FROM operational_events WHERE last_seen_at::timestamptz < NOW() - INTERVAL '90 days';

    CREATE TABLE IF NOT EXISTS search_analytics (
      id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      query TEXT NOT NULL,
      searches INTEGER NOT NULL DEFAULT 1 CHECK (searches > 0),
      no_result_searches INTEGER NOT NULL DEFAULT 0 CHECK (no_result_searches >= 0),
      total_results INTEGER NOT NULL DEFAULT 0 CHECK (total_results >= 0),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_search_analytics_last_seen_at ON search_analytics(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_search_analytics_query ON search_analytics(query);
    DELETE FROM search_analytics WHERE last_seen_at::timestamptz < NOW() - INTERVAL '365 days';

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      order_number TEXT NOT NULL,
      customer_account_id TEXT CONSTRAINT orders_customer_account_id_fkey REFERENCES customer_accounts(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_contact TEXT NOT NULL DEFAULT '',
      delivery_address TEXT,
      customer_comment TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL CHECK (payment_method IN ('crypto', 'manager')),
      status TEXT NOT NULL CHECK (status IN ('NEW', 'WAITING_FOR_MANAGER', 'WAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED')),
      subtotal_amount INTEGER NOT NULL DEFAULT 0,
      promo_code TEXT,
      partner_code TEXT,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      delivery_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE,
      payment_instructions_sent_at TEXT,
      paid_at TEXT,
      refunded_at TEXT,
      partner_commission_bps_snapshot INTEGER CHECK (partner_commission_bps_snapshot IS NULL OR (partner_commission_bps_snapshot >= 0 AND partner_commission_bps_snapshot <= 10000)),
      delivery_expense_amount INTEGER CHECK (delivery_expense_amount IS NULL OR delivery_expense_amount >= 0),
      payment_fee_amount INTEGER CHECK (payment_fee_amount IS NULL OR payment_fee_amount >= 0),
      other_expense_amount INTEGER CHECK (other_expense_amount IS NULL OR other_expense_amount >= 0),
      analytics_client_id TEXT,
      analytics_source TEXT,
      analytics_medium TEXT,
      analytics_campaign TEXT,
      analytics_content TEXT,
      analytics_term TEXT,
      first_party_client_id TEXT,
      analytics_purchase_sent_at TEXT,
      analytics_cancellation_sent_at TEXT,
      analytics_refund_sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_account_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_code TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_amount INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_instructions_sent_at TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS partner_commission_bps_snapshot INTEGER;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_expense_amount INTEGER;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_fee_amount INTEGER;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS other_expense_amount INTEGER;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_client_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_source TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_medium TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_campaign TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_content TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_term TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS first_party_client_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_purchase_sent_at TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_cancellation_sent_at TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS analytics_refund_sent_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_orders_customer_account_id ON orders(customer_account_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at);
    CREATE INDEX IF NOT EXISTS idx_orders_refunded_at ON orders(refunded_at);
    CREATE INDEX IF NOT EXISTS idx_orders_partner_code ON orders(partner_code);
    CREATE INDEX IF NOT EXISTS idx_orders_first_party_client_id ON orders(first_party_client_id);

    -- Statuses intentionally remain text so the workflow can be extended without
    -- a destructive migration or a production restart race.
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sim_type TEXT NOT NULL CHECK (sim_type IN ('eSIM', 'SIM')),
      unit_price INTEGER NOT NULL,
      unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
      quantity INTEGER NOT NULL,
      line_total INTEGER NOT NULL,
      fulfillment_status TEXT NOT NULL DEFAULT 'PENDING',
      delivery_method TEXT,
      delivery_cost INTEGER NOT NULL DEFAULT 0,
      delivery_cost_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      tracking_number TEXT,
      tracking_url TEXT,
      activation_code_encrypted TEXT,
      fulfillment_instructions TEXT,
      fulfilled_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INTEGER;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost INTEGER;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'PENDING';
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivery_method TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivery_cost INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS delivery_cost_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_number TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS tracking_url TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS activation_code_encrypted TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_instructions TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfilled_at TEXT;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_fulfillment_status ON order_items(fulfillment_status);

    CREATE TABLE IF NOT EXISTS crypto_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'CREATING',
      checkout_url TEXT,
      requested_amount INTEGER NOT NULL CHECK (requested_amount > 0),
      requested_currency TEXT NOT NULL,
      received_amount INTEGER CHECK (received_amount IS NULL OR received_amount >= 0),
      received_currency TEXT,
      transaction_id TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payments_provider_payment ON crypto_payments(provider, provider_payment_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payments_provider_transaction ON crypto_payments(provider, transaction_id);
    CREATE INDEX IF NOT EXISTS idx_crypto_payments_status ON crypto_payments(status);

    CREATE TABLE IF NOT EXISTS crypto_payment_events (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      crypto_payment_id TEXT NOT NULL REFERENCES crypto_payments(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crypto_payment_events_provider_event ON crypto_payment_events(provider, provider_event_id);
    CREATE INDEX IF NOT EXISTS idx_crypto_payment_events_payment_id ON crypto_payment_events(crypto_payment_id);

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
      unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
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
      esim_type TEXT,
      esim_delivery_method TEXT,
      delivery_options JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    ALTER TABLE products ADD COLUMN IF NOT EXISTS esim_type TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS esim_delivery_method TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_options JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_cost INTEGER;

    CREATE TABLE IF NOT EXISTS product_variants (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      slug TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
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
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS unit_cost INTEGER;

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

    DO $do$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON products USING GIN (sku gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_products_slug_trgm ON products USING GIN (slug gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_products_short_description_trgm ON products USING GIN (short_description gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_countries_name_trgm ON countries USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_countries_slug_trgm ON countries USING GIN (slug gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_countries_region_trgm ON countries USING GIN (region gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_operators_name_trgm ON operators USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_operators_slug_trgm ON operators USING GIN (slug gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_categories_slug_trgm ON categories USING GIN (slug gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_product_variants_name_trgm ON product_variants USING GIN (name gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_product_variants_sku_trgm ON product_variants USING GIN (sku gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_product_variants_data_trgm ON product_variants USING GIN (data_volume gin_trgm_ops);
      END IF;
    END
    $do$;

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

    -- Recover payment timestamps where historic evidence exists. Older orders
    -- without a payment event remain NULL rather than claiming a guessed time.
    WITH recovered AS (
      SELECT o.id, COALESCE(
        (SELECT cp.paid_at FROM crypto_payments AS cp WHERE cp.order_id = o.id AND cp.paid_at IS NOT NULL LIMIT 1),
        (SELECT a.created_at FROM admin_audit_log AS a WHERE a.entity_type = 'order' AND a.entity_id = o.id AND a.action IN ('order.paid_confirm', 'order.payment_confirmed') ORDER BY a.created_at ASC LIMIT 1),
        o.analytics_purchase_sent_at
      ) AS recovered_paid_at
      FROM orders AS o
      WHERE o.paid_at IS NULL AND o.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
    )
    UPDATE orders AS o SET paid_at = recovered.recovered_paid_at
    FROM recovered WHERE o.id = recovered.id AND recovered.recovered_paid_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

  // Existing orders predate customer accounts. Add the nullable relationship
  // idempotently while keeping guest orders valid and private.
  await client.query(`
    DO $accounts$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_account_id_fkey'
      ) THEN
        ALTER TABLE orders
          ADD CONSTRAINT orders_customer_account_id_fkey
          FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL;
      END IF;
    END
    $accounts$;
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

    -- One-time compatibility migration. The marker prevents later restarts from
    -- overwriting legitimate zero subtotals or administrator-edited product data.
    DO $fulfillment_v1$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE id = '20260915_fulfillment_v1') THEN
        UPDATE orders
        SET subtotal_amount = total_amount, delivery_amount = 0
        WHERE total_amount >= 0;

        UPDATE order_items AS item
        SET
          fulfillment_status = CASE
            WHEN parent.status IN ('CANCELLED', 'REFUNDED', 'FAILED') THEN parent.status
            WHEN parent.status = 'COMPLETED' THEN 'COMPLETED'
            WHEN parent.status = 'DELIVERED' THEN 'DELIVERED'
            WHEN parent.status = 'SHIPPED' AND item.sim_type = 'SIM' THEN 'SHIPPED'
            WHEN parent.status = 'SHIPPED' AND item.sim_type = 'eSIM' THEN 'SENT'
            ELSE 'PENDING'
          END,
          delivery_cost_confirmed = CASE
            WHEN item.sim_type = 'eSIM' THEN TRUE
            WHEN parent.status = 'WAITING_FOR_MANAGER' THEN FALSE
            ELSE TRUE
          END
        FROM orders AS parent
        WHERE item.order_id = parent.id;

        UPDATE products
        SET
          esim_type = COALESCE(esim_type, 'consumer'),
          esim_delivery_method = COALESCE(esim_delivery_method, 'email')
        WHERE sim_type = 'eSIM';

        UPDATE products
        SET delivery_options = jsonb_build_array(jsonb_build_object(
          'id', 'manager-delivery',
          'label', 'Доставка по согласованию с менеджером',
          'cost', NULL,
          'currency', currency,
          'regions', jsonb_build_array('Регион уточняется при оформлении'),
          'dispatchDaysMin', NULL,
          'dispatchDaysMax', NULL
        ))
        WHERE sim_type = 'SIM' AND delivery_options = '[]'::jsonb;

        INSERT INTO app_migrations (id) VALUES ('20260915_fulfillment_v1');
      END IF;
    END
    $fulfillment_v1$;

    DO $fulfillment_constraints$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_subtotal_amount_nonnegative') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_subtotal_amount_nonnegative CHECK (subtotal_amount >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_amount_nonnegative') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_delivery_amount_nonnegative CHECK (delivery_amount >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_amount_nonnegative') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_discount_amount_nonnegative CHECK (discount_amount >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_not_above_subtotal') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_discount_not_above_subtotal CHECK (discount_amount <= subtotal_amount);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_total_amount_nonnegative') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_total_amount_nonnegative CHECK (total_amount >= 0);
      END IF;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_amount_consistent;
      ALTER TABLE orders ADD CONSTRAINT orders_total_amount_consistent CHECK (total_amount = subtotal_amount - discount_amount + delivery_amount);
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_delivery_cost_nonnegative') THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_delivery_cost_nonnegative CHECK (delivery_cost >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_unit_cost_nonnegative') THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_unit_cost_nonnegative CHECK (unit_cost IS NULL OR unit_cost >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_unit_cost_nonnegative') THEN
        ALTER TABLE products ADD CONSTRAINT products_unit_cost_nonnegative CHECK (unit_cost IS NULL OR unit_cost >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_unit_cost_nonnegative') THEN
        ALTER TABLE product_variants ADD CONSTRAINT product_variants_unit_cost_nonnegative CHECK (unit_cost IS NULL OR unit_cost >= 0);
      END IF;
    END
    $fulfillment_constraints$;

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
