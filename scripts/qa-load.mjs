import { performance } from 'node:perf_hooks';
const origin = process.env.QA_ORIGIN || 'http://127.0.0.1:3000';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) throw Error('Loopback QA target required');
const paths = ['/search?q=QA-SKU-9999','/search?q=QA%20Turkey','/search?q=QA%20Operator','/search?q=QA%20Travel','/search?q=nonexistent-zz','/catalog?sort=price-asc'];
for (const concurrency of [1, 5]) {
 const samples=[]; let index=0; let failures=0; const start=performance.now();
 await Promise.all(Array.from({length:concurrency},async()=>{while(index<30){const i=index++;const t=performance.now();try{const r=await fetch(origin+paths[i%paths.length],{signal:AbortSignal.timeout(15000)});const body=await r.text();if(r.status!==200||!body.includes('</html>'))failures++;}catch{failures++;}samples.push(performance.now()-t);}}));
 samples.sort((a,b)=>a-b);
 console.log(JSON.stringify({concurrency,requests:samples.length,failures,p50:Math.round(samples[14]),p95:Math.round(samples[28]),max:Math.round(samples[29]),elapsedMs:Math.round(performance.now()-start)}));
 if(failures)break;
}
