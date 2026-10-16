import pg from 'pg';
import assert from 'node:assert/strict';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
const notice = 'Демонстрационный пример. Цена, объём и срок вымышлены для показа сайта. Не является предложением оператора. Заказать и оплатить нельзя.';
const places = [
  ['turkey','Турция','🇹🇷','Европа',690],
  ['germany','Германия','🇩🇪','Европа',890],
  ['japan','Япония','🇯🇵','Азия',990],
  ['thailand','Таиланд','🇹🇭','Азия',790],
  ['uae','ОАЭ','🇦🇪','Ближний Восток',1190],
  ['usa','США','🇺🇸','Америка',1090],
];
await db.connect();
try {
  await db.query('BEGIN');
  for (const [id,name] of [['demo-esim','Примеры eSIM'],['demo-physical','Примеры физических SIM'],['demo-short','Примеры для короткой поездки']]) {
    await db.query('INSERT INTO categories(id,name,slug,description,is_published,noindex) VALUES($1,$2,$1,$3,true,true) ON CONFLICT(id) DO NOTHING',[id,name,notice]);
  }
  for (const [slug,name,flag,region,price] of places) {
    const country = (await db.query("INSERT INTO countries(name,slug,flag,region,description,publication_status,noindex) VALUES($1,$2,$3,$4,$5,'PUBLISHED',true) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id",[name,`demo-${slug}`,flag,region,notice])).rows[0].id;
    const operator = (await db.query("INSERT INTO operators(country_id,name,slug,description,publication_status) VALUES($1,'Демо: оператор не выбран','demo-provider',$2,'PUBLISHED') ON CONFLICT(country_id,slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id",[country,notice])).rows[0].id;
    for (const type of ['eSIM','SIM']) {
      const code = `DEMO-${slug.toUpperCase()}-${type.toUpperCase()}`;
      const product = (await db.query(`INSERT INTO products(name,sku,slug,country_id,operator_id,sim_type,price,currency,validity_days,data_volume,data_mb,available,availability_status,stock_quantity,publication_status,short_description,full_description,activation_terms,roaming_terms,compatibility,instructions,esim_delivery_method,characteristics)
        VALUES($1,$2,$3,$4,$5,$6,$7,'RUB',$8,$9,$10,false,'OUT_OF_STOCK',0,'PUBLISHED',$11,$11,$12,$12,$12,$11,$13,$14)
        ON CONFLICT(sku) DO UPDATE SET sku=EXCLUDED.sku RETURNING id`,[
        `Пример: ${name}, ${type === 'eSIM' ? '5' : '10'} ГБ (${type})`,code,code.toLowerCase(),country,operator,type,price+(type==='SIM'?500:0),type==='eSIM'?7:30,type==='eSIM'?'5 ГБ':'10 ГБ',type==='eSIM'?5120:10240,notice,'Не подтверждено поставщиком. Только пример заполнения.',type==='eSIM'?'email':null,JSON.stringify({ 'Назначение':'Демонстрация сайта, не для продажи' })])).rows[0].id;
      for(const category of [type==='eSIM'?'demo-esim':'demo-physical',...(type==='eSIM'?['demo-short']:[])]) {
        await db.query('INSERT INTO product_categories(product_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[product,category]);
      }
    }
  }
  const result = await db.query("SELECT count(*)::int AS count, bool_and(NOT available AND stock_quantity=0 AND availability_status='OUT_OF_STOCK') AS blocked FROM products WHERE sku LIKE 'DEMO-%'");
  assert.equal(result.rows[0].count,12);
  assert.equal(result.rows[0].blocked,true);
  await db.query('COMMIT');
  console.log('Created/verified 12 demo products, 6 countries, 3 categories. All unavailable for purchase.');
} catch(error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
