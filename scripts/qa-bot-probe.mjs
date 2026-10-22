import { readFileSync,writeFileSync } from 'node:fs';
const base='http://127.0.0.1:3000';
let id=100;const report=[];const callbacks=new Set();
async function probe(label,update){
 writeFileSync('/tmp/qa-telegram.jsonl','');
 const r=await fetch(base+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'qa-secret'},body:JSON.stringify({update_id:id++,...update}),signal:AbortSignal.timeout(15000)});
 const messages=readFileSync('/tmp/qa-telegram.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const texts=messages.map(m=>m.text||'').join('\n');
 for(const m of messages)for(const row of m.reply_markup?.inline_keyboard||[])for(const b of row)if(b.callback_data)callbacks.add(b.callback_data);
 report.push({label,status:r.status,messages:messages.length,error:/не удалось|ошибка|unknown|неизвестн/i.test(texts)});
}
for(const cmd of ['/start','/products','/countries','/operators','/categories','/orders','/customers','/analytics','/promocodes','/partners','/status','/email','/payment_requisites'])await probe(cmd,{message:{message_id:id,text:cmd,chat:{id:1},from:{id:1}}});
const readOnly=Array.from(callbacks).filter(c=> /^(menu|status)$|:(list|view|menu|page|overview)(:|$)/.test(c)).slice(0,35);
for(const data of readOnly)await probe(data,{callback_query:{id:String(id),data,from:{id:1},message:{chat:{id:1}}}});
console.log(JSON.stringify({discoveredCallbacks:callbacks.size,testedCallbacks:readOnly.length,report},null,2));
