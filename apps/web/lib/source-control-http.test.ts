import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { accounts } from './account-runtime.ts';
import { getSourceControl, postSourceControl } from './source-control-handlers.ts';
import { SOURCE_RECORD_FIELDS } from '../../../packages/domain/source-control-contracts.ts';

const keys=['COMGROUND_MODE','COMGROUND_ORIGIN','COMGROUND_DB_PATH','COMGROUND_OUTBOX_KEY','COMGROUND_EMAIL_ENABLED','COMGROUND_AI_ENABLED','COMGROUND_TEST_FIXTURES','COMGROUND_SKIP_DEMO_SEED','COMGROUND_ADULT_POLICY_ACK'];
function clearRuntime(){const state=globalThis as typeof globalThis&{comgroundSourceControl?:{repository:{close:()=>void}};comgroundAccountRepository?:{repository:{close:()=>void}};comgroundRepository?:{close:()=>void};comgroundFixtureEpoch?:Date};state.comgroundSourceControl?.repository.close();delete state.comgroundSourceControl;state.comgroundAccountRepository?.repository.close();delete state.comgroundAccountRepository;state.comgroundRepository?.close();delete state.comgroundRepository;delete state.comgroundFixtureEpoch;}
test('source routes enforce operator/origin/fixture boundaries, current permissions and auth after body',async()=>{
  const previous=new Map(keys.map(key=>[key,process.env[key]]));
  for(const config of [{mode:'test',fixtures:'1'},{mode:'test',fixtures:'0'},{mode:'production',fixtures:'0'}]){
    const folder=mkdtempSync(join(tmpdir(),'source-http-')),filename=join(folder,'db.sqlite');
    const origin=config.mode==='production'?'https://source-test.example.invalid':'http://localhost:3119';
    Object.assign(process.env,{COMGROUND_MODE:config.mode,COMGROUND_ORIGIN:origin,COMGROUND_DB_PATH:filename,COMGROUND_OUTBOX_KEY:randomBytes(32).toString('base64'),COMGROUND_EMAIL_ENABLED:'0',COMGROUND_AI_ENABLED:'0',COMGROUND_TEST_FIXTURES:config.fixtures,COMGROUND_SKIP_DEMO_SEED:config.fixtures==='1'?'0':'1',COMGROUND_ADULT_POLICY_ACK:'adult-account-v1'});
    let db:DatabaseSync|undefined;
    try{
      const identity=accounts();db=new DatabaseSync(filename);const at=new Date().toISOString();
      const make=(role:string,verified=true)=>{const id=`account-${randomUUID()}`,token=randomBytes(32).toString('base64url');db!.prepare('INSERT INTO accounts(id,email_norm,password_hash,role,email_verified_at,adult_attested_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,`${randomUUID()}@example.invalid`,'synthetic-not-password',role,verified?at:null,at,at,at);db!.prepare('INSERT INTO account_sessions(id,token_hash,account_id,created_at,last_seen_at,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),createHash('sha256').update(token).digest('hex'),id,at,at,new Date(Date.now()+3600000).toISOString(),at);return{id,token};};
      const operator=make('OPERATOR'),student=make('STUDENT'),unverified=make('OPERATOR',false),cookieName=config.mode==='production'?'__Host-comground_account':'comground_account';
      const request=(method='GET',body?:unknown,token?:string,requestOrigin=origin)=>new Request(`${origin}/api/admin/source-control`,{method,headers:{host:new URL(origin).host,origin:requestOrigin,'content-type':'application/json',...(token?{cookie:`${cookieName}=${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      assert.equal((await getSourceControl(request())).status,401);
      assert.equal((await getSourceControl(request('GET',undefined,student.token))).status,403);
      assert.equal((await getSourceControl(request('GET',undefined,unverified.token))).status,403);
      const initial=await getSourceControl(request('GET',undefined,operator.token));assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'no-store');
      const overview=(await initial.json()).data;
      assert.equal((await postSourceControl(request('POST',{action:'SCHEDULE'},operator.token,'https://other.invalid'))).status,403);
      if(config.fixtures!=='1'){
        const denied=await postSourceControl(request('POST',{action:'SCHEDULE'},operator.token));assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'SOURCE_SIMULATION_DISABLED');
        assert.equal(overview.runs.length,0);assert.equal(overview.permissions.length,0);continue;
      }
      const source=overview.sources[0];assert.ok(source);
      const permission={expectedVersion:0,state:'ACTIVE',method:'JSON',origin:new URL(source.url).origin,pathPrefix:'/',fields:SOURCE_RECORD_FIELDS,attribution:'Synthetic source attribution',evidence:'Synthetic permission evidence',ownerId:operator.id,removalRoute:'Local synthetic removal queue',cadenceMinutes:60,expiresAt:new Date(Date.now()+86400000).toISOString(),synthetic:true,reason:'Synthetic source route test'};
      const save={action:'SAVE_PERMISSION',sourceId:source.id,input:permission};
      assert.equal((await postSourceControl(request('POST',save,student.token))).status,403);
      assert.equal((await postSourceControl(request('POST',{...save,ownerId:student.id},operator.token))).status,422);
      assert.equal((await postSourceControl(request('POST',save,operator.token))).status,200);
      const queued=await postSourceControl(request('POST',{action:'QUEUE',sourceId:source.id,id:'test-http-run'},operator.token));assert.equal(queued.status,201);const run=(await queued.json()).data;
      assert.equal((await postSourceControl(request('POST',{action:'RUN_SYNTHETIC',id:run.id,expectedVersion:run.version},operator.token))).status,200);
      const staged=(await (await getSourceControl(request('GET',undefined,operator.token))).json()).data.stages.find((item:{sourceId:string;state:string})=>item.sourceId===source.id&&item.state==='STAGED');assert.ok(staged);
      assert.equal((await postSourceControl(request('POST',{...save,input:{...permission,expectedVersion:1,fields:['title']}},operator.token))).status,200);
      const refused=await postSourceControl(request('POST',{action:'IMPORT_STAGED',id:staged.id},operator.token));assert.equal(refused.status,403);
      const heldActor=make('OPERATOR');let controller!:ReadableStreamDefaultController<Uint8Array>,reading!:()=>void;
      const started=new Promise<void>(resolve=>{reading=resolve;});const body=new ReadableStream<Uint8Array>({start(value){controller=value;},pull(){reading();}},{highWaterMark:0});
      const held=new Request(`${origin}/api/admin/source-control`,{method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json',cookie:`${cookieName}=${heldActor.token}`},body,duplex:'half'} as RequestInit);
      const before=Number((db.prepare('SELECT count(*) AS n FROM source_ingestion_runs').get() as {n:number}).n),pending=postSourceControl(held);await started;identity.logout(heldActor.token);controller.enqueue(new TextEncoder().encode(JSON.stringify({action:'SCHEDULE'})));controller.close();assert.equal((await pending).status,401);assert.equal((db.prepare('SELECT count(*) AS n FROM source_ingestion_runs').get() as {n:number}).n,before);
    }finally{db?.close();clearRuntime();rmSync(folder,{recursive:true,force:true});for(const[key,value]of previous){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  }
});
