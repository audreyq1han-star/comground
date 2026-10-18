import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness } from './browser-harness.mjs';

const base=process.env.PUBLIC_PREVIEW_URL;
const output=process.env.PUBLIC_PREVIEW_OUTPUT;
const localInterim=process.env.PUBLIC_PREVIEW_EVIDENCE_KIND==='local-interim';
if(!output)throw new Error('PUBLIC_PREVIEW_OUTPUT is required for the delivery recording.');
const h=await createHarness({base,output,final:!localInterim,video:true,viewport:{width:1280,height:800}});
const page=h.page,chapters=[];
const started=Date.now();
const mark=label=>chapters.push({label,seconds:Number(((Date.now()-started)/1000).toFixed(2)),url:page.url()});
const hold=ms=>page.waitForTimeout(ms);
const title=name=>page.getByRole('heading',{level:1,name,exact:true}).waitFor();
let video;
try{
 await h.goto('/');mark('Home: a fictional volunteering preview');await hold(4500);
 await page.getByRole('link',{name:'Explore examples',exact:true}).first().click();await title('What catches your interest?');mark('Browse three fictional examples');await hold(2500);
 await page.getByRole('button',{name:'Community',exact:true}).click();await hold(3000);
 await page.getByRole('link',{name:'See example: Food pantry packing',exact:true}).click();await title('Food pantry packing');mark('Read pantry tasks and requirements');await hold(3500);
 const sample=page.getByRole('combobox',{name:'Try a sample age range'});await sample.scrollIntoViewIfNeeded();await sample.selectOption({label:'Ages 13–15'});mark('The full 13–15 sample does not meet a 14+ requirement');await hold(4500);
 await page.getByRole('button',{name:'Try the narrower 14–15 example',exact:true}).click();mark('A narrower sample fits age; the guardian requirement stays separate');await hold(4500);
 const add=page.getByRole('button',{name:'Add to example shortlist',exact:true});await add.scrollIntoViewIfNeeded();await hold(2500);await add.click();await page.getByRole('button',{name:'Added to example shortlist',exact:true}).waitFor();mark('Add to a temporary example shortlist');await hold(2000);
 await page.getByRole('link',{name:'View example shortlist',exact:true}).click();await title('Your example shortlist');await hold(5000);
 await page.getByRole('link',{name:'Review the checklist',exact:true}).click();await page.locator('#checklist').waitFor();await page.waitForURL(/\/how-it-works\/#checklist$/);mark('Use practical questions before making a real plan');await hold(6500);
 const family=page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'For families',exact:true});await family.scrollIntoViewIfNeeded();await family.click();await title('A useful conversation starts with the details.');mark('Bring family and school questions into the conversation');await hold(3000);
 await page.getByRole('heading',{name:'For families',exact:true}).scrollIntoViewIfNeeded();await hold(5000);
 h.evidence.video={viewport:{width:1280,height:800},chapters,durationSeconds:Number(((Date.now()-started)/1000).toFixed(2)),kind:localInterim?'LOCAL PREVIEW — interim, not deployed':'final deployed preview',description:localInterim?'Actual navigation in the reviewed loopback build. This is interim local evidence, not an online delivery. No narration, simulated interface, or real personal information.':'Actual navigation in the confirmed deployed preview. No narration, simulated interface, or real personal information.'};
 const privacy=await h.privacyState();h.check('Recorded journey has no cookies or persistent state',Object.values(privacy).every(n=>n===0||n===null),privacy);
 h.check('Recorded journey has only same-origin GET/HEAD requests',h.evidence.externalRequests.length===0&&h.evidence.requests.every(n=>['GET','HEAD'].includes(n.method)),{external:h.evidence.externalRequests});
 h.check('Recorded journey has no console or page errors',h.evidence.console.length===0&&h.evidence.pageErrors.length===0,{console:h.evidence.console,errors:h.evidence.pageErrors});
 video=page.video();
}finally{await h.finish();}
const rawVideo=await video.path();
await writeFile(resolve(output,'walkthrough-source.json'),JSON.stringify({base,browser:h.evidence.browser,rawVideo,...h.evidence.video},null,2));
console.log(JSON.stringify({output,rawVideo,durationSeconds:h.evidence.video.durationSeconds},null,2));
