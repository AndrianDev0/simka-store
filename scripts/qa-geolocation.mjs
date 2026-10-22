import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { geolocateRequest } from '../lib/ip-geolocation.ts';
assert.equal(process.env.QA_ISOLATED,'true');
assert.equal(new URL(process.env.DATABASE_URL).pathname,'/simka_qa');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 const expected=await geolocateRequest(new Request('http://127.0.0.1',{headers:{'x-real-ip':'8.8.8.8'}}));
 assert.ok(expected.countryCode);assert.ok(expected.city);
 const id=randomUUID(), session=randomUUID();
 const headers={'content-type':'application/json',origin:'http://127.0.0.1:3000','x-real-ip':'8.8.8.8','cf-ipcountry':'ZZ','cf-ipcity':'FORGED','user-agent':'Mozilla/5.0 Chrome/130.0.0.0'};
 const policyVersion=readFileSync('lib/analytics-policy.ts','utf8').match(/ANALYTICS_POLICY_VERSION = "([^"]+)"/)[1];
 async function post(path,data){const response=await fetch('http://127.0.0.1:3000'+path,{method:'POST',headers,body:JSON.stringify(data)});assert.equal(response.status,201,await response.text());}
 await post('/api/privacy/consent',{eventId:randomUUID(),consentId:id,decision:'accepted',source:'banner',policyVersion});
 await post('/api/analytics/events',{eventId:randomUUID(),clientId:id,sessionId:session,name:'page_view',path:'/qa-geo',occurredAt:new Date().toISOString()});
 const actual=(await db.query('select country_code,region,city from analytics_sessions where id=$1',[session])).rows[0];
 assert.deepEqual(actual,{country_code:expected.countryCode,region:expected.region,city:expected.city});
 console.log(JSON.stringify({passed:true,location:actual,forgedHeadersIgnored:true}));
}finally{await db.end();}
