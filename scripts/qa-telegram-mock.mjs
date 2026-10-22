import { appendFileSync } from 'node:fs';
if (process.env.QA_ISOLATED !== 'true') throw Error('QA only');
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=String(input instanceof Request?input.url:input);
 if(url.startsWith('https://api.telegram.org/botQA_TEST/')){
  const body=typeof init?.body==='string'?JSON.parse(init.body):{};
  if(init?.body instanceof FormData){
   for(const [key,value] of init.body.entries()) body[key]=typeof value==='string'?value:await value.text();
  }
  appendFileSync('/tmp/qa-telegram.jsonl',JSON.stringify(body)+'\n');
  return Response.json({ok:true,result:{message_id:1}});
 }
 if(!url.startsWith('http://127.0.0.1:3000')) throw Error('QA external request blocked');
 return nativeFetch(input,init);
};
