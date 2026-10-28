import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { YouCamAdapter, safeProviderUrl } from '../server/youcam.mjs';
import { validateImage } from '../server/images.mjs';
import { JobStore, TTL_MS } from '../server/jobs.mjs';
import { createApp } from '../server/app.mjs';
const input = { type: 'image/png', data: (await readFile(new URL('./fixture-input.png', import.meta.url))).toString('base64') };
const consent = { version:'photo-transfer-v1', rights:true, transfer:true, units:true };
const liveInput = () => ({ mode: 'live', source:input, products:[{image:input,label:'A'},{image:input,label:'B'}], consent });
const demo = (scenario='success') => ({ mode:'fixture', productIds:['field','dress'], scenario });
const key = 'test-idempotent-comparison';
const json = (body, status=200, headers={}) => new Response(JSON.stringify(body), { status, headers:{ 'Content-Type':'application/json', ...headers } });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('image decoder strips EXIF and accepts a genuine JPEG/PNG, not its claimed MIME alone', async () => {
  const image = await validateImage(input);
  const info = await sharp(image.buffer).metadata();
  assert.equal(info.format,'jpeg'); assert.equal(info.exif,undefined); assert.equal(info.width,640);
  await assert.rejects(validateImage({type:'image/png',data:Buffer.from('<script>alert(1)</script>').toString('base64')}), {code:'IMAGE_INVALID'});
  await assert.rejects(validateImage({ ...input, type:'image/jpeg' }),{code:'IMAGE_INVALID'});
});
test('image dimensions and raw SVG are rejected before transfer', async () => {
  const small = await sharp({create:{width:64,height:64,channels:3,background:'red'}}).png().toBuffer();
  await assert.rejects(validateImage({type:'image/png',data:small.toString('base64')}),{code:'IMAGE_DIMENSIONS'});
  const belowPlaygroundMinimum=await sharp({create:{width:639,height:640,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(validateImage({type:'image/png',data:belowPlaygroundMinimum.toString('base64')}),{code:'IMAGE_DIMENSIONS'});
  await assert.rejects(validateImage({type:'image/svg+xml',data:'AAAA'}),{code:'IMAGE_TYPE'});
  await assert.rejects(validateImage({type:'image/png',data:'%notbase64'}),{code:'IMAGE_SIZE'});
});
test('adapter uses official file metadata and signed PUT instructions without leaking Bearer to storage', async () => {
  const calls=[];
  const adapter = new YouCamAdapter({apiKey:'injected-test-key',urlValidator:async u=>u,fetchImpl:async (url, options)=>{
    calls.push({url,options});
    return calls.length === 1 ? json({files:[{file_id:'file-1', requests:[{url:'https://bucket.s3.amazonaws.com/input',method:'PUT',headers:{'Content-Type':'image/jpeg'}}]}]}) : new Response('',{status:200});
  }});
  const image = await validateImage(input);
  assert.equal(await adapter.upload(image),'file-1');
  assert.equal(calls[0].url,'https://yce-api-01.makeupar.com/s2s/v2.0/file');
  assert.equal(JSON.parse(calls[0].options.body).files[0].file_size,image.buffer.length);
  assert.equal(calls[0].options.headers.Authorization,'Bearer injected-test-key');
  assert.equal(calls[1].options.headers.Authorization,undefined);
  assert.equal(calls[1].options.body,image.buffer);
});
test('adapter create payload matches downloaded watch OpenAPI ID fields and parameters', async () => {
  let body;
  const adapter = new YouCamAdapter({apiKey:'injected',fetchImpl:async (_,o)=>{body=JSON.parse(o.body);return json({status:200,data:{task_id:'watch-task'}});}});
  assert.equal(await adapter.create('wrist-file','watch-file'),'watch-task');
  assert.deepEqual(body.ref_file_ids,['watch-file']);assert.equal(body.src_file_id,'wrist-file');
  assert.equal(body.source_info.name,body.src_file_id);assert.equal(body.object_infos[0].name,body.ref_file_ids[0]);
  const schema = JSON.parse(await readFile(new URL('../research/watch.openapi.json', import.meta.url)));
  assert.ok(schema.paths['/s2s/v2.0/task/2d-vto/watch']);
  assert.equal(body.object_infos[0].parameter.watch_shadow_intensity,.3);
});
test('adapter handles running, documented success, engine failure and malformed success', async () => {
  const queue=[{task_status:'running'},{task_status:'success',results:{url:'https://bucket.s3.amazonaws.com/result.jpg'}},{task_status:'error',error:'PHOTO_DETECTION_FAIL'},{task_status:'success',results:null}];
  const adapter=new YouCamAdapter({apiKey:'injected',urlValidator:async u=>u,fetchImpl:async ()=>json({status:200,data:queue.shift()})});
  assert.equal((await adapter.poll('task')).state,'running');assert.equal((await adapter.poll('task')).state,'success');
  assert.match((await adapter.poll('task')).error.message,/clear hand/);
  await assert.rejects(adapter.poll('task'),{code:'PROVIDER_SCHEMA'});
});
test('auth, units and rate limits are distinct safe errors', async () => {
  for (const [status,body,code] of [[401,{},'PROVIDER_AUTH'],[400,{error_code:'CreditInsufficiency'},'PROVIDER_CREDITS'],[429,{},'PROVIDER_RATE_LIMIT']]) {
    const adapter=new YouCamAdapter({apiKey:'do-not-expose',fetchImpl:async ()=>json(body,status,{'retry-after':'17'})});
    await assert.rejects(adapter.create('a','b'),e=>{ assert.equal(e.code,code);assert.ok(!e.message.includes('do-not-expose'));if(status===429)assert.equal(e.retryAfter,17);return true; });
  }
});
test('provider transport errors do not automatically retry a possibly accepted render', async () => {
  let calls=0;
  const adapter=new YouCamAdapter({fetchImpl:async()=>{calls++;throw new Error('network');}});
  await assert.rejects(adapter.create('a','b'),{code:'PROVIDER_UNREACHABLE'});assert.equal(calls,1);
});
test('provider media guard rejects external, credential-bearing, private and mapped IPv6 targets', async () => {
  const publicDns=async()=>[{address:'8.8.8.8',family:4}];
  assert.equal(await safeProviderUrl('https://bucket.s3.amazonaws.com/image',publicDns),'https://bucket.s3.amazonaws.com/image');
  for (const url of ['http://bucket.s3.amazonaws.com/x','https://example.com/x','https://localhost/x','https://u:p@bucket.s3.amazonaws.com/x','https://makeupar.com.attacker.example/x']) await assert.rejects(safeProviderUrl(url,publicDns));
  await assert.rejects(safeProviderUrl('https://bucket.s3.amazonaws.com/x',async()=>[{address:'127.0.0.1',family:4}]),{code:'PROVIDER_MEDIA_HOST'});
  await assert.rejects(safeProviderUrl('https://bucket.s3.amazonaws.com/x',async()=>[{address:'::ffff:127.0.0.1',family:6}]),{code:'PROVIDER_MEDIA_HOST'});
});
test('fixture full loop has explicit evidence labels and never uses the provider adapter', async () => {
  const store=new JobStore({adapter:{upload:()=>{throw new Error('must not call');}},fixtureDelay:0});
  const job=await store.create(demo(),'owner',key);await store.refresh(job);
  const view=store.view(job);assert.equal(view.state,'success');assert.equal(view.mode,'fixture');
  assert.match(view.items[0].result,/fixtures/);assert.equal(view.items[0].hasProviderTask,false);
  assert.equal('source' in job,false);
});
test('demo rejects personal images and invalid or repeated sample IDs', async () => {
  const store=new JobStore();
  await assert.rejects(store.create({...demo(),source:input},'a',key),{code:'FIXTURE_ONLY'});
  await assert.rejects(store.create({...demo(),productIds:['field','field']},'a',key),{code:'FIXTURE_INVALID'});
});
test('live calls require server enablement and bound photo-transfer consent', async () => {
  await assert.rejects(new JobStore().create(liveInput(),'a',key),{code:'LIVE_DISABLED'});
  await assert.rejects(new JobStore({liveEnabled:true}).create({...liveInput(),consent:{...consent,transfer:false}},'a',key),{code:'CONSENT_REQUIRED'});
});
test('idempotency is owner scoped and refuses a changed payload', async () => {
  const store=new JobStore();
  const a=await store.create(demo(),'a',key), duplicate=await store.create(demo(),'a',key);
  assert.equal(a.id,duplicate.id);
  assert.notEqual(a.id,(await store.create(demo(),'b',key)).id);
  await assert.rejects(store.create(demo('timeout'),'a',key),{code:'REQUEST_CHANGED'});
  assert.throws(()=>store.get(a.id,'b'),{code:'NOT_FOUND'});
});
test('concurrent live requests with one key create exactly two provider tasks', async () => {
  let uploads=0,tasks=0;
  const store=new JobStore({liveEnabled:true,adapter:{upload:async()=>`image-${++uploads}`,create:async()=>`task-${++tasks}`}});
  const [a,b]=await Promise.all([store.create(liveInput(),'a',key),store.create(liveInput(),'a',key)]);
  await settle();assert.equal(a.id,b.id);assert.equal(tasks,2);assert.equal(uploads,3);
});
test('rate-limit demo recovers same ID after backoff without another comparison', async () => {
  let time=100000;const store=new JobStore({now:()=>time,fixtureDelay:0});
  const job=await store.create(demo('rate-limit'),'a',key);await store.refresh(job);
  assert.equal(job.state,'paused');await store.refresh(job,true);assert.equal(job.state,'paused');
  time+=5001;await store.refresh(job,true);assert.equal(job.state,'success');assert.equal(store.jobs.size,1);
});
test('slow demo resumes the same job; detection failure preserves a usable partial result', async () => {
  let time=100000;const store=new JobStore({now:()=>time,fixtureDelay:0});
  const job=await store.create(demo('timeout'),'a',key);await store.refresh(job);assert.equal(job.state,'paused');
  time+=3000;await store.refresh(job,true);assert.equal(job.state,'success');
  const broken=await store.create(demo('detection'),'a',key+'-2');await store.refresh(broken);
  assert.equal(broken.state,'error');assert.equal(broken.items[0].state,'success');assert.equal(broken.items[1].state,'error');
});
test('a lost second submission preserves first task and never resubmits either', async () => {
  let time=100000,tasks=0,polls=0;
  const store=new JobStore({liveEnabled:true,now:()=>time,adapter:{upload:async()=> 'file',create:async()=>{if(++tasks===2)throw new Error('lost ack');return 'known-task';},poll:async id=>{assert.equal(id,'known-task');polls++;return {state:'success',resultUrl:'https://bucket.s3.amazonaws.com/result'};}}});
  const job=await store.create(liveInput(),'a',key);await settle();assert.equal(job.state,'paused');
  await store.refresh(job,true);assert.equal(job.items[0].state,'success');assert.equal(job.state,'uncertain');assert.equal(tasks,2);assert.equal(polls,1);
  time+=3000;await store.refresh(job,true);assert.equal(tasks,2);
});
test('clearing during upload prevents subsequent task creation and blocks retrieval', async () => {
  let release,tasks=0;
  const store=new JobStore({liveEnabled:true,adapter:{upload:()=>new Promise(r=>{release=r;}),create:async()=>{tasks++;return 'task';}}});
  const job=await store.create(liveInput(),'a',key);store.clear('a');release('file');await settle();
  assert.equal(tasks,0);assert.throws(()=>store.get(job.id,'a'),{code:'NOT_FOUND'});
});
test('an uncertain second submission still permits repeated checks of a slow acknowledged first task', async () => {
  let time=100000,tasks=0,polls=0;
  const store=new JobStore({liveEnabled:true,now:()=>time,adapter:{
    upload:async()=> 'file',
    create:async()=>{if(++tasks===2)throw new Error('lost second acknowledgment');return 'known-first-task';},
    poll:async id=>{assert.equal(id,'known-first-task');return ++polls<3 ? {state:'running'} : {state:'success',resultUrl:'https://bucket.s3.amazonaws.com/result'};},
  }});
  const job=await store.create(liveInput(),'a',key);await settle();
  await store.refresh(job,true);assert.equal(job.state,'uncertain');assert.equal(store.view(job).canResume,true);
  time+=3000;await store.refresh(job);assert.equal(polls,1); // Never checks an uncertain state without explicit resume.
  await store.refresh(job,true);assert.equal(polls,2);assert.equal(store.view(job).canResume,true);
  time+=3000;await store.refresh(job,true);assert.equal(polls,3);assert.equal(job.items[0].state,'success');
  assert.equal(job.state,'uncertain');assert.equal(store.view(job).canResume,false);assert.equal(tasks,2);
  assert.equal(store.view(job).items[1].hasProviderTask,false);
});
test('TTL expires jobs and capacity prevents unbounded local records', async () => {
  let time=100000;const store=new JobStore({now:()=>time});const job=await store.create(demo(),'a',key);
  for(let i=0;i<5;i++)await store.create(demo(),'a',key+'-'+i);
  await assert.rejects(store.create(demo(),'a',key+'-extra'),{code:'CAPACITY'});
  time+=TTL_MS+1;assert.throws(()=>store.get(job.id,'a'),{code:'NOT_FOUND'});assert.equal(store.jobs.size,0);
});
test('HTTP routes enforce cross-origin protection, owner isolation and disabled live mode', async t => {
  const {app}=createApp({fixtureDelay:0});const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const initial=await fetch(base+'/api/config');const cookie=initial.headers.get('set-cookie').split(';')[0];
  assert.equal((await initial.json()).liveEnabled,false);assert.match(initial.headers.get('set-cookie'),/HttpOnly/);
  const headers={'Content-Type':'application/json',Cookie:cookie,'Idempotency-Key':key};
  assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:JSON.stringify(demo())})).status,403);
  const response=await fetch(base+'/api/jobs',{method:'POST',headers,body:JSON.stringify(demo())});const job=await response.json();assert.equal(response.status,202);
  assert.equal((await fetch(base+'/api/jobs/'+job.id)).status,404);
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(base+'/api/jobs',{method:'POST',headers:{...headers,'Idempotency-Key':key+'-live'},body:JSON.stringify(liveInput())})).status,503);
  const cleared=await fetch(base+'/api/jobs',{method:'DELETE',headers:{Cookie:cookie}});assert.equal((await cleared.json()).providerDeletionConfirmed,false);
  assert.equal((await fetch(base+'/api/jobs/'+job.id,{headers:{Cookie:cookie}})).status,404);
});
