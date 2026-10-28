import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkYouCam} from '../server/preflight.mjs';
const watch='https://yce-api-01.makeupar.com/s2s/v2.0/task/2d-vto/watch';
const sku={description:'Injected watch price, not a real quote',amount:7.5,unit:'result_image',proc_unit:1,run_task_url:watch};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('preflight without a key is local-only and makes zero requests',async()=>{
  const report=await checkYouCam({fetchImpl:async()=>{throw new Error('must never call');}});
  assert.equal(report.status,'blocked');assert.equal(report.upstreamRequests,0);assert.equal(report.keyConfigured,false);assert.equal(report.liveRenderVerified,false);
});
test('preflight follows documented cost pagination, matches the exact watch endpoint and never uploads/renders',async()=>{
  const calls=[];
  const report=await checkYouCam({apiKey:'private-injected-key',fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.equal(options.method,'GET');assert.equal(new URL(url).pathname,'/s2s/v2.0/credit/feature-cost');
    return calls.length===1 ? response({status:200,result:{next_token:'next/+=token',skus:[{...sku,run_task_url:watch+'-other'}]}}) : response({status:200,result:{next_token:null,skus:[sku]}});
  }});
  const schema=JSON.parse(await readFile(new URL('../research/unit-system-20261023.openapi.json',import.meta.url)));
  assert.ok(schema.paths['/s2s/v2.0/credit/feature-cost'].get);
  assert.equal(new URL(calls[1].url).searchParams.get('starting_token'),'next/+=token');
  assert.equal(report.watchPricing.length,1);assert.equal(report.watchPricing[0].amount,7.5);assert.equal(report.evidence,'INJECTED_PREFLIGHT_TRANSPORT');
  assert.equal(report.status,'pricing_observed');assert.equal(report.priceCatalogComplete,true);assert.equal(report.uploads,0);assert.equal(report.renderRequests,0);
  assert.equal(report.balance.status,'not_checked');assert.ok(!JSON.stringify(report).includes('private-injected-key'));
});
test('preflight does not infer watch pricing from another feature or missing SKU data',async()=>{
  const report=await checkYouCam({apiKey:'injected',fetchImpl:async()=>response({status:200,result:{next_token:null,skus:[{...sku,run_task_url:watch+'-other'}]}})});
  assert.equal(report.status,'watch_price_not_found');assert.equal(report.watchPricing.length,0);assert.equal(report.liveRenderVerified,false);
  const malformed=await checkYouCam({apiKey:'injected',fetchImpl:async()=>response({status:200,result:{next_token:null,skus:[{...sku,proc_unit:0}]}})});
  assert.equal(malformed.status,'check_failed');assert.equal(malformed.error.code,'PROVIDER_SCHEMA');
});
test('preflight bounds repeated pagination and returns safe auth errors without response-body secrets',async()=>{
  const repeated=await checkYouCam({apiKey:'injected',fetchImpl:async()=>response({status:200,result:{next_token:'same',skus:[]}})});
  assert.equal(repeated.status,'check_failed');assert.equal(repeated.upstreamRequests,2);assert.equal(repeated.error.code,'PREFLIGHT_PAGINATION');
  const denied=await checkYouCam({apiKey:'DO_NOT_OUTPUT',fetchImpl:async()=>response({debug:'DO_NOT_OUTPUT',account:'private-account'},401)});
  assert.equal(denied.status,'check_failed');assert.equal(denied.error.code,'PROVIDER_AUTH');assert.ok(!JSON.stringify(denied).includes('DO_NOT_OUTPUT'));assert.ok(!JSON.stringify(denied).includes('private-account'));
});
