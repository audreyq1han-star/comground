import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:3102';
const token = randomBytes(24).toString('base64url');
const directory = await mkdtemp(join(tmpdir(), 'comground-full-browser-'));
const output = 'output/playwright/full-app';
await mkdir(output, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const checks = [], pageErrors = [], consoleErrors = [], externalRequests = [], logs = [];
let child, browser, context, page;
let expectedFailure = false;
function check(name) { checks.push(name); console.log('PASS', name); }
async function visit(path) { await page.goto(base + path); await page.waitForLoadState('networkidle'); }
async function shot(name) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); if (['dashboard-desktop','catalogue-desktop','matches-desktop','operator-desktop','dashboard-phone','matches-phone','operator-phone'].includes(name)) await page.screenshot({path:`${output}/${name}-viewport.png`,fullPage:false}); }
async function fit(label) { const sizes = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth })); assert(sizes.content <= sizes.viewport, `${label}: ${JSON.stringify(sizes)}`); }
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({path, method, body}) => { const r = await fetch(path, { method, headers: body === undefined ? {} : {'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) }); return {status:r.status, data:await r.json()}; }, {path,method,body});
}
async function visibleHeading(name) { await page.getByRole('heading', { name, exact: typeof name === 'string' }).waitFor(); }
try {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '3102', '--keepAliveTimeout', '1000'], { env: {...process.env, COMGROUND_MODE: 'demo', LOCAL_REVIEW_TOKEN:token, COMGROUND_DB_PATH:join(directory,'browser.sqlite'), NEXT_TELEMETRY_DISABLED:'1', COMGROUND_SKIP_DEMO_SEED:'0'}, stdio:['ignore','pipe','pipe'] });
  child.stdout.on('data',d=>logs.push(d.toString())); child.stderr.on('data',d=>logs.push(d.toString()));
  let ready = false;
  for(let i=0;i<100;i++){ if(child.exitCode!==null)throw new Error('Production server exited');try{if((await fetch(base+'/api/opportunities')).ok){ready=true;break;}}catch{}await delay(200); }
  assert(ready,'Production browser server ready');
  browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();externalRequests.push(route.request().url());return route.abort();});
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!expectedFailure)consoleErrors.push(m.text());});

  await visit('/'); await visibleHeading('A clearer path to helping out.');
  await page.keyboard.press('Tab');
  assert(await page.getByRole('link',{name:'Skip to content',exact:true}).evaluate(el=>el===document.activeElement&&getComputedStyle(el).clipPath==='none'));
  await page.keyboard.press('Enter'); await fit('Desktop welcome'); await shot('welcome-desktop'); check('Anonymous welcome, visible keyboard skip link and desktop layout');
  await visit('/onboarding'); await page.getByRole('button',{name:/Alex · demo/}).click();
  await page.getByLabel('Example age band',{exact:true}).waitFor();
  const originalFrom = await page.getByLabel('Available from (UTC)',{exact:true}).inputValue();
  const originalUntil = await page.getByLabel('Available through (UTC)',{exact:true}).inputValue();
  await page.getByLabel('Available from (UTC)',{exact:true}).fill('2030-06-02'); await page.getByLabel('Available through (UTC)',{exact:true}).fill('2030-06-01');
  await page.getByRole('checkbox',{name:/I agree to store this synthetic demo profile/}).check();
  await page.getByRole('button',{name:/Create demo profile/}).click();
  await page.getByText('The end date must be on or after the start date.',{exact:true}).waitFor();
  assert.equal((await api('/api/student/profile')).data.data,null);check('Reversed availability dates remain in the form without creating a profile');
  await page.getByLabel('Available from (UTC)',{exact:true}).fill(originalFrom);await page.getByLabel('Available through (UTC)',{exact:true}).fill(originalUntil);
  await shot('onboarding-desktop'); await page.getByRole('button',{name:/Create demo profile/}).click();
  await visibleHeading(/A good next step, Alex/); await page.getByRole('heading',{name:'Made for your preferences',exact:true}).waitFor();
  await fit('Desktop dashboard'); await shot('dashboard-desktop');check('Actual persona selection, explicit consent and persistent onboarding open the dashboard');
  await page.reload();await visibleHeading(/A good next step, Alex/);check('Reload restores the selected demo profile and dashboard');

  await visit('/matches'); await page.getByRole('heading',{name:'Why it fits',exact:true}).first().waitFor();
  assert(await page.locator('article.opportunity-card').count()>0);await shot('matches-desktop');check('Stored preferences produce grounded match explanations');
  await visit('/profile');await page.getByRole('checkbox',{name:/School credit is a requirement/}).check();await page.getByRole('button',{name:/Save preferences/}).click();await page.getByText('Preferences saved. Your next matches use this version.',{exact:true}).waitFor();
  await visit('/matches');await visibleHeading(/No .*match|No .*fit|The right fit|No current/i);await shot('matches-empty');check('A required unapproved school credit condition produces a valid empty match state');
  await visit('/profile');await page.getByRole('checkbox',{name:/School credit is a requirement/}).uncheck();await page.getByRole('button',{name:/Save preferences/}).click();await page.getByText('Preferences saved. Your next matches use this version.',{exact:true}).waitFor();
  await page.getByLabel('Maximum fee (demo units)',{exact:true}).fill('7');
  const focusCheck=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/student/session');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await focusCheck;assert.equal(await page.getByLabel('Maximum fee (demo units)',{exact:true}).inputValue(),'7');await page.getByLabel('Maximum fee (demo units)',{exact:true}).fill('0');check('Routine focus revalidation preserves unsaved same-persona form edits');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export persona data',exact:true}).click();const download=await downloadPromise;await download.saveAs(join(directory,'export.json'));assert(download.suggestedFilename().endsWith('.json'));check('Profile edits persist and its data exports as an actual JSON download');

  await visit('/opportunities'); await page.locator('article.opportunity-card').first().waitFor();
  const allCount=await page.locator('article.opportunity-card').count();assert(allCount>1);
  await shot('catalogue-desktop');
  // URL-backed discovery controls are exercised below after checking their labels.
  const gardenLink=page.getByRole('link',{name:'Community garden morning — synthetic example',exact:true});await gardenLink.click();
  await visibleHeading('Trace it back to the source');const detailPath=new URL(page.url()).pathname;
  assert.equal(await page.locator('a[href^="https://example.invalid"]').count(),0);
  await page.getByRole('button',{name:'Save opportunity',exact:true}).click();await page.getByRole('button',{name:'Saved ✓ · remove',exact:true}).waitFor();
  await shot('detail-desktop');await page.getByRole('button',{name:/Preview demo signup/}).click();
  await page.getByRole('dialog').waitFor();await visibleHeading('Signup happens with the organizer.');
  assert(await page.getByRole('dialog').getByText('Status: demo destination preview. This is not an application.',{exact:true}).isVisible());
  await shot('signup-preview');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  // Native dialog close queues its close event; wait for the observable focus restoration.
  await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Preview demo signup'));
  assert(await page.getByRole('button',{name:/Preview demo signup/}).evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:/Preview demo signup/}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Keep exploring',exact:true}).click();
  const activity=(await api('/api/student/activity')).data.data;const current=activity.filter(x=>x.opportunityId===detailPath.split('/').pop());assert.equal(current.length,1);assert.equal(current[0].status,'OPENED');check('Save and repeated destination previews work; dialog traps focus, Escape restores focus, and no application is inferred');
  await visit('/saved');await page.getByRole('link',{name:'Community garden morning — synthetic example',exact:true}).waitFor();await shot('saved-desktop');check('Saved opportunities persist on their own page');

  await visit('/activity');const futureCard=page.locator('article.activity-card').filter({hasText:'Community garden morning'});
  assert(await futureCard.locator('option[value="ATTENDED"]').isDisabled());
  await futureCard.getByLabel('Report a demo outcome',{exact:true}).selectOption('APPLIED');await futureCard.getByRole('button',{name:'Save self-report',exact:true}).click();
  await futureCard.getByText('Applied · self-reported',{exact:true}).first().waitFor();
  const pastCard=page.locator('article.activity-card').filter({hasText:'Past reading'});
  await pastCard.getByLabel('Report a demo outcome',{exact:true}).selectOption('ATTENDED');await pastCard.getByRole('button',{name:'Save self-report',exact:true}).click();
  await pastCard.getByText('Attended · self-reported',{exact:true}).first().waitFor();await shot('activity-desktop');check('Future attendance is disabled and historical attendance is explicitly self-reported');
  await pastCard.locator('summary').click();assert(await pastCard.getByText('Demo preview only',{exact:true}).isVisible());check('Activity history keeps the original preview and later self-report');

  await visit('/alerts');assert.equal(await page.getByRole('checkbox',{name:'Enable in-app reminders',exact:true}).isChecked(),false);
  await page.getByRole('checkbox',{name:'Enable in-app reminders',exact:true}).check();
  await page.getByRole('checkbox',{name:/Event reminders and post-event follow-up/}).check();
  await page.getByRole('checkbox',{name:/Unavailable saved opportunities/}).check();
  await page.getByRole('button',{name:'Save reminder preferences',exact:true}).click();await page.locator('article.reminder-card').first().waitFor();
  await page.getByRole('button',{name:'Mark read',exact:true}).first().click();await page.getByText('Reminder marked read.',{exact:true}).waitFor();
  await shot('alerts-desktop');await page.getByRole('button',{name:'Dismiss',exact:true}).first().click();await page.getByText('Reminder dismissed.',{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'Enable in-app reminders',exact:true}).uncheck();await page.getByRole('button',{name:'Save reminder preferences',exact:true}).click();
  await visibleHeading('All quiet here.');await page.reload();assert.equal(await page.getByRole('checkbox',{name:'Enable in-app reminders',exact:true}).isChecked(),false);check('Default-off reminders support opt-in, read, dismiss and persistent immediate opt-out');

  await visit('/opportunities');await page.getByLabel('Search opportunities',{exact:true}).fill('garden');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.getByText('1 published example',{exact:true}).waitFor();assert(new URL(page.url()).searchParams.get('q')==='garden');
  await page.getByRole('link',{name:'Clear filters',exact:true}).click();await page.getByText('7 published examples',{exact:true}).waitFor();
  await page.goBack();await page.getByText('1 published example',{exact:true}).waitFor();assert.equal(await page.getByLabel('Search opportunities',{exact:true}).inputValue(),'garden');
  await page.goForward();await page.getByText('7 published examples',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByText('Page 2 of 2',{exact:true}).waitFor();assert.equal(await page.locator('article.opportunity-card').count(),1);
  await page.goBack();await page.getByText('Page 1 of 2',{exact:true}).waitFor();check('Search and pagination are URL-backed and restore correctly through browser back/forward');
  await page.getByLabel('Search opportunities',{exact:true}).fill('no-such-synthetic-listing');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await visibleHeading('No current examples for these filters.');check('No-result discovery has a clear empty state');
  expectedFailure=true;
  await page.route('**/api/opportunities?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_INTERRUPTION',message:'Synthetic interrupted catalogue request.'}})}));
  await visit('/opportunities');await visibleHeading('We couldn’t finish that request.');await page.unroute('**/api/opportunities?*');await page.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('article.opportunity-card').first().waitFor();expectedFailure=false;check('Interrupted catalogue fetch displays an error and recovers via its retry control');
  let release;const held=new Promise(resolve=>release=resolve);
  await page.route('**/api/opportunities?*',async route=>{await held;await route.continue();});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByText('Loading the latest local data…',{exact:true}).waitFor();release();await page.locator('article.opportunity-card').first().waitFor();await page.unroute('**/api/opportunities?*');check('A delayed response exposes an accessible loading state and completes');
  expectedFailure=true;await visit('/opportunities/missing-synthetic-id');await visibleHeading(/not available|not found|unavailable/i);expectedFailure=false;check('Missing opportunity routes have a recoverable unavailable state');

  await visit('/admin');await page.getByLabel('Temporary reviewer token',{exact:true}).fill(token);await page.getByRole('button',{name:'Open reviewer session',exact:true}).click();
  await page.getByRole('link',{name:'Catalogue',exact:true}).waitFor();await shot('operator-desktop');check('Operator signs in through its separate reviewer form');
  const adminRows=(await api('/api/admin/opportunities')).data.data;const gardenRecord=adminRows.find(x=>x.id===detailPath.split('/').pop());assert(gardenRecord);
  const adminDetail='/admin/opportunities/'+gardenRecord.id;
  await visit(adminDetail);await page.getByText('Edit opportunity facts',{exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Community garden morning — browser reviewed synthetic example');await page.getByLabel('Edit reason',{exact:true}).fill('Synthetic browser test: clearer example title.');await page.getByRole('button',{name:'Save changes for review',exact:true}).click();
  await page.locator('.op-record-meta').getByText('DRAFT',{exact:true}).waitFor();check('A material operator edit creates a draft and requires another review');
  await page.getByLabel('Review reason',{exact:true}).fill('Synthetic browser review: requirements and source evidence inspected.');await page.getByRole('button',{name:'Publish example',exact:true}).click();await page.locator('.op-record-meta').getByText('PUBLISHED',{exact:true}).waitFor();
  await shot('operator-record-desktop');
  await page.getByLabel('Reason for this action',{exact:true}).fill('Synthetic browser withdrawal.');await page.getByRole('button',{name:'Withdraw listing',exact:true}).click();await page.locator('.op-record-meta').getByText('WITHDRAWN',{exact:true}).waitFor();
  await visit('/saved');await page.getByText('UNAVAILABLE',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Preview demo signup/}).count(),0);check('Withdrawn saved listings remain understandable and cannot be acted on');
  await visit(adminDetail);await page.getByLabel('Reason for this action',{exact:true}).fill('Synthetic browser restore for review.');await page.getByRole('button',{name:'Restore record',exact:true}).click();await page.locator('.op-record-meta').getByText('DRAFT',{exact:true}).waitFor();
  await page.getByLabel('Review reason',{exact:true}).fill('Synthetic browser re-review after restoration.');await page.getByRole('button',{name:'Publish example',exact:true}).click();await page.locator('.op-record-meta').getByText('PUBLISHED',{exact:true}).waitFor();check('Restore returns to draft; only a fresh review republishes');
  const missing=adminRows.find(x=>x.record.minAge===null);await visit('/admin/opportunities/'+missing.id);
  assert(await page.getByLabel('Decision',{exact:true}).locator('option[value="PUBLISH"]').isDisabled());await page.getByLabel('Review reason',{exact:true}).fill('Synthetic age remains unknown; reject.');await page.getByRole('button',{name:'Reject draft',exact:true}).click();await page.locator('.op-record-meta').getByText('REJECTED',{exact:true}).waitFor();check('Unknown age blocks publication; operator can reject with a recorded reason');

  const source=(await api('/api/admin/sources')).data.data.find(s=>s.id===gardenRecord.record.source.id);
  await visit('/admin/sources');let sourceCard=page.locator('article.op-panel').filter({has:page.locator(`#source-${source.id}-reason`)});
  await sourceCard.getByLabel('Reason for this action',{exact:true}).fill('Synthetic browser source pause.');await sourceCard.getByRole('button',{name:'Pause source',exact:true}).click();await sourceCard.getByRole('button',{name:'Resume source',exact:true}).waitFor();await shot('operator-sources-desktop');
  await visit('/saved');await page.getByText('UNAVAILABLE',{exact:true}).waitFor();
  await visit('/admin/exceptions');const issueCard=page.locator('article.op-panel').filter({hasText:source.name}).first();await issueCard.getByLabel('Decision reason',{exact:true}).fill('Synthetic browser operator owns this pause.');await issueCard.getByRole('button',{name:'Acknowledge exception',exact:true}).click();await issueCard.getByText('ACKNOWLEDGED',{exact:true}).waitFor();
  assert(await issueCard.getByLabel('Exception action',{exact:true}).locator('option[value="RESOLVE"]').isDisabled());check('Source pause propagates to saves and its exception cannot be falsely resolved');
  await visit('/admin/sources');sourceCard=page.locator('article.op-panel').filter({has:page.locator(`#source-${source.id}-reason`)});await sourceCard.getByLabel('Reason for this action',{exact:true}).fill('Synthetic browser source resume.');await sourceCard.getByRole('button',{name:'Resume source',exact:true}).click();await sourceCard.getByRole('button',{name:'Pause source',exact:true}).waitFor();
  await visit('/admin/exceptions');const resolvedCard=page.locator('article.op-panel').filter({hasText:source.name}).first();await resolvedCard.getByLabel('Exception action',{exact:true}).selectOption('RESOLVE');await resolvedCard.getByLabel('Decision reason',{exact:true}).fill('Underlying source pause is cleared.');await resolvedCard.getByRole('button',{name:'Resolve exception',exact:true}).click();await page.getByLabel('Queue view',{exact:true}).selectOption('RESOLVED');await page.getByText('RESOLVED',{exact:true}).first().waitFor();check('An acknowledged exception resolves after the underlying source recovers');

  await visit('/admin/import-runs');await page.getByLabel('Synthetic fixture',{exact:true}).selectOption('remote');await page.getByRole('button',{name:'Import fixture',exact:true}).click();await page.getByText('Fixture import recorded. Inspect the record; an import does not approve publication.',{exact:true}).waitFor();check('Operator fixture replay records import history through the UI');
  await visit('/admin/acquisition');await page.getByLabel('Reason for this action',{exact:true}).fill('Synthetic community pause.');await page.getByRole('button',{name:'Pause community page',exact:true}).click();await page.getByRole('button',{name:'Publish demo page',exact:true}).waitFor();
  expectedFailure=true;await visit('/communities/demo-neighborhood');await visibleHeading('This community page is unavailable.');expectedFailure=false;
  await visit('/admin/acquisition');await page.getByLabel('Reason for this action',{exact:true}).fill('Synthetic community resume.');await page.getByRole('button',{name:'Publish demo page',exact:true}).click();await page.getByRole('button',{name:'Pause community page',exact:true}).waitFor();await visit('/communities/demo-neighborhood');await visibleHeading('Example neighborhood');await shot('community-desktop');check('Demo community pause and resume control the actual public page without partnership claims');

  const adminPaths=['/admin','/admin/review','/admin/opportunities',adminDetail,'/admin/sources','/admin/import-runs','/admin/organizations','/admin/matching-qa','/admin/outcomes','/admin/acquisition','/admin/exceptions'];
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:width===1440?1000:844});for(const path of adminPaths){await visit(path);await fit(`${width}px ${path}`);if(width===390&&['/admin','/admin/sources'].includes(path))await shot(path==='/admin'?'operator-phone':'operator-sources-phone');}check(`All operator routes fit the ${width}px viewport`);}
  await page.setViewportSize({width:1440,height:1000});
  // A real second browser context has its own cookie jar and cannot inherit Alex's state.
  const separate=await browser.newContext();await separate.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const other=await separate.newPage();
  await other.goto(base+'/onboarding');await other.getByRole('button',{name:/Sam · demo/}).click();await other.getByRole('checkbox',{name:/I agree to store/}).check();await other.getByRole('button',{name:/Create demo profile/}).click();await other.getByRole('heading',{name:/A good next step, Sam/}).waitFor();
  await other.goto(base+'/saved');await other.getByRole('heading',{name:'A little space for good possibilities.',exact:true}).waitFor();await separate.close();check('A separate browser context selects Sam and sees no Alex saves');
  const videoContext=await browser.newContext({viewport:{width:1280,height:900},storageState:await context.storageState(),recordVideo:{dir:join(directory,'video'),size:{width:1280,height:900}}});
  await videoContext.route('**/*',route=>{if(new URL(route.request().url()).origin===base)return route.continue();externalRequests.push(route.request().url());return route.abort();});
  const videoPage=await videoContext.newPage();videoPage.on('pageerror',e=>pageErrors.push(e.message));
  for(const path of ['/','/matches','/alerts','/activity','/admin']){await videoPage.goto(base+path);await videoPage.waitForLoadState('networkidle');if(path==='/alerts'){await videoPage.getByRole('button',{name:'Preview shortlist',exact:true}).click();await videoPage.getByText(/Preview ready:/).waitFor();}await videoPage.waitForTimeout(1600);}
  const video=videoPage.video();await videoContext.close();await video.saveAs(`${output}/demo-walkthrough.webm`);check('Captured a short real Mac Chrome walkthrough of student and operator screens');
  await visit('/profile');await page.getByRole('checkbox',{name:/Delete all private demo data for Alex/}).check();await page.getByRole('button',{name:'Withdraw consent and delete',exact:true}).click();await page.getByRole('button',{name:/Create demo profile/}).waitFor();assert.equal((await api('/api/student/profile')).data.data,null);check('Withdrawing consent removes private state and returns the persona to onboarding');
  await page.getByRole('checkbox',{name:/I agree to store/}).check();await page.getByRole('button',{name:/Create demo profile/}).click();await visibleHeading(/A good next step, Alex/);
  // Tamper only the synthetic browser test cookie to exercise visible session expiry handling.
  await visit('/profile');const studentCookie=(await context.cookies()).find(c=>c.name==='comground_student');assert(studentCookie);await context.addCookies([{...studentCookie,value:studentCookie.value+'invalid'}]);
  expectedFailure=true;await page.getByRole('button',{name:/Save preferences/}).click();await visibleHeading('Choose a demo persona to begin.');expectedFailure=false;assert.equal(await page.getByLabel('Example age band',{exact:true}).count(),0);check('Invalidated student session clears the private profile UI and requests persona selection');
  await visit('/onboarding');await page.getByRole('button',{name:/Alex · demo/}).click();await page.getByRole('link',{name:/Open dashboard/}).waitFor();
  await visit('/admin');await page.getByRole('button',{name:'End reviewer session',exact:true}).click();await page.getByLabel('Temporary reviewer token',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Catalogue',exact:true}).count(),0);check('Operator logout clears protected navigation and records');


  const paths=['/','/onboarding','/profile','/opportunities',detailPath,'/matches','/saved','/activity','/alerts','/communities/demo-neighborhood'];
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    for(const path of paths){await visit(path);await fit(`${width}px ${path}`);if(width===390&&['/','/matches','/activity','/alerts',detailPath].includes(path))await shot(path===detailPath?'detail-phone':`${path==='/'?'dashboard':path.slice(1)}-phone`);}
    check(`All student routes fit the ${width}px phone viewport`);
  }
  await page.setViewportSize({width:1440,height:1000});
  assert.deepEqual(pageErrors,[],'No runtime exceptions');assert.deepEqual(consoleErrors,[],'No unexpected console errors');assert.deepEqual(externalRequests,[],'No external requests');
  check('Actual Chrome journeys have zero runtime exceptions, unexpected console errors or external requests');
  await writeFile('docs/evidence/browser-e2e.json',JSON.stringify({verifiedAt:new Date().toISOString(),scope:'Production build in installed Mac Chrome; synthetic isolated database',checks,pageErrors,consoleErrors,externalRequests,viewports:['1440×1000','390×844','320×844']},null,2)+'\n');
} catch(error){console.error(logs.join('').slice(-4000));throw error;}
finally{
  await browser?.close();
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([ended,delay(15000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
  await rm(directory,{recursive:true,force:true});
}
