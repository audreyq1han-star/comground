import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createProductionHarness, syntheticPassword, expectStatus } from '../scripts/test-production-http.mjs';

// Run only after the shared build. This harness starts one isolated loopback fixture server on port 3119.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const h=await createProductionHarness(3119),output='output/playwright/source-control';
const email='source.operator.synthetic@example.invalid',studentEmail='source.student.synthetic@example.invalid';
const password=syntheticPassword(),studentPassword=syntheticPassword(),checks=[],errors=[],external=[];
let browser;
const check=name=>{checks.push(name);console.log('PASS',name);};
const overview=async()=>expectStatus(await h.request('/api/admin/source-control',{actor:'operator'})).data;
async function fit(page,label){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} fits viewport`);}
async function mutation(page,button){const response=page.waitForResponse(item=>item.url().endsWith('/api/admin/source-control')&&item.request().method()==='POST');await button.click();const result=await response;assert(result.ok(),await result.text());await page.waitForLoadState('networkidle');}
try{
  await mkdir(output,{recursive:true});await mkdir('docs/evidence',{recursive:true});
  await h.start('test',{COMGROUND_TEST_FIXTURES:'1',COMGROUND_SKIP_DEMO_SEED:'0'});
  for(const [address,secret]of [[email,password],[studentEmail,studentPassword]]){
    expectStatus(await h.request('/api/account/register',{method:'POST',body:{email:address,password:secret,adultConfirmed:true}}),202);
    expectStatus(await h.request('/api/account/verification/confirm',{method:'POST',body:{token:h.actionLink(address,'VERIFY_EMAIL').token,password:secret}}));
  }
  h.bootstrap(email);
  expectStatus(await h.request('/api/account/session',{actor:'operator',method:'POST',body:{email,password}}));
  expectStatus(await h.request('/api/account/session',{actor:'student',method:'POST',body:{email:studentEmail,password:studentPassword}}));
  expectStatus(await h.request('/api/admin/source-control'),401);
  expectStatus(await h.request('/api/admin/source-control',{actor:'student'}),403);
  expectStatus(await h.request('/api/admin/source-control',{actor:'operator',method:'POST',body:{action:'SCHEDULE'},requestOrigin:'https://outside.invalid'}),403);
  check('Source operations require operator authentication and same-origin mutations');
  const initial=await overview();
  const published=h.database(db=>db.prepare("SELECT id,source_id,record_json FROM opportunities WHERE status='PUBLISHED' ORDER BY id LIMIT 1").get());assert(published);
  const source=initial.sources.find(item=>item.id===published.source_id);assert(source);
  expectStatus(await h.request(`/api/opportunities/${published.id}`));
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const ctx=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  await ctx.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==h.base&&!['data:','blob:'].includes(url.protocol)){external.push(url.origin);return route.abort();}return route.continue();});
  const page=await ctx.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'||/Content Security Policy/.test(message.text()))errors.push(message.text());});
  await page.goto(`${h.base}/account/login`);await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:'You’re signed in.',exact:true}).waitFor();
  await page.goto(`${h.base}/admin/source-control`);await page.getByRole('heading',{name:'Permissions first. Recoverable imports.',exact:true}).waitFor();
  let panel=page.getByRole('heading',{name:source.name,exact:true}).locator('xpath=ancestor::section[1]');
  for(const [label,text]of [['Attribution required by the source','Synthetic source attribution'],['Synthetic permission evidence','Fictional rights only; local test permission'],['Removal request route','Synthetic operator removal queue'],['Reason for this version','Register synthetic source contract']])await panel.getByLabel(label,{exact:true}).fill(text);
  await mutation(page,panel.getByRole('button',{name:'Save permission version',exact:true}));
  assert.equal((await overview()).health.find(item=>item.sourceId===source.id).permission.version,1);
  await mutation(page,page.getByRole('button',{name:'Queue due synthetic runs',exact:true}));
  await mutation(page,page.getByRole('button',{name:'Simulate fixture batch',exact:true}));
  const staged=(await overview()).stages.find(item=>item.sourceId===source.id&&item.state==='STAGED');assert(staged);
  const card=page.locator('article.op-panel').filter({has:page.getByRole('heading',{name:staged.record.title,exact:true})});
  await mutation(page,card.getByRole('button',{name:'Import staged record for review',exact:true}));
  assert.equal((await overview()).stages.find(item=>item.id===staged.id).state,'IMPORTED');
  check('Permission version, due run, leased fixture batch and staged catalogue import persist through the UI');
  await page.screenshot({path:`${output}/source-desktop.png`,fullPage:true});
  for(const width of [390,320]){await page.setViewportSize({width,height:1000});await fit(page,`Source controls at ${width}px`);}
  await page.screenshot({path:`${output}/source-phone.png`,fullPage:true});
  check('Source permission, run and staging controls fit 390px and 320px viewports');
  panel=page.getByRole('heading',{name:source.name,exact:true}).locator('xpath=ancestor::section[1]');
  await panel.getByText('Edit permission and scope',{exact:true}).click();
  await panel.getByLabel('Allowed path prefix',{exact:true}).fill('/restricted/');
  await panel.getByLabel('Reason for this version',{exact:true}).fill('Synthetic narrowing outside the existing listing source');
  await mutation(page,panel.getByRole('button',{name:'Save permission version',exact:true}));
  const narrowed=(await overview()).health.find(item=>item.sourceId===source.id).permission;assert.equal(narrowed.version,2);
  expectStatus(await h.request(`/api/opportunities/${published.id}`),404);
  const {sourceId,version,updatedAt,...editable}=narrowed;
  const oldSave=await h.request('/api/admin/source-control',{actor:'operator',method:'POST',body:{action:'SAVE_PERMISSION',sourceId:source.id,input:{...editable,expectedVersion:1,reason:'Stale synthetic write'}}});
  assert.equal(oldSave.status,409);
  check('Narrowing a current source contract removes an existing publication from public reads');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile('docs/evidence/source-control-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),mode:'synthetic-local-only',checks,pageErrors:errors,externalRequests:external,screenshots:[`${output}/source-desktop.png`,`${output}/source-phone.png`]},null,2));
}finally{await browser?.close();await h.cleanup();}
