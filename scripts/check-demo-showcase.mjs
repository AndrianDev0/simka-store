import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'https://simki.cc';
const response = await fetch(`${base}/api/pages/catalog`);
assert.equal(response.status,200);
const catalog = await response.json();
const products = catalog.products.filter(p=>p.sku.startsWith('DEMO-'));
assert.equal(products.length,12);
assert.ok(products.every(p=>!p.available && p.stockQuantity===0));
for(const path of ['/','/catalog','/categories','/countries','/category/demo-esim','/country/demo-japan','/product/demo-japan-esim']) {
  const r = await fetch(base+path); assert.equal(r.status,200,path);
  const body = await r.text(); assert.ok(body.includes('Пример') || body.includes('Демонстрацион'),path);
  if(path.startsWith('/product/')) assert.ok(body.includes('noindex'));
  console.log('PASS',path);
}
const sitemap=await(await fetch(base+'/sitemap.xml')).text();
assert.ok(!sitemap.includes('/product/demo-'));
assert.ok(!sitemap.includes('/country/demo-'));
const order=await fetch(base+'/api/orders',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),customerName:'Проверка запрета демо',customerEmail:'demo-check@example.com',paymentMethod:'manager',items:[{productId:products[0].id,quantity:1}]})});
const result=await order.text();
assert.ok([400,409,422].includes(order.status),result);
console.log('PASS server rejects demo purchase:',order.status,result);
