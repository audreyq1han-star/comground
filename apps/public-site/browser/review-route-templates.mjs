import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHarness, inspectTextContrast } from './browser-harness.mjs';
import { publicRoutes, excludedRoutes } from './route-inventory.mjs';

const base=process.env.PUBLIC_PREVIEW_URL||process.argv[2];
const final=process.env.PUBLIC_PREVIEW_EVIDENCE_KIND==='final';
const output=process.env.PUBLIC_PREVIEW_OUTPUT||resolve(new URL('../output/browser/',import.meta.url).pathname,`${final?'final':'source-attempt'}-routes-${new Date().toISOString().replace(/[:.]/g,'-')}`);
const h=await createHarness({base,output,final});
const sizes=[{width:1440,height:900},{width:768,height:1024},{width:390,height:844},{width:320,height:640}];
const routeInspections=[];
try{
  for(const route of publicRoutes){
    const response=await h.goto(route);
    h.check(`Direct load ${route} returns 200`,response.status()===200,{status:response.status()});
    const key=route==='/'?'home':route.replace(/^\/|\/$/g,'').replaceAll('/','-');
    await writeFile(resolve(output,`${key}-accessibility.yml`),await h.page.locator('body').ariaSnapshot());
    for(const size of sizes){
      await h.page.setViewportSize(size);
      const state=await h.inspect();
      routeInspections.push({route,size,state});
      h.check(`${route} ${size.width}px has no horizontal overflow`,!state.overflow,{scrollWidth:state.scrollWidth,viewport:state.viewport});
      h.check(`${route} ${size.width}px has one H1 and main`,state.h1.length===1&&state.mainCount===1,state.h1);
      h.check(`${route} ${size.width}px has no forms or personal inputs`,state.forms===0&&state.inputs.every(n=>['radio','checkbox'].includes(n.type)),state.inputs);
      h.check(`${route} ${size.width}px has no broken anchors`,state.brokenAnchors.length===0,state.brokenAnchors);
      if(size.width===1440||size.width===390||route==='/')await h.screenshot(`${key}-${size.width}`);
      if(route==='/')await h.screenshot(`${key}-viewport-${size.width}`,{fullPage:false});
    }
    await h.page.setViewportSize(sizes[0]);
    const contrast=await inspectTextContrast(h.page);
    await writeFile(resolve(output,`${key}-contrast.json`),JSON.stringify(contrast,null,2));
    h.check(`${route} sampled solid text contrast`,contrast.failures.length===0,contrast.failures);
  }
  await writeFile(resolve(output,'route-inspections.json'),JSON.stringify(routeInspections,null,2));
  h.check('Normal route loads generate no external requests',h.evidence.externalRequests.length===0,h.evidence.externalRequests);
  h.check('Normal route loads generate only safe GET/HEAD requests',h.evidence.requests.every(n=>['GET','HEAD'].includes(n.method)),h.evidence.requests.filter(n=>!['GET','HEAD'].includes(n.method)));
  h.check('Normal route loads have no console or page errors',h.evidence.console.length===0&&h.evidence.pageErrors.length===0,{console:h.evidence.console,pageErrors:h.evidence.pageErrors});
  const privacy=await h.privacyState();
  h.check('Clean route-load session has no persistent state',Object.values(privacy).every(n=>n===0||n===null),privacy);
  h.evidence.boundaryProbes=[];
  for(const route of excludedRoutes){
    const response=await h.context.request.get(new URL(route,base).href);
    h.evidence.boundaryProbes.push({route,status:response.status()});
    h.check(`Excluded route ${route} returns 404`,response.status()===404,{status:response.status()});
  }
  console.log(JSON.stringify({output,failed:h.evidence.checks.filter(n=>!n.passed)},null,2));
}finally{await h.finish();}
if(h.evidence.checks.some(n=>!n.passed))process.exitCode=1;
