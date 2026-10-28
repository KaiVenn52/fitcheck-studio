import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../server/app.mjs';
import { YouCamAdapter } from '../server/youcam.mjs';

// Every upstream response here is injected. Only the application HTTP server uses actual sockets.
// No synthetic input leaves this process for YouCam or external object storage.
const imageBytes=await readFile(new URL('./fixture-input.png',import.meta.url));
const image={type:'image/png',data:imageBytes.toString('base64')};
const payload={mode:'live',source:image,products:[{label:'Injected watch A',image},{label:'Injected watch B',image}],consent:{version:'photo-transfer-v1',rights:true,transfer:true,units:true}};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const taskRoot='https://yce-api-01.makeupar.com/s2s/v2.0/task/2d-vto/watch';
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function harness(t,{lostSecond=false,rejectUpload=false}={}) {
  let time=100000,files=0,creates=0,polls=0;
  const calls=[];
  const adapter=new YouCamAdapter({apiKey:'INJECTED_TEST_KEY_NOT_A_REAL_CREDENTIAL',urlValidator:async url=>{
    assert.match(url,/^https:\/\/fixture-storage\.s3\.amazonaws\.com\/(upload|result)-\d+$/);return url;
  },fetchImpl:async(url,options={})=>{
    const method=options.method || 'GET';calls.push({method,url,hasBearer:Boolean(options.headers?.Authorization)});
    if(url.endsWith('/s2s/v2.0/file')) {
      assert.equal(method,'POST');const meta=JSON.parse(options.body).files[0];assert.equal(meta.content_type,'image/jpeg');
      return json({status:200,data:{files:[{file_id:`file-${++files}`,requests:[{method:'PUT',url:`https://fixture-storage.s3.amazonaws.com/upload-${files}`,headers:{'Content-Type':'image/jpeg'}}]}]}});
    }
    if(url.includes('/upload-')) {
      assert.equal(method,'PUT');assert.equal(options.headers.Authorization,undefined);
      assert.ok(Buffer.isBuffer(options.body));assert.equal(options.body[0],0xff);assert.equal(options.body[1],0xd8);
      return new Response(null,{status:rejectUpload ? 403 : 200});
    }
    if(url===taskRoot) {
      creates++;const body=JSON.parse(options.body);assert.equal(body.src_file_id,'file-1');assert.deepEqual(body.ref_file_ids,[`file-${creates+1}`]);
      if(lostSecond && creates===2)throw new Error('Injected transport lost creation acknowledgment');
      return json({status:200,data:{task_id:`injected-task-${creates}`}});
    }
    if(url.startsWith(taskRoot+'/')) {
      polls++;
      return json({status:200,data:{task_status:lostSecond && polls<3 ? 'running' : 'success',results:{url:`https://fixture-storage.s3.amazonaws.com/result-${url.endsWith('1') ? 1 : 2}`}}});
    }
    if(url.includes('/result-'))return new Response(imageBytes,{status:200,headers:{'Content-Type':'image/png'}});
    throw new Error(`Unexpected injected transport request: ${method} ${url}`);
  }});
  const {app,store}=createApp({adapter,liveEnabled:true,now:()=>time});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const config=await fetch(base+'/api/config');const cookie=config.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':'injected-full-transport-test'};
  const create=async()=>{const response=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(response.status,202);return response.json();};
  const get=async(id,resume=false)=>{const response=await fetch(base+`/api/jobs/${id}`+(resume?'/resume':''),{method:resume?'POST':'GET',headers});assert.equal(response.status,200);return response.json();};
  const ready=async id=>{for(let i=0;i<20;i++){const job=store.jobs.get(id);if(job.state!=='uploading')return;await settle();}throw new Error('Injected upload did not settle');};
  return {base,headers,create,get,ready,calls,store,advance:()=>{time+=3000;},counts:()=>({files,creates,polls})};
}

test('full HTTP → real adapter → injected upload/task/result chain preserves ownership and idempotency',async t=>{
  const h=await harness(t);const job=await h.create();await h.ready(job.id);
  const duplicate=await h.create();assert.equal(duplicate.id,job.id);
  const complete=await h.get(job.id);assert.equal(complete.state,'success');
  assert.equal(complete.items.length,2);assert.ok(complete.items.every(item=>item.hasProviderTask));
  assert.deepEqual(h.counts(),{files:3,creates:2,polls:2});
  assert.ok(!JSON.stringify(complete).includes('fixture-storage'));assert.ok(!JSON.stringify(complete).includes('INJECTED_TEST_KEY'));
  const response=await fetch(h.base+complete.items[0].result,{headers:h.headers});assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),imageBytes);
  const secondView=await fetch(h.base+complete.items[0].result,{headers:h.headers});
  assert.equal(secondView.status,200);
  assert.equal(h.calls.filter(c=>c.url.includes('/result-')).length,1,'a second view reuses validated bytes rather than an expiring signed URL');
  assert.equal((await fetch(h.base+complete.items[0].result)).status,404);
  await fetch(h.base+'/api/jobs',{method:'DELETE',headers:h.headers});
  assert.equal(h.store.resultCache.size,0,'clearing the owning session evicts cached result bytes');
  assert.equal((await fetch(h.base+complete.items[0].result,{headers:h.headers})).status,404);
  const report={evidence:'INJECTED_UPSTREAM_TRANSPORT_ONLY',actualYouCamCalls:0,applicationHttp:'actual loopback requests',upstreamCalls:h.calls,verified:['three sanitized uploads','two task creations','no duplicate creation','owner-bound result proxy','clear revokes result access']};
  await writeFile(new URL('../qa/transport-results.json',import.meta.url),JSON.stringify(report,null,2));
});

test('injected lost second acknowledgment allows a slow first task to complete without another POST',async t=>{
  const h=await harness(t,{lostSecond:true});const job=await h.create();await h.ready(job.id);
  let current=await h.get(job.id,true);assert.equal(current.state,'uncertain');assert.equal(current.canResume,true);
  h.advance();current=await h.get(job.id,true);assert.equal(current.canResume,true);
  h.advance();current=await h.get(job.id,true);assert.equal(current.items[0].state,'success');assert.equal(current.state,'uncertain');assert.equal(current.canResume,false);
  assert.equal(h.counts().creates,2);assert.equal(h.counts().polls,3);
});

test('injected storage failure stops before any rendering task is created',async t=>{
  const h=await harness(t,{rejectUpload:true});const job=await h.create();await h.ready(job.id);
  const failed=await h.get(job.id);assert.equal(failed.state,'error');assert.equal(failed.error.code,'UPLOAD_FAILED');assert.equal(h.counts().creates,0);
});
