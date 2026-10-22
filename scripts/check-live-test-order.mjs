import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const db = new pg.Client({connectionString:process.env.DATABASE_URL, ssl:false});
await db.connect();
const slug = `test-no-service-${randomUUID().slice(0,8)}`;
let country, operator, product;
const requestId = randomUUID();
try {
  country = (await db.query("INSERT INTO countries(name,slug,publication_status) VALUES($1,$2,'PUBLISHED') RETURNING id",['ТЕСТ, не страна обслуживания',slug])).rows[0].id;
  operator = (await db.query("INSERT INTO operators(country_id,name,slug,publication_status) VALUES($1,$2,$3,'PUBLISHED') RETURNING id",[country,'ТЕСТ, связи нет',slug])).rows[0].id;
  product = (await db.query("INSERT INTO products(name,sku,slug,country_id,operator_id,sim_type,price,validity_days,data_volume,available,availability_status,stock_quantity,publication_status,short_description,instructions,esim_delivery_method) VALUES($1,$2,$2,$3,$4,'eSIM',1,1,'ТЕСТ',true,'IN_STOCK',1,'PUBLISHED',$5,$5,'email') RETURNING id",['ТЕСТ СИСТЕМЫ, НЕ ПОКУПАТЬ',slug,country,operator,'Техническая проверка. Не является тарифом. Связь не предоставляется. Не оплачивать.'])).rows[0].id;
  const catalog = await (await fetch('https://simki.cc/api/pages/catalog')).json();
  assert.ok(catalog.products.some(p=>p.id===product),'test product visible');
  console.log('CATALOG_VISIBLE',product);
  const payload = {requestId,customerName:'ТЕСТ СИСТЕМЫ, НЕ ОПЛАЧИВАТЬ',customerEmail:'maa190186@gmail.com',customerComment:'Техническая проверка. Реальной покупки и оплаты нет.',paymentMethod:'manager',items:[{productId:product,quantity:1}]};
  const post = () => fetch('https://simki.cc/api/orders',{method:'POST',headers:{Origin:'https://simki.cc','Content-Type':'application/json'},body:JSON.stringify(payload)});
  const response = await post();
  const result = await response.json();
  console.log('ORDER_RESULT',response.status,JSON.stringify(result));
  assert.equal(response.status,201);
  assert.equal(result.order.status,'WAITING_FOR_MANAGER');
  assert.equal(result.order.managerNotified,true);
  assert.equal(result.order.customerNotified,true);
  const duplicate = await post();
  const repeated = await duplicate.json();
  assert.equal(repeated.order.orderNumber,result.order.orderNumber);
  const count = (await db.query('SELECT count(*)::int AS count FROM orders WHERE request_id=$1',[requestId])).rows[0].count;
  assert.equal(count,1);
  console.log('DUPLICATE_PROTECTED');
} finally {
  await db.query("UPDATE orders SET status='CANCELLED',inventory_reserved=false,customer_comment=customer_comment || ' Проверка завершена, отменён без оплаты.',updated_at=CURRENT_TIMESTAMP WHERE request_id=$1 AND status='WAITING_FOR_MANAGER'",[requestId]);
  if(product) await db.query("UPDATE products SET publication_status='ARCHIVED',available=false,archived_at=CURRENT_TIMESTAMP WHERE id=$1",[product]);
  if(operator) await db.query("UPDATE operators SET publication_status='ARCHIVED',archived_at=CURRENT_TIMESTAMP WHERE id=$1",[operator]);
  if(country) await db.query("UPDATE countries SET publication_status='ARCHIVED',archived_at=CURRENT_TIMESTAMP WHERE id=$1",[country]);
  console.log('TEST_ORDER_CANCELLED_AND_CATALOG_ARCHIVED');
  await db.end();
}
