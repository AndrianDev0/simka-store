import assert from 'node:assert/strict';
const base='http://127.0.0.1:3000';
async function post(path,data,origin=base,cookie=''){
 return fetch(base+path,{method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});
}
const results=[];
let r=await post('/api/account/register',{},'https://evil.invalid');assert.equal(r.status,403);results.push('foreign origin rejected');
r=await post('/api/account/register',{name:'Q',email:'invalid',password:'short'});assert.equal(r.status,303);assert.match(r.headers.get('location'),/error=/);results.push('invalid registration rejected');
const password='QA-only-strong-password-2026';
r=await post('/api/account/register',{name:'QA Test',email:'qa@example.com',password,passwordConfirmation:password});assert.equal(r.status,303);assert.ok(!r.headers.get('location').includes('error='));
let cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.ok(cookie);results.push('registration creates session');
r=await fetch(base+'/account',{headers:{cookie},redirect:'manual'});assert.equal(r.status,200);assert.ok((await r.text()).includes('QA Test'));results.push('authenticated profile opens');
r=await post('/api/account/profile',{name:'QA Changed',contact:'@qa_test'},base,cookie);assert.equal(r.status,303);assert.match(r.headers.get('location'),/saved/);results.push('profile saved');
r=await post('/api/account/logout',{},base,cookie);assert.equal(r.status,303);results.push('logout');
r=await fetch(base+'/account',{headers:{cookie},redirect:'manual'});assert.ok([303,307].includes(r.status));results.push('revoked session rejected');
r=await post('/api/account/login',{email:'qa@example.com',password:'wrong'});assert.match(r.headers.get('location'),/error=/);results.push('incorrect password rejected');
r=await post('/api/account/login',{email:'qa@example.com',password});assert.ok(!r.headers.get('location').includes('error='));assert.ok(r.headers.getSetCookie().length);results.push('correct password accepted');
console.log(JSON.stringify(results,null,2));
