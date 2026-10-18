import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';

const base=process.env.PUBLIC_PREVIEW_URL||process.argv[2];
const final=process.env.PUBLIC_PREVIEW_EVIDENCE_KIND==='final';
const output=process.env.PUBLIC_PREVIEW_OUTPUT||resolve(new URL('../output/browser/',import.meta.url).pathname,`${final?'final':'source-attempt'}-journey-${new Date().toISOString().replace(/[:.]/g,'-')}`);
const h=await createHarness({base,output,final});
const {page,check,attempt}=h;
const heading=name=>page.getByRole('heading',{level:1,name,exact:true}).waitFor();
const mainNav=()=>page.getByRole('navigation',{name:'Main navigation'});
const status=()=>page.getByRole('status');
const sample=()=>page.getByRole('combobox',{name:'Try a sample age range',includeHidden:true});
async function selectSample(label){const control=sample();if(!await control.isVisible())await page.locator('summary').filter({hasText:'Try a sample age range'}).click();await control.selectOption({label});}
const article=title=>page.getByRole('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
const titles=['Community garden morning','Food pantry packing','Remote reading preparation'];
async function clickNav(name,title){await mainNav().getByRole('link',{name,exact:true}).click();await heading(title);}
async function addAndReturn(title){await page.getByRole('link',{name:`See example: ${title}`,exact:true}).click();await heading(title);await page.getByRole('button',{name:'Add to example shortlist',exact:true}).click();await page.getByRole('button',{name:'Added to example shortlist',exact:true}).waitFor();await page.getByRole('link',{name:'Back to examples',exact:true}).click();await heading('What catches your interest?');}
async function focusEvidence(){return page.evaluate(()=>{const el=document.activeElement,s=getComputedStyle(el),r=el.getBoundingClientRect();return{tag:el.tagName,text:el.textContent?.trim(),outlineStyle:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor,inViewport:r.top>=0&&r.bottom<=innerHeight};});}
try{
 await h.goto('/');
 await attempt('Skip link is first keyboard stop and visibly focused',async()=>{await page.keyboard.press('Tab');const focus=await focusEvidence();assert.match(focus.text,/Skip to content/);assert.notEqual(focus.outlineStyle,'none');assert.ok(parseFloat(focus.outlineWidth)>=2);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');return focus;});
 await page.getByRole('link',{name:'Explore examples',exact:true}).first().click();await heading('What catches your interest?');
 await attempt('Home Explore link opens the examples route',async()=>{assert.match(page.url(),/\/explore\/$/);assert.equal(await page.getByRole('article').count(),3);});
 await attempt('Category and format filters show real empty state; reset keeps age and useful focus',async()=>{
  await selectSample('Ages 13–15');
  await page.getByRole('button',{name:'Community',exact:true}).click();
  assert.equal(await page.getByRole('article').count(),1);
  await page.getByRole('button',{name:'Remote',exact:true}).click();
  await page.getByRole('heading',{name:'No examples with those choices.',exact:true}).waitFor();
  assert.match(await status().innerText(),/Showing 0 fictional examples/);
  assert.equal(await page.getByRole('button',{name:'Community',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Remote',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Show all examples',exact:true}).click();
  assert.equal(await page.getByRole('article').count(),3);assert.equal(await sample().inputValue(),'13–15');
  assert.match(await page.evaluate(()=>document.activeElement.textContent.trim()),/^(All activities|Activities to explore)$/);
 });
 await attempt('13–15 fails age 14 minimum and keeps separate guardian requirement',async()=>{const text=await article(titles[1]).innerText();assert.match(text,/includes ages below the minimum/);assert.match(text,/guardian is also required/);});
 await attempt('Explicit 14–15 narrowing passes age while guardian requirement remains',async()=>{await page.getByRole('button',{name:'Try the narrower 14–15 example',exact:true}).click();const text=await article(titles[1]).innerText();assert.match(text,/14–15 sample/);assert.match(text,/age range fits\. A guardian is also required/);});
 await attempt('18+ sample is selectable and does not waive guardian requirement',async()=>{await selectSample('Age 18+ and in high school');const text=await article(titles[1]).innerText();assert.match(text,/18\+ sample/);assert.match(text,/guardian is also required/);});
 await selectSample('Ages 13–15');
 await page.getByRole('button',{name:'Community',exact:true}).click();
 await page.getByRole('link',{name:`See example: ${titles[1]}`,exact:true}).click();await heading(titles[1]);
 await attempt('Pantry detail carries selected sample with failed age and separate guardian fact',async()=>{assert.match(await status().innerText(),/includes ages below the minimum/);assert.match(await page.getByRole('complementary').innerText(),/Guardian required in this example/);assert.match(await status().innerText(),/full 13–15 sample range includes an age below that minimum/);});
 await attempt('Browser Back/Forward preserves filtered context and detail route',async()=>{await page.goBack();await heading('What catches your interest?');assert.equal(await page.getByRole('article').count(),1);assert.equal(await sample().inputValue(),'13–15');await page.goForward();await heading(titles[1]);assert.equal(await sample().inputValue(),'13–15');});
 await attempt('Shortlist add announces no application, prevents duplicates and exposes next route',async()=>{await page.getByRole('button',{name:'Add to example shortlist',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Added to example shortlist',exact:true}).waitFor();assert.match(await page.locator('main').innerText(),/No application has been sent/);assert.equal(await page.getByRole('button',{name:'Added to example shortlist',exact:true}).isDisabled(),true);await page.getByRole('link',{name:'View example shortlist',exact:true}).click();await heading('Your example shortlist');assert.equal(await page.getByRole('article').count(),1);assert.match(await article(titles[1]).innerText(),/includes ages below the minimum/);});
 await page.getByRole('link',{name:'Explore more examples',exact:true}).click();await heading('What catches your interest?');
 await page.getByRole('button',{name:'All activities',exact:true}).click();
 await addAndReturn(titles[0]);await addAndReturn(titles[2]);
 await page.getByRole('banner').getByRole('link',{name:'Example shortlist 3',exact:true}).click();await heading('Your example shortlist');
 await attempt('All three fictional details add to accurate memory-only comparison',async()=>{assert.equal(await page.getByRole('article').count(),3);assert.match(await page.getByRole('banner').innerText(),/3/);for(const title of titles)assert.equal(await article(title).count(),1);});
 if(process.env.PUBLIC_PREVIEW_CAPTURE!=='0')await h.screenshot('shortlist-populated-desktop');
 await page.setViewportSize({width:390,height:844});if(process.env.PUBLIC_PREVIEW_CAPTURE!=='0')await h.screenshot('shortlist-populated-phone');
 const mobile=await h.inspect();check('Populated shortlist has no overflow at 390px',!mobile.overflow);
 await page.setViewportSize({width:320,height:640});check('Populated shortlist has no overflow at 320px',!(await h.inspect()).overflow);if(process.env.PUBLIC_PREVIEW_CAPTURE!=='0')await h.screenshot('shortlist-populated-320');
 await page.setViewportSize({width:1440,height:900});
 await attempt('Removing items updates count, named status and useful focus; final removal clears list',async()=>{for(let i=0;i<titles.length;i++){await page.getByRole('button',{name:`Remove ${titles[i]} from example shortlist`,exact:true}).click();assert.equal(await page.getByRole('article').count(),2-i);assert.match(await status().innerText(),new RegExp(`${titles[i]} removed`));const focus=await focusEvidence();assert.notEqual(focus.tag,'BODY');}await page.getByRole('heading',{name:'Start with one possibility.',exact:true}).waitFor();});
 await page.getByRole('link',{name:'Explore examples',exact:true}).click();await heading('What catches your interest?');await addAndReturn(titles[1]);
 await page.getByRole('banner').getByRole('link',{name:'Example shortlist 1',exact:true}).click();await heading('Your example shortlist');
 await attempt('Shortlist leads to visible checklist anchor',async()=>{await page.getByRole('link',{name:'Review the checklist',exact:true}).click();await page.locator('#checklist').waitFor();await page.waitForURL(/\/how-it-works\/#checklist$/);assert.equal(await page.locator('#checklist').getByRole('heading').count()>0,true);const rect=await page.locator('#checklist').boundingBox();assert.ok(rect.y<900&&rect.y>-10);});
 await attempt('Native FAQ opens and closes by keyboard',async()=>{const summary=page.locator('summary').first();await summary.focus();await page.keyboard.press('Enter');assert.equal(await summary.locator('..').getAttribute('open'),'');await page.keyboard.press('Enter');assert.equal(await summary.locator('..').getAttribute('open'),null);});
 await clickNav('For families','A useful conversation starts with the details.');
 await attempt('Family page exposes school, guardian and real-enrollment boundaries',async()=>{const text=await page.locator('main').innerText();assert.match(text,/Real student enrollment is not available/);assert.match(text,/does not award or certify hours/);assert.match(text,/no organization or school is presented as a partner/);});
 await page.getByRole('banner').getByRole('link',{name:'Example shortlist 1',exact:true}).click();await heading('Your example shortlist');
 await attempt('Reload clears shortlist and selected sample as disclosed',async()=>{await page.reload({waitUntil:'networkidle'});await page.getByRole('heading',{name:'Start with one possibility.',exact:true}).waitFor();assert.equal(await page.getByRole('article').count(),0);await clickNav('Explore','What catches your interest?');assert.equal(await sample().inputValue(),'16–17');});
 await attempt('Keyboard filter has visible focus and retains focus when result updates',async()=>{const target=page.getByRole('button',{name:'Environment',exact:true});await target.focus();await page.keyboard.press('Space');const focus=await focusEvidence();assert.equal(focus.text,'Environment');assert.notEqual(focus.outlineStyle,'none');assert.ok(parseFloat(focus.outlineWidth)>=2);assert.equal(await page.getByRole('article').count(),1);return focus;});
 await attempt('Reduced motion removes active animations and smooth scrolling',async()=>{const data=await page.evaluate(()=>({animations:document.getAnimations().filter(a=>a.playState==='running').length,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior}));assert.equal(data.animations,0);assert.notEqual(data.scrollBehavior,'smooth');return data;});
 await page.setViewportSize({width:720,height:450});check('200% desktop reflow equivalent at 720 CSS px has no horizontal overflow',!(await h.inspect()).overflow,{method:'Equivalent CSS viewport; not a browser zoom-control measurement.'});
 const privacy=await h.privacyState();check('Journey leaves no cookies or persistent browser state',Object.values(privacy).every(n=>n===0||n===null),privacy);
 check('Journey sends no mutations or external requests',h.evidence.requests.every(n=>['GET','HEAD'].includes(n.method))&&h.evidence.externalRequests.length===0,{external:h.evidence.externalRequests,mutations:h.evidence.requests.filter(n=>!['GET','HEAD'].includes(n.method))});
 check('Journey has no console warnings/errors or uncaught page errors',h.evidence.console.length===0&&h.evidence.pageErrors.length===0,{console:h.evidence.console,pageErrors:h.evidence.pageErrors});
 await page.setViewportSize({width:390,height:844});
 const consoleBefore404=h.evidence.console.length,responseErrorsBefore404=h.evidence.responseErrors.length;
 await attempt('Unknown example returns useful real HTTP 404 with recovery link',async()=>{const response=await h.goto('/explore/no-such-example/');assert.equal(response.status(),404);assert.match(await page.locator('main').innerText(),/couldn.t find that example/i);await page.getByRole('link',{name:'Explore examples',exact:true}).click();await heading('What catches your interest?');});
 h.evidence.deliberate404Diagnostics={explanation:'The browser reports the deliberately requested HTTP 404 resource in its console. Normal-journey console checks occur before this negative-route probe.',console:h.evidence.console.slice(consoleBefore404),responses:h.evidence.responseErrors.slice(responseErrorsBefore404)};
 await writeFile(resolve(output,'final-accessibility.yml'),await page.locator('body').ariaSnapshot());
 console.log(JSON.stringify({output,failed:h.evidence.checks.filter(n=>!n.passed)},null,2));
}finally{await h.finish();}
if(h.evidence.checks.some(n=>!n.passed))process.exitCode=1;
