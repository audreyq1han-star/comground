import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const folder=await mkdtemp(join(tmpdir(),'comground-accessibility-')),base='http://127.0.0.1:3105',token=randomBytes(24).toString('base64url');
const checks=[],results=[];let child,browser;
try{
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','apps/web','--hostname','127.0.0.1','--port','3105','--keepAliveTimeout','1000'],{env:{...process.env, COMGROUND_MODE: 'demo',LOCAL_REVIEW_TOKEN:token,COMGROUND_DB_PATH:join(folder,'audit.sqlite'),NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/api/opportunities')).ok){ready=true;break;}}catch{}await delay(200);}assert(ready);
 browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());const page=await context.newPage();await page.goto(base);
 await page.evaluate(async token=>{
  const send=(path,body)=>fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  await send('/api/admin/session',{token});await send('/api/student/session',{personaId:'demo-alex'});
  await fetch('/api/student/profile',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedVersion:0,storageConsent:true,goal:'EXPLORE',preferences:{ageMin:16,ageMax:17,availableFrom:new Date().toISOString(),availableUntil:new Date(Date.now()+30*86400000).toISOString(),mode:'ANY',area:'Example neighborhood',interests:['outdoors'],maxFee:0,hasTraining:false,hasGuardian:false,requiresSchoolCredit:false}})});
 },token);
 const paths=['/','/profile','/opportunities','/matches','/saved','/activity','/alerts','/admin','/admin/sources','/admin/opportunities','/admin/reports','/admin/measurement','/admin/acquisition','/settings/alerts','/digest','/evidence','/safety','/admin/distribution','/admin/community-pages','/admin/evidence','/admin/safety','/admin/source-control','/admin/readiness'];
 for(const path of paths){
  await page.goto(base+path);await page.waitForLoadState('networkidle');
  const audit=await page.evaluate(()=>{
   const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
   const fields=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(visible);
   const unlabeled=fields.filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')&&!el.getAttribute('aria-labelledby')).map(el=>el.outerHTML.slice(0,120));
   const rgb=s=>{const n=s.match(/[\d.]+/g)?.map(Number)||[];return n.length>=3?[n[0],n[1],n[2],n[3]??1]:[0,0,0,0];};
   const luminance=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
   const contrasts=[];
   for(const el of document.querySelectorAll('p,span,small,a,label,button,h1,h2,h3,dt,dd,li,summary')){
    if(!visible(el)||el.matches(':disabled')||!el.textContent.trim()||![...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()))continue;
    let opacity=1,node=el,bg=[255,255,255,1],layers=[],skip=false;
    while(node){const s=getComputedStyle(node);opacity*=Number(s.opacity);if(s.backgroundImage!=='none')skip=true;layers.unshift(rgb(s.backgroundColor));node=node.parentElement;}
    if(opacity<.99||skip||el.classList.contains('visually-hidden')||el.classList.contains('skip-link'))continue;
    for(const c of layers)bg=c.map((x,i)=>i<3?x*c[3]+bg[i]*(1-c[3]):1);
    const style=getComputedStyle(el),fg=rgb(style.color);if(fg[3]<1)continue;
    const l1=luminance(fg),l2=luminance(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05),size=parseFloat(style.fontSize),weight=parseInt(style.fontWeight)||400;
    const minimum=size>=24||(size>=18.66&&weight>=700)?3:4.5;
    if(ratio+.02<minimum)contrasts.push({text:el.textContent.trim().slice(0,75),className:el.className,ratio:Number(ratio.toFixed(2)),minimum,foreground:style.color,background:bg.slice(0,3)});
   }
   return {mainCount:document.querySelectorAll('main').length,h1Count:[...document.querySelectorAll('h1')].filter(visible).length,fields:fields.length,unlabeled,contrastIssues:contrasts};
  });
  results.push({path,...audit});assert.equal(audit.mainCount,1,path);assert.equal(audit.h1Count,1,path);assert.deepEqual(audit.unlabeled,[],path);
 }
 checks.push('Sampled student and operator routes have one main landmark, one visible h1 and labeled form controls');
 const contrastIssues=results.flatMap(r=>r.contrastIssues.map(i=>({path:r.path,...i})));assert.deepEqual(contrastIssues,[],'Sampled visible text meets computed WCAG AA contrast thresholds');checks.push('Computed sampled visible text contrast meets 4.5:1 normal /3:1 large thresholds');
 for(const width of [768,1024]){await page.setViewportSize({width,height:1000});for(const path of paths){await page.goto(base+path);await page.waitForLoadState('networkidle');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width} ${path}`);}checks.push(`${width}px tablet/laptop routes fit without page overflow`);}
 await page.setViewportSize({width:1440,height:1000});const listed=await(await context.request.get(base+'/api/opportunities?limit=50')).json();const garden=listed.data.find(o=>o.title.includes('Community garden'));
 await page.goto(base+'/opportunities/'+garden.id);await page.getByRole('button',{name:/Preview demo signup/}).click();await page.getByRole('dialog').waitFor();
 for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));}
 for(let i=0;i<6;i++){await page.keyboard.press('Shift+Tab');assert(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));}
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Preview demo signup'));assert(await page.getByRole('button',{name:/Preview demo signup/}).evaluate(el=>el===document.activeElement));checks.push('Ten Tab and six Shift+Tab moves stay inside the modal; Escape restores opener focus');
 assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));checks.push('Reduced-motion preference is active during all audited journeys');
 await writeFile('docs/evidence/accessibility-e2e.json',JSON.stringify({verifiedAt:new Date().toISOString(),checks,results,limits:'Focused automated and visual accessibility checks; not a complete assistive-technology or formal WCAG conformance audit.'},null,2)+'\n');
 console.log(checks.map(c=>'PASS '+c).join('\n'));
}catch(e){await writeFile('docs/evidence/accessibility-incomplete.json',JSON.stringify(results,null,2)+'\n');throw e;}
finally{await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([ended,delay(15000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}await rm(folder,{recursive:true,force:true});}
