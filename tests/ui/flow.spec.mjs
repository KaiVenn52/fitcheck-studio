import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const failures = new WeakMap();
test.beforeEach(async ({page}) => {
  const errors=[];failures.set(page,errors);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
});
test.afterEach(async ({page}, info) => {
  const errors = failures.get(page);
  // This boundary test deliberately returns HTTP 503. Chromium logs that HTTP failure in its console.
  const unexpected = info.title.startsWith('injected enabled configuration')
    ? errors.filter(message => !message.includes('503 (Service Unavailable)')) : errors;
  expect(unexpected).toEqual([]);
});
const run = async page => {
  await page.getByRole('button',{name:'Compare sample looks'}).click();
  await expect(page.getByText('Comparison ready',{exact:true})).toBeVisible({timeout:12000});
};
test('desktop comparison, private shortlist, export, reload recovery and clear', async ({page}) => {
  const requests=[];page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
  await page.goto('/');await expect(page).toHaveTitle(/FitCheck Studio/);
  await expect(page.getByRole('heading',{name:'Find your everyday.'})).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await expect(page.getByText('YouCam live mode disabled',{exact:true})).toBeVisible();
  await run(page);
  await expect(page.getByAltText(/The Field.*illustrated workflow fixture/)).toBeVisible();
  await page.getByRole('button',{name:'Save look A',exact:true}).click();
  await page.getByLabel('What would make it yours?').fill('Olive canvas for workdays. Confirm strap dimensions with the retailer.');
  await page.screenshot({path:'qa/desktop-comparison.png',fullPage:true});
  await page.getByRole('button',{name:/Your shortlist/}).click();
  await expect(page.getByRole('heading',{name:'The Field / olive'})).toBeVisible();
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export shortlist'}).click();
  const download=await downloadEvent;const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  expect(exported.evidence).toBe('LOCAL_WORKFLOW_FIXTURE_NOT_YOUCAM');expect(exported.favorite).toBe('The Field / olive');
  expect(JSON.stringify(exported)).not.toMatch(/base64|resultUrl|https:\/\//);
  await writeFile('qa/example-shortlist.json',JSON.stringify(exported,null,2));
  await page.screenshot({path:'qa/desktop-shortlist.png',fullPage:true});
  await page.reload();await expect(page.getByText(/Recovered your most recent comparison/)).toBeVisible();
  await page.getByRole('button',{name:/Your shortlist/}).click();await expect(page.getByRole('button',{name:'Export shortlist'})).toBeVisible();
  await page.getByRole('button',{name:'Clear local session'}).click();
  await expect(page.getByText(/Local session cleared/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Compare sample looks'})).toBeVisible();
  expect(requests.filter(r=>r.url.includes('makeupar.com'))).toHaveLength(0);
  expect(requests.filter(r=>r.url.endsWith('/api/jobs') && r.method==='POST')).toHaveLength(1);
});
test('mobile layout stays within viewport and supports changing samples and saving a look', async ({page}) => {
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:/The Diver/}).click();
  await run(page);
  await expect(page.getByRole('heading',{name:'The Diver / midnight'})).toBeVisible();
  await page.getByRole('button',{name:'Save look B',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({path:'qa/mobile-comparison.png',fullPage:true});
  await page.getByRole('button',{name:/Your shortlist/}).click();
  await expect(page.getByRole('button',{name:'Export shortlist'})).toBeVisible();
  await page.screenshot({path:'qa/mobile-shortlist.png',fullPage:true});
});
test('timeout recovery uses the existing job ID without a second POST', async ({page}) => {
  let creates=0;page.on('request',r=>{if(r.url().endsWith('/api/jobs') && r.method()==='POST')creates++;});
  await page.goto('/');await page.locator('summary').filter({hasText:'Explore recovery states'}).click();
  await page.getByLabel('Next demo comparison').selectOption('timeout');
  await page.getByRole('button',{name:'Compare sample looks'}).click();
  await expect(page.getByText(/Simulated slow task/)).toBeVisible({timeout:12000});
  await page.screenshot({path:'qa/timeout-recovery.png',fullPage:true});
  // Server interval protects repeated task polls.
  await expect(async()=>{await page.getByRole('button',{name:'Check same task'}).click();await expect(page.getByText('Comparison ready',{exact:true})).toBeVisible();}).toPass({timeout:10000});
  expect(creates).toBe(1);
});
test('rate limit enforces wait then recovers, and detection error preserves the other result', async ({page}) => {
  await page.goto('/');await page.locator('summary').filter({hasText:'Explore recovery states'}).click();
  await page.getByLabel('Next demo comparison').selectOption('rate-limit');
  await page.getByRole('button',{name:'Compare sample looks'}).click();
  await expect(page.getByText(/Simulated YouCam rate limit/)).toBeVisible({timeout:12000});
  await expect(page.getByRole('button',{name:'Check same task'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Check same task'})).toBeEnabled({timeout:8000});
  await page.getByRole('button',{name:'Check same task'}).click();await expect(page.getByText('Comparison ready',{exact:true})).toBeVisible();
  await page.getByLabel('Next demo comparison').selectOption('detection');await page.getByRole('button',{name:'Compare sample looks'}).click();
  await expect(page.getByText('Try a clearer photo',{exact:true})).toBeVisible({timeout:12000});
  await expect(page.getByRole('button',{name:'Save look A',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Save look B',exact:true})).toHaveCount(0);
  await page.screenshot({path:'qa/detection-failure.png',fullPage:true});
});
test('live-disabled UI previews local photos without any create or provider request', async ({page}) => {
  let creates=0;page.on('request',r=>{if(r.url().endsWith('/api/jobs')&&r.method()==='POST')creates++;});
  await page.goto('/');await page.getByLabel('Preview mode',{exact:true}).selectOption('live');
  await page.getByLabel('Your wrist photo',{exact:true}).setInputFiles('tests/fixture-input.png');
  await expect(page.getByAltText('Your wrist photo local preview')).toBeVisible();
  await expect(page.getByRole('button',{name:'Review photo transfer'})).toBeDisabled();
  await expect(page.getByText(/Live previews are disabled/)).toBeVisible();
  await page.screenshot({path:'qa/live-disabled.png',fullPage:true});
  expect(creates).toBe(0);
});
test('injected enabled configuration verifies explicit three-part confirmation; no provider is contacted', async ({page}) => {
  await page.route('**/api/config',route=>route.fulfill({json:{liveEnabled:true,liveVerified:false}}));
  let creates=0;
  await page.route('**/api/jobs',async route=>{
    if(route.request().method()==='POST') { creates++;const body=route.request().postDataJSON();expect(body.consent).toEqual({version:'photo-transfer-v1',rights:true,transfer:true,units:true});await route.fulfill({status:503,json:{error:{code:'INJECTED_DISABLED',message:'Injected boundary test: no provider request made.'}}}); }
    else await route.continue();
  });
  await page.goto('/');await page.getByLabel('Preview mode',{exact:true}).selectOption('live');
  for(const label of ['Your wrist photo','Watch A photo','Watch B photo']) await page.getByLabel(label,{exact:true}).setInputFiles('tests/fixture-input.png');
  await page.getByRole('button',{name:'Review photo transfer'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'Send to YouCam',exact:true})).toBeDisabled();
  const checks=page.getByRole('dialog').getByRole('checkbox');
  await checks.nth(0).check();await checks.nth(1).check();
  await expect(page.getByRole('button',{name:'Send to YouCam',exact:true})).toBeDisabled();
  await checks.nth(2).check();
  await page.screenshot({path:'qa/consent-injected-test.png',fullPage:true});
  await page.getByRole('button',{name:'Send to YouCam',exact:true}).click();
  await expect(page.getByText(/Injected boundary test/)).toBeVisible();expect(creates).toBe(1);
});

test('Change mode works from the shortlist and restores focus to the fitting-room selector',async({page})=>{
  await page.goto('/');await run(page);
  await page.getByRole('button',{name:'Save look A',exact:true}).click();
  await page.getByRole('button',{name:/Your shortlist/}).click();
  await page.getByRole('button',{name:'Change mode',exact:true}).click();
  await expect(page.getByLabel('Preview mode',{exact:true})).toBeFocused();
  await expect(page.getByRole('heading',{name:'Your fitting room'})).toBeVisible();
});

test('reload restores selected fixture products as well as completed results',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:/The Diver/}).click();await run(page);
  await page.reload();await expect(page.getByText(/Recovered your most recent comparison/)).toBeVisible();
  await expect(page.getByRole('button',{name:/The Field/})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:/The Dress/})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:/The Diver/})).toHaveAttribute('aria-pressed','true');
});

test('injected uncertain submission keeps the acknowledged task checkable until it completes',async({page})=>{
  let resumeCount=0,createCount=0;
  const original={id:'injected-uncertain-job',mode:'fixture',state:'uncertain',createdAt:Date.now(),expiresAt:Date.now()+1800000,canResume:true,
    error:{code:'SUBMISSION_UNCERTAIN',message:'Injected test: the second task was not acknowledged. The first task can still be checked.'},
    items:[{label:'Injected acknowledged look',productId:'field',state:'running',hasProviderTask:true,result:null},{label:'Injected uncertain look',productId:'dress',state:'submitting',hasProviderTask:false,result:null}]};
  await page.route('**/api/jobs',route=>{
    if(route.request().method()==='POST')createCount++;
    return route.fulfill({json:{jobs:[original]}});
  });
  await page.route('**/api/jobs/injected-uncertain-job/resume',route=>{
    resumeCount++;return route.fulfill({json:resumeCount===1 ? original : {...original,canResume:false,items:[{...original.items[0],state:'success',result:'/fixtures/field-on-wrist.svg'},original.items[1]]}});
  });
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Check acknowledged task'})).toBeVisible();
  await page.getByRole('button',{name:'Check acknowledged task'}).click();
  await expect(page.getByRole('button',{name:'Check acknowledged task'})).toBeEnabled();
  await page.getByRole('button',{name:'Check acknowledged task'}).click();
  await expect(page.getByRole('button',{name:'Save look A',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check acknowledged task'})).toHaveCount(0);
  await expect(page.getByText('Submission needs a manual check')).toBeVisible();
  await expect(page.getByText('Submission not confirmed',{exact:true})).toBeVisible();
  await page.screenshot({path:'qa/uncertain-partial-result-injected.png',fullPage:true});
  expect(resumeCount).toBe(2);expect(createCount).toBe(0);
});
