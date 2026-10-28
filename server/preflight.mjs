import { YouCamAdapter } from './youcam.mjs';
import { AppError, publicError } from './errors.mjs';
const PRICE_PATH='/s2s/v2.0/credit/feature-cost';
const WATCH_URL='https://yce-api-01.makeupar.com/s2s/v2.0/task/2d-vto/watch';

export async function checkYouCam({apiKey,fetchImpl=fetch,now=Date.now}={}) {
  const report={
    checkedAt:new Date(now()).toISOString(),status:'blocked',
    evidence:apiKey ? (fetchImpl===fetch ? 'PROVIDER_READ_ONLY_CHECK' : 'INJECTED_PREFLIGHT_TRANSPORT') : 'LOCAL_CONFIGURATION_CHECK_ONLY',
    keyConfigured:Boolean(apiKey),upstreamRequests:0,renderRequests:0,uploads:0,liveRenderVerified:false,
    balance:{status:'not_checked',reason:'The documented v1 balance route requires a separate access token, not the v2 API key. Check the owner dashboard; no token exchange is attempted.'},
    watchPricing:[],priceCatalogComplete:false,blockers:[],
  };
  if(!apiKey) {report.blockers.push('Configure an owner-approved YOUCAM_API_KEY in the project-local ignored .env file.');return report;}
  const adapter=new YouCamAdapter({apiKey,fetchImpl:async(url,options)=>{
    if(options.method!=='GET' || new URL(url).pathname!==PRICE_PATH) throw new AppError('PREFLIGHT_READ_ONLY','Preflight can only read the feature-cost endpoint.');
    report.upstreamRequests++;return fetchImpl(url,options);
  }});
  try {
    const seen=new Set();let token;
    for(let page=0;page<20;page++) {
      const query=new URLSearchParams({page_size:'20'});if(token)query.set('starting_token',token);
      const response=await adapter.request(PRICE_PATH+'?'+query);
      const result=response.result;
      if(!Array.isArray(result?.skus) || result.skus.length>20)throw new AppError('PROVIDER_SCHEMA','Feature-cost response did not match the documented SKU list.',502);
      for(const sku of result.skus) {
        if(sku?.run_task_url!==WATCH_URL)continue;
        if(typeof sku.amount!=='number' || !Number.isFinite(sku.amount) || sku.amount<0 || !Number.isInteger(sku.proc_unit) || sku.proc_unit<1 || !['result_image','second'].includes(sku.unit))throw new AppError('PROVIDER_SCHEMA','Watch pricing returned an unsupported amount or measurement unit.',502);
        report.watchPricing.push({description:typeof sku.description==='string' ? sku.description.slice(0,160) : 'Watch VTO SKU',amount:sku.amount,unit:sku.unit,processingUnit:sku.proc_unit});
      }
      const next=result.next_token;
      if(next===null || next===undefined || next==='') {report.priceCatalogComplete=true;break;}
      if(typeof next!=='string' || next.length>2000 || seen.has(next))throw new AppError('PREFLIGHT_PAGINATION','Feature-cost pagination is malformed or repeated. Pricing is not considered complete.',502);
      seen.add(next);token=next;
    }
    if(!report.priceCatalogComplete)throw new AppError('PREFLIGHT_PAGINATION','Feature-cost catalog exceeded the bounded page limit. Pricing is incomplete.',502);
    report.status=report.watchPricing.length ? 'pricing_observed' : 'watch_price_not_found';
    if(!report.watchPricing.length)report.blockers.push('The complete returned catalog did not identify the exact Watch VTO endpoint. Do not substitute another feature price.');
    report.blockers.push('Account balance and watch-render permission remain unverified. A pricing response does not prove that a render will be accepted.');
    report.blockers.push('No photo was uploaded and no render was created. Legal assets, explicit transfer consent and actual output review are still required.');
  } catch(error) {
    report.status='check_failed';report.error=publicError(error);report.blockers.push('Preflight did not complete. No upstream response body, credential or private account identifier is included in this report.');
  }
  return report;
}
