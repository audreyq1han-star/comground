import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'playwright';
export const browserPath = process.env.PLAYWRIGHT_BROWSER_PATH;

export async function createHarness({base, output, final = false, video = false, viewport = {width:1440,height:900}}) {
  if (!base) throw new Error('An explicit confirmed review URL is required.');
  if (final && !process.env.FINAL_CANDIDATE_CONFIRMED) throw new Error('Root confirmation of the deployed candidate is required for final evidence.');
  const origin = new URL(base).origin;
  if (final && ['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Final evidence must use the deployed URL.');
  const { chromium } = await import(playwrightModule);
  await mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(browserPath?{executablePath:browserPath}:{channel:'chrome'})});
  const context = await browser.newContext({viewport, reducedMotion:'reduce', ...(video?{recordVideo:{dir:resolve(output,'raw-video'),size:viewport}}:{})});
  const evidence = {startedAt:new Date().toISOString(),base,origin,kind:final?'final-deployed-evidence':'source-attempt',browser:browser.version(),checks:[],requests:[],externalRequests:[],pageErrors:[],console:[],failedRequests:[],responseErrors:[],screenshots:[]};
  context.on('request', request => {
    const item = {method:request.method(),url:request.url(),type:request.resourceType()};
    evidence.requests.push(item);
    if (new URL(item.url).origin !== origin) evidence.externalRequests.push(item);
  });
  context.on('requestfailed', request => evidence.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  context.on('response', response => {if(response.status()>=400)evidence.responseErrors.push({status:response.status(),url:response.url()});});
  context.on('page', page => {
    page.on('pageerror', error => evidence.pageErrors.push(error.message));
    page.on('console', message => {if(['error','warning'].includes(message.type()))evidence.console.push({type:message.type(),text:message.text(),url:page.url()});});
  });
  const page = await context.newPage();
  const check = (name,passed,details=null) => {const item={name,passed:Boolean(passed),...(details===null?{}:{details:structuredClone(details)})};evidence.checks.push(item);console.log(`${passed?'PASS':'FAIL'} ${name}`);return Boolean(passed);};
  const attempt = async(name,fn)=>{try{const value=await fn();return check(name,value!==false,value===undefined?null:value);}catch(error){return check(name,false,error.message);}};
  const goto = async(path)=>{const response=await page.goto(new URL(path,base).href,{waitUntil:'networkidle'});await page.locator('main').waitFor();return response;};
  const screenshot = async(name,{fullPage=true}={})=>{const filename=`${name}.png`;await page.screenshot({path:resolve(output,filename),fullPage,animations:'disabled'});evidence.screenshots.push({name:filename,url:page.url(),viewport:page.viewportSize(),fullPage});};
  const inspect = async()=>page.evaluate(()=>{
    const visible = node => {const r=node.getBoundingClientRect();const s=getComputedStyle(node);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
    const controls=[...document.querySelectorAll('a,button,select,input,textarea,summary')].filter(visible).map(node=>({tag:node.tagName,text:(node.getAttribute('aria-label')||node.textContent||'').trim().replace(/\s+/g,' ').slice(0,160),id:node.id,role:node.getAttribute('role'),rect:{width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height},outline:getComputedStyle(node).outline}));
    return {title:document.title,h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),mainCount:document.querySelectorAll('main').length,forms:document.querySelectorAll('form').length,inputs:[...document.querySelectorAll('input')].map(n=>({type:n.type,name:n.name})),viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,headings:[...document.querySelectorAll('h1,h2,h3,h4')].map(n=>({level:n.tagName,text:n.textContent})),controls,brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].map(a=>a.getAttribute('href')).filter(href=>href.length>1&&!document.getElementById(href.slice(1))),storageCounts:{local:localStorage.length,session:sessionStorage.length},animations:[...document.querySelectorAll('body *')].filter(visible).map(n=>getComputedStyle(n)).filter(s=>s.animationName!=='none'&&s.animationDuration!=='0s').map(s=>({name:s.animationName,duration:s.animationDuration}))};
  });
  const privacyState = async()=>({cookieCount:(await context.cookies()).length,...await page.evaluate(async()=>({localStorageCount:localStorage.length,sessionStorageCount:sessionStorage.length,indexedDatabaseCount:typeof indexedDB.databases==='function'?(await indexedDB.databases()).length:null,cacheCount:'caches'in globalThis?(await caches.keys()).length:null,serviceWorkerCount:'serviceWorker'in navigator?(await navigator.serviceWorker.getRegistrations()).length:null}))});
  const finish=async()=>{evidence.finishedAt=new Date().toISOString();evidence.cookieCount=(await context.cookies()).length;await writeFile(resolve(output,'verification.json'),JSON.stringify(evidence,null,2));await context.close();await browser.close();return evidence;};
  return {browser,context,page,evidence,check,attempt,goto,screenshot,inspect,privacyState,finish};
}

export async function inspectTextContrast(page) {
  return page.evaluate(()=>{
    const rgba=s=>{const m=s.match(/[\d.]+/g);return m?m.map(Number):[0,0,0,0];};
    const over=(a,b)=>{const alpha=(a[3]??1);return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha)).concat(1);};
    const luminance=a=>a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const results=[];
    for(const el of document.querySelectorAll('body *')){
      if(['SCRIPT','STYLE','SVG','PATH'].includes(el.tagName)||!el.childNodes.length)continue;
      const text=[...el.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(' ').trim();
      if(!text)continue;
      const rect=el.getBoundingClientRect(),s=getComputedStyle(el);
      if(!rect.width||!rect.height||s.visibility==='hidden'||s.display==='none')continue;
      let chain=[],ancestor=el,unsupported=false;
      while(ancestor){const cs=getComputedStyle(ancestor);if(cs.backgroundImage!=='none')unsupported=true;chain.push(rgba(cs.backgroundColor));ancestor=ancestor.parentElement;}
      let bg=[255,255,255,1];for(const c of chain.reverse())bg=over(c,bg);
      const color=over(rgba(s.color),bg),a=luminance(color),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size=parseFloat(s.fontSize),bold=Number(s.fontWeight)>=700,threshold=size>=24||(bold&&size>=18.6667)?3:4.5;
      results.push({text:text.slice(0,100),tag:el.tagName,color:s.color,background:bg.slice(0,3).map(Math.round),ratio:Number(ratio.toFixed(2)),threshold,unsupported,passes:ratio>=threshold});
    }
    return {method:'Computed solid text/background contrast sample; images, gradients, pseudo-elements and antialiasing require visual review.',results,failures:results.filter(r=>!r.unsupported&&!r.passes)};
  });
}
