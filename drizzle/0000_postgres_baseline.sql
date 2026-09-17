CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_telegram_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"client_id" text NOT NULL,
	"account_id" text,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"entry_path" text NOT NULL,
	"exit_path" text NOT NULL,
	"source" text,
	"medium" text,
	"campaign" text,
	"content" text,
	"term" text,
	"referrer_host" text,
	"device_type" text NOT NULL,
	"operating_system" text NOT NULL,
	"browser" text NOT NULL,
	"country_code" text,
	"region" text,
	"city" text,
	"language" text,
	"timezone" text,
	"screen_width" integer,
	"screen_height" integer,
	"viewport_width" integer,
	"viewport_height" integer,
	"pixel_ratio_x100" integer,
	"connection_type" text,
	"traffic_class" text DEFAULT 'HUMAN' NOT NULL,
	"traffic_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"ended_at" text,
	"exit_duration_ms" integer,
	CONSTRAINT "analytics_sessions_counts_nonnegative" CHECK ("analytics_sessions"."page_views" >= 0 AND "analytics_sessions"."event_count" >= 0),
	CONSTRAINT "analytics_sessions_exit_duration_nonnegative" CHECK ("analytics_sessions"."exit_duration_ms" IS NULL OR "analytics_sessions"."exit_duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_visitors" (
	"client_id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"first_source" text,
	"first_medium" text,
	"first_campaign" text,
	"first_referrer_host" text,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"sessions_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_visitors_sessions_nonnegative" CHECK ("analytics_visitors"."sessions_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"slug" text NOT NULL,
	"country_id" integer NOT NULL,
	"operator_id" integer NOT NULL,
	"sim_type" text NOT NULL,
	"price" integer NOT NULL,
	"old_price" integer,
	"unit_cost" integer,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"short_description" text DEFAULT '' NOT NULL,
	"full_description" text DEFAULT '' NOT NULL,
	"characteristics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validity_days" integer NOT NULL,
	"data_volume" text NOT NULL,
	"data_mb" integer,
	"is_unlimited" boolean DEFAULT false NOT NULL,
	"has_calls" boolean DEFAULT false NOT NULL,
	"calls_details" text,
	"has_sms" boolean DEFAULT false NOT NULL,
	"sms_details" text,
	"roaming_terms" text DEFAULT '' NOT NULL,
	"activation_terms" text DEFAULT '' NOT NULL,
	"compatibility" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"esim_type" text,
	"esim_delivery_method" text,
	"delivery_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"popular" boolean DEFAULT false NOT NULL,
	"tone" text DEFAULT 'from-[#1679f2] to-[#0d46ad]' NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"availability_status" text DEFAULT 'OUT_OF_STOCK' NOT NULL,
	"stock_quantity" integer,
	"publication_status" text DEFAULT 'DRAFT' NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"h1" text,
	"seo_text" text,
	"canonical_url" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "products_price_nonnegative" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_old_price_nonnegative" CHECK ("products"."old_price" IS NULL OR "products"."old_price" >= 0),
	CONSTRAINT "products_unit_cost_nonnegative" CHECK ("products"."unit_cost" IS NULL OR "products"."unit_cost" >= 0),
	CONSTRAINT "products_validity_days_positive" CHECK ("products"."validity_days" > 0),
	CONSTRAINT "products_data_mb_nonnegative" CHECK ("products"."data_mb" IS NULL OR "products"."data_mb" >= 0),
	CONSTRAINT "products_stock_quantity_nonnegative" CHECK ("products"."stock_quantity" IS NULL OR "products"."stock_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"seo_title" text,
	"seo_description" text,
	"h1" text,
	"seo_text" text,
	"canonical_url" text,
	"og_title" text,
	"og_description" text,
	"og_image" text,
	"is_published" boolean DEFAULT false NOT NULL,
	"noindex" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"iso_code" text,
	"flag" text DEFAULT '' NOT NULL,
	"region" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"seo_title" text,
	"seo_description" text,
	"h1" text,
	"seo_text" text,
	"canonical_url" text,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publication_status" text DEFAULT 'DRAFT' NOT NULL,
	"noindex" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_payment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"crypto_payment_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crypto_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"status" text DEFAULT 'CREATING' NOT NULL,
	"checkout_url" text,
	"requested_amount" integer NOT NULL,
	"requested_currency" text NOT NULL,
	"received_amount" integer,
	"received_currency" text,
	"transaction_id" text,
	"paid_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "crypto_payments_requested_amount_positive" CHECK ("crypto_payments"."requested_amount" > 0),
	CONSTRAINT "crypto_payments_received_amount_nonnegative" CHECK ("crypto_payments"."received_amount" IS NULL OR "crypto_payments"."received_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"partner_code" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_at" text,
	"blocked_reason" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"campaign" text,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "marketing_costs_amount_positive" CHECK ("marketing_costs"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"area" text NOT NULL,
	"path" text NOT NULL,
	"code" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "operational_events_count_positive" CHECK ("operational_events"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" serial PRIMARY KEY NOT NULL,
	"country_id" integer NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo_url" text,
	"publication_status" text DEFAULT 'DRAFT' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"variant_id" integer,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"sim_type" text NOT NULL,
	"unit_price" integer NOT NULL,
	"unit_cost" integer,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"fulfillment_status" text DEFAULT 'PENDING' NOT NULL,
	"delivery_method" text,
	"delivery_cost" integer DEFAULT 0 NOT NULL,
	"delivery_cost_confirmed" boolean DEFAULT false NOT NULL,
	"tracking_number" text,
	"tracking_url" text,
	"activation_code_encrypted" text,
	"fulfillment_instructions" text,
	"fulfilled_at" text,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "order_items_delivery_cost_nonnegative" CHECK ("order_items"."delivery_cost" >= 0),
	CONSTRAINT "order_items_unit_cost_nonnegative" CHECK ("order_items"."unit_cost" IS NULL OR "order_items"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"order_number" text NOT NULL,
	"customer_account_id" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_contact" text DEFAULT '' NOT NULL,
	"delivery_address" text,
	"customer_comment" text DEFAULT '' NOT NULL,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"subtotal_amount" integer DEFAULT 0 NOT NULL,
	"promo_code" text,
	"partner_code" text,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"delivery_amount" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"inventory_reserved" boolean DEFAULT false NOT NULL,
	"payment_instructions_sent_at" text,
	"paid_at" text,
	"refunded_at" text,
	"partner_commission_bps_snapshot" integer,
	"delivery_expense_amount" integer,
	"payment_fee_amount" integer,
	"other_expense_amount" integer,
	"analytics_client_id" text,
	"analytics_source" text,
	"analytics_medium" text,
	"analytics_campaign" text,
	"analytics_content" text,
	"analytics_term" text,
	"first_party_client_id" text,
	"analytics_purchase_sent_at" text,
	"analytics_cancellation_sent_at" text,
	"analytics_refund_sent_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "orders_subtotal_amount_nonnegative" CHECK ("orders"."subtotal_amount" >= 0),
	CONSTRAINT "orders_discount_amount_nonnegative" CHECK ("orders"."discount_amount" >= 0),
	CONSTRAINT "orders_discount_not_above_subtotal" CHECK ("orders"."discount_amount" <= "orders"."subtotal_amount"),
	CONSTRAINT "orders_delivery_amount_nonnegative" CHECK ("orders"."delivery_amount" >= 0),
	CONSTRAINT "orders_total_amount_nonnegative" CHECK ("orders"."total_amount" >= 0),
	CONSTRAINT "orders_total_amount_consistent" CHECK ("orders"."total_amount" = "orders"."subtotal_amount" - "orders"."discount_amount" + "orders"."delivery_amount"),
	CONSTRAINT "orders_partner_commission_snapshot_valid" CHECK ("orders"."partner_commission_bps_snapshot" IS NULL OR ("orders"."partner_commission_bps_snapshot" >= 0 AND "orders"."partner_commission_bps_snapshot" <= 10000)),
	CONSTRAINT "orders_delivery_expense_nonnegative" CHECK ("orders"."delivery_expense_amount" IS NULL OR "orders"."delivery_expense_amount" >= 0),
	CONSTRAINT "orders_payment_fee_nonnegative" CHECK ("orders"."payment_fee_amount" IS NULL OR "orders"."payment_fee_amount" >= 0),
	CONSTRAINT "orders_other_expense_nonnegative" CHECK ("orders"."other_expense_amount" IS NULL OR "orders"."other_expense_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partner_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_code" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"click_count" integer DEFAULT 1 NOT NULL,
	"landing_path" text DEFAULT '/' NOT NULL,
	"first_seen_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_seen_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "partner_clicks_count_positive" CHECK ("partner_clicks"."click_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "partners_commission_valid" CHECK ("partners"."commission_bps" >= 0 AND "partners"."commission_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "privacy_consent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"consent_id" text NOT NULL,
	"account_id" text,
	"decision" text NOT NULL,
	"source" text NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"product_id" integer NOT NULL,
	"category_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"url" text NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"sku" text NOT NULL,
	"slug" text NOT NULL,
	"price" integer NOT NULL,
	"unit_cost" integer,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"data_volume" text,
	"validity_days" integer,
	"characteristics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"availability_status" text DEFAULT 'OUT_OF_STOCK' NOT NULL,
	"stock_quantity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "product_variants_price_nonnegative" CHECK ("product_variants"."price" >= 0),
	CONSTRAINT "product_variants_unit_cost_nonnegative" CHECK ("product_variants"."unit_cost" IS NULL OR "product_variants"."unit_cost" >= 0),
	CONSTRAINT "product_variants_validity_days_positive" CHECK ("product_variants"."validity_days" IS NULL OR "product_variants"."validity_days" > 0),
	CONSTRAINT "product_variants_stock_quantity_nonnegative" CHECK ("product_variants"."stock_quantity" IS NULL OR "product_variants"."stock_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"discount_type" text NOT NULL,
	"discount_value" integer NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"min_order_amount" integer DEFAULT 0 NOT NULL,
	"usage_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"starts_at" text,
	"ends_at" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "promo_codes_discount_value_positive" CHECK ("promo_codes"."discount_value" > 0),
	CONSTRAINT "promo_codes_percent_below_100" CHECK ("promo_codes"."discount_type" <> 'percent' OR "promo_codes"."discount_value" < 100),
	CONSTRAINT "promo_codes_min_order_nonnegative" CHECK ("promo_codes"."min_order_amount" >= 0),
	CONSTRAINT "promo_codes_usage_limit_positive" CHECK ("promo_codes"."usage_limit" IS NULL OR "promo_codes"."usage_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"subject_hash" text NOT NULL,
	"window_started_at" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "request_rate_limits_count_positive" CHECK ("request_rate_limits"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "search_analytics" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"query" text NOT NULL,
	"searches" integer DEFAULT 1 NOT NULL,
	"no_result_searches" integer DEFAULT 0 NOT NULL,
	"total_results" integer DEFAULT 0 NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	CONSTRAINT "search_analytics_searches_positive" CHECK ("search_analytics"."searches" > 0),
	CONSTRAINT "search_analytics_counts_nonnegative" CHECK ("search_analytics"."no_result_searches" >= 0 AND "search_analytics"."total_results" >= 0)
);
--> statement-breakpoint
CREATE TABLE "seo_redirects" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"old_slug" text NOT NULL,
	"new_slug" text NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"encrypted_value" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_analytics_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."analytics_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_client_id_analytics_visitors_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."analytics_visitors"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_client_id_analytics_visitors_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."analytics_visitors"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_visitors" ADD CONSTRAINT "analytics_visitors_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_payment_events" ADD CONSTRAINT "crypto_payment_events_crypto_payment_id_crypto_payments_id_fk" FOREIGN KEY ("crypto_payment_id") REFERENCES "public"."crypto_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_payments" ADD CONSTRAINT "crypto_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_password_resets" ADD CONSTRAINT "customer_password_resets_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operators" ADD CONSTRAINT "operators_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_account_id_customer_accounts_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_consent_events" ADD CONSTRAINT "privacy_consent_events_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_created_at" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_session_time" ON "analytics_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_client_time" ON "analytics_events" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_account_time" ON "analytics_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_name_time" ON "analytics_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_events_path_time" ON "analytics_events" USING btree ("path","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_client_started" ON "analytics_sessions" USING btree ("client_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_last_seen_at" ON "analytics_sessions" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_ended_at" ON "analytics_sessions" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_source_started" ON "analytics_sessions" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_sessions_traffic_class_started" ON "analytics_sessions" USING btree ("traffic_class","started_at");--> statement-breakpoint
CREATE INDEX "idx_analytics_visitors_account_id" ON "analytics_visitors" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_analytics_visitors_last_seen_at" ON "analytics_visitors" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_products_sku" ON "products" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_products_slug" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_products_publication_order" ON "products" USING btree ("publication_status","archived_at","sort_order");--> statement-breakpoint
CREATE INDEX "idx_products_catalog_filters" ON "products" USING btree ("country_id","operator_id","sim_type","available");--> statement-breakpoint
CREATE INDEX "idx_products_price_validity_data" ON "products" USING btree ("price","validity_days","data_mb");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_categories_slug" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_categories_parent_order" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_categories_published_order" ON "categories" USING btree ("is_published","archived_at","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_countries_slug" ON "countries" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_countries_iso_code" ON "countries" USING btree ("iso_code");--> statement-breakpoint
CREATE INDEX "idx_countries_publication_order" ON "countries" USING btree ("publication_status","archived_at","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_crypto_payment_events_provider_event" ON "crypto_payment_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_crypto_payment_events_payment_id" ON "crypto_payment_events" USING btree ("crypto_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_crypto_payments_order_id" ON "crypto_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_crypto_payments_provider_payment" ON "crypto_payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_crypto_payments_provider_transaction" ON "crypto_payments" USING btree ("provider","transaction_id");--> statement-breakpoint
CREATE INDEX "idx_crypto_payments_status" ON "crypto_payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_accounts_email" ON "customer_accounts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_customer_accounts_partner_code" ON "customer_accounts" USING btree ("partner_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_password_resets_token_hash" ON "customer_password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_customer_password_resets_account_id" ON "customer_password_resets" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_sessions_token_hash" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_customer_sessions_account_id" ON "customer_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_customer_sessions_expires_at" ON "customer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_marketing_costs_period" ON "marketing_costs" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_marketing_costs_source_campaign" ON "marketing_costs" USING btree ("source","campaign");--> statement-breakpoint
CREATE INDEX "idx_operational_events_last_seen_at" ON "operational_events" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_operational_events_kind_last_seen" ON "operational_events" USING btree ("kind","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_operators_country_slug" ON "operators" USING btree ("country_id","slug");--> statement-breakpoint
CREATE INDEX "idx_operators_country_publication" ON "operators" USING btree ("country_id","publication_status","sort_order");--> statement-breakpoint
CREATE INDEX "idx_order_items_order_id" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_order_items_fulfillment_status" ON "order_items" USING btree ("fulfillment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orders_request_id" ON "orders" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orders_order_number" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "idx_orders_customer_email" ON "orders" USING btree ("customer_email");--> statement-breakpoint
CREATE INDEX "idx_orders_customer_account_id" ON "orders" USING btree ("customer_account_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status_created_at" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_paid_at" ON "orders" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "idx_orders_refunded_at" ON "orders" USING btree ("refunded_at");--> statement-breakpoint
CREATE INDEX "idx_orders_partner_code" ON "orders" USING btree ("partner_code");--> statement-breakpoint
CREATE INDEX "idx_orders_first_party_client_id" ON "orders" USING btree ("first_party_client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_partner_clicks_partner_visitor" ON "partner_clicks" USING btree ("partner_code","visitor_hash");--> statement-breakpoint
CREATE INDEX "idx_partner_clicks_last_seen_at" ON "partner_clicks" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_partners_code" ON "partners" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_partners_active_created_at" ON "partners" USING btree ("active","created_at");--> statement-breakpoint
CREATE INDEX "idx_privacy_consent_events_consent_id" ON "privacy_consent_events" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "idx_privacy_consent_events_account_id" ON "privacy_consent_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_privacy_consent_events_created_at" ON "privacy_consent_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_categories_pair" ON "product_categories" USING btree ("product_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_product_categories_category_id" ON "product_categories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_images_product_url" ON "product_images" USING btree ("product_id","url");--> statement-breakpoint
CREATE INDEX "idx_product_images_product_order" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_variants_sku" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_variants_slug" ON "product_variants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_product_variants_product_order" ON "product_variants" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_promo_codes_code" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_promo_codes_active_dates" ON "promo_codes" USING btree ("active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_request_rate_limits_updated_at" ON "request_rate_limits" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_search_analytics_last_seen_at" ON "search_analytics" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "idx_search_analytics_query" ON "search_analytics" USING btree ("query");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_seo_redirects_entity_old_slug" ON "seo_redirects" USING btree ("entity_type","old_slug");--> statement-breakpoint
CREATE INDEX "idx_seo_redirects_entity_id" ON "seo_redirects" USING btree ("entity_type","entity_id");