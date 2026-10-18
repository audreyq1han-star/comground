import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';
const base=process.env.PUBLIC_PREVIEW_URL||process.argv[2];
const final=process.env.PUBLIC_PREVIEW_EVIDENCE_KIND==='final';
const output=process.env.PUBLIC_PREVIEW_OUTPUT||resolve(new URL('../output/browser/',import.meta.url).pathname,`${final?'final':'source-attempt'}-phone-${new Date().toISOString().replace(/[:.]/g,'-')}`);
const h=await createHarness({base,output,final,viewport:{width:390,height:844}});
const p=h.page;
const heading=name=>p.getByRole('heading',{level:1,name,exact:true}).waitFor();
const nav=name=>p.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name,exact:true});
try{
 for(const size of [{width:390,height:844},{width:320,height:640}]){
  await p.setViewportSize(size);await h.goto('/');
  await h.attempt(`${size.width}px: Home CTA opens Explore`,async()=>{await p.getByRole('link',{name:'Explore examples',exact:true}).first().click();await heading('What catches your interest?');assert.equal(await p.getByRole('article').count(),3);});
  await h.attempt(`${size.width}px: optional sample disclosure and filters are operable`,async()=>{await p.locator('summary').filter({hasText:'Try a sample age range'}).click();await p.getByRole('combobox',{name:'Try a sample age range'}).selectOption({label:'Ages 13–15'});await p.getByRole('button',{name:'Community',exact:true}).click();assert.equal(await p.getByRole('article').count(),1);assert.match(await p.getByRole('article').innerText(),/includes ages below the minimum/);await p.getByRole('button',{name:'Remote',exact:true}).click();await p.getByRole('heading',{name:'No examples with those choices.',exact:true}).waitFor();await p.getByRole('button',{name:'Show all examples',exact:true}).click();assert.equal(await p.getByRole('article').count(),3);});
  await p.getByRole('link',{name:'See example: Food pantry packing',exact:true}).click();await heading('Food pantry packing');
  await h.attempt(`${size.width}px: detail shows age failure and explicit narrower age with guardian condition`,async()=>{assert.match(await p.getByRole('status').innerText(),/includes ages below the minimum/);await p.getByRole('button',{name:'Try the narrower 14–15 example',exact:true}).click();assert.match(await p.getByRole('status').innerText(),/age range fits\. A guardian is also required/);assert.equal((await h.inspect()).overflow,false);});
  await h.attempt(`${size.width}px: add and shortlist navigation preserve memory and fit the viewport`,async()=>{await p.getByRole('button',{name:'Add to example shortlist',exact:true}).click();await p.getByRole('link',{name:'View example shortlist',exact:true}).click();await heading('Your example shortlist');assert.equal(await p.getByRole('article').count(),1);assert.match(await p.getByRole('article').innerText(),/14–15 sample/);assert.equal((await h.inspect()).overflow,false);});
  if(process.env.PUBLIC_PREVIEW_CAPTURE!=='0')await h.screenshot(`phone-journey-shortlist-${size.width}`);
  await h.attempt(`${size.width}px: checklist and family guide remain reachable through real controls`,async()=>{await p.getByRole('link',{name:'Review the checklist',exact:true}).click();await p.locator('#checklist').waitFor();await p.waitForURL(/\/how-it-works\/#checklist$/);await nav('For families').click();await heading('A useful conversation starts with the details.');assert.match(await p.locator('main').innerText(),/Real student enrollment is not available/);await p.getByRole('navigation',{name:'On this page'}).getByRole('link',{name:'For schools',exact:true}).click();await p.waitForURL(/#schools$/);assert.equal((await h.inspect()).overflow,false);});
  await h.attempt(`${size.width}px: removal gives useful empty recovery`,async()=>{await p.getByRole('banner').getByRole('link',{name:'Example shortlist 1',exact:true}).click();await heading('Your example shortlist');await p.getByRole('button',{name:'Remove Food pantry packing from example shortlist',exact:true}).click();await p.getByRole('heading',{name:'Start with one possibility.',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.activeElement.tagName),'A');await p.getByRole('link',{name:'Explore examples',exact:true}).click();await heading('What catches your interest?');});
  await h.attempt(`${size.width}px: reload resets the sample and leaves no persistent state`,async()=>{await p.reload({waitUntil:'networkidle'});assert.equal(await p.getByRole('combobox',{name:'Try a sample age range',includeHidden:true}).inputValue(),'16–17');const privacy=await h.privacyState();assert.ok(Object.values(privacy).every(n=>n===0||n===null));return privacy;});
 }
 h.check('Phone journeys generate only same-origin GET/HEAD requests',h.evidence.externalRequests.length===0&&h.evidence.requests.every(n=>['GET','HEAD'].includes(n.method)),{external:h.evidence.externalRequests,mutations:h.evidence.requests.filter(n=>!['GET','HEAD'].includes(n.method))});
 h.check('Phone journeys have no console/page errors',h.evidence.console.length===0&&h.evidence.pageErrors.length===0,{console:h.evidence.console,pageErrors:h.evidence.pageErrors});
 console.log(JSON.stringify({output,checks:h.evidence.checks.length,failed:h.evidence.checks.filter(n=>!n.passed)},null,2));
}finally{await h.finish();}
if(h.evidence.checks.some(n=>!n.passed))process.exitCode=1;
