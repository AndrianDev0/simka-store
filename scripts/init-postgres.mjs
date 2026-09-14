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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request_id ON orders(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
    CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
    CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);

    -- Older deploys used a three-state check. Replace it with the extensible workflow.
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('NEW', 'WAITING_FOR_MANAGER', 'WAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED'));

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sim_type TEXT NOT NULL CHECK (sim_type IN ('eSIM', 'SIM')),
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      line_total INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);
    CREATE INDEX IF NOT EXISTS idx_categories_published_order ON categories(is_published, archived_at, sort_order);

    CREATE TABLE IF NOT EXISTS product_categories (
      product_id INTEGER NOT NULL,
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
  `);
  console.log("Postgres schema ready");
} finally {
  await client.end();
}
