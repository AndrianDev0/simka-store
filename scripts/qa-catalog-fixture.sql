\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'simka_qa' THEN RAISE EXCEPTION 'QA database required'; END IF; END $$;
INSERT INTO countries (name,slug,publication_status) VALUES ('QA Turkey','qa-turkey','PUBLISHED');
INSERT INTO operators (country_id,name,slug,publication_status) SELECT id,'QA Operator','qa-operator','PUBLISHED' FROM countries;
INSERT INTO categories (id,name,slug,is_published) VALUES ('qa-category','QA Travel','qa-travel',true);
INSERT INTO products (name,sku,slug,country_id,operator_id,sim_type,price,validity_days,data_volume,data_mb,publication_status,available,stock_quantity)
SELECT 'QA tariff '||g,'QA-SKU-'||g,'qa-tariff-'||g,1,1,'eSIM',100+g,30,'10 GB',10240,'PUBLISHED',true,100 FROM generate_series(1,10000) g;
INSERT INTO product_categories (product_id,category_id) SELECT id,'qa-category' FROM products;
ANALYZE;
