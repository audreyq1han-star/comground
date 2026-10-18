import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureList } from '../../../packages/domain/fixtures.ts';
import type { SourcePermission,SourceRun } from '../../../packages/domain/source-control-contracts.ts';
import { computeSourceOperationalMetrics } from './source-control-metrics.ts';
import { createSourceControlRepository, SOURCE_RECORD_FIELDS } from './source-control-repository.ts';
import { createRepository } from './repository.ts';
const now=new Date('2026-10-17T06:00:00Z'),HOUR=3600000,DAY=24*HOUR;
const at=(hours:number)=>new Date(now.getTime()+hours*HOUR).toISOString();
const permission=(version=1,start=-4,state:SourcePermission['state']='ACTIVE'):SourcePermission=>({sourceId:'source',version,state,method:'JSON',origin:'https://example.invalid',pathPrefix:'/',fields:['title'],attribution:'Synthetic',evidence:'Synthetic',ownerId:'operator',removalRoute:'Synthetic removal',cadenceMinutes:60,expiresAt:at(24),updatedAt:at(start),synthetic:true});
const event=(version=1,start=-4,state:SourcePermission['state']='ACTIVE')=>({sourceId:'source',version,at:at(start),permission:permission(version,start,state)});
const run=(id:string,start:number,end:number,state:SourceRun['state']='SUCCEEDED',key=`due:${id}`):SourceRun=>({id,sourceId:'source',key,version:2,state,cursor:null,attempts:1,nextAttemptAt:at(start),heartbeatAt:at(end),createdAt:at(start),updatedAt:at(end),errorCode:null,accepted:1,quarantined:0});
const input=()=>({sourceIds:['source'],permissions:[event()],runs:[] as SourceRun[],changes:[],reviewTimes:[]});
test('all due intervals include missed, late, failed and open obligations; manual runs cannot inflate success',()=>{
 const value=computeSourceOperationalMetrics({...input(),permissions:[event(),event(2,-1.5)],runs:[run('first',-4,-3.5),run('manual',-3,-2.8,'SUCCEEDED','manual'),run('late',-2,-1.8,'DEAD_LETTER'),run('replay',-.8,-.5,'SUCCEEDED','replay:late:2'),run('failed',-1,-.8,'DEAD_LETTER')]},now);
 assert.equal(value.sync.dueIntervals,5);assert.equal(value.sync.onTimeSuccesses,1);assert.equal(value.sync.missedIntervals,1);assert.equal(value.sync.lateSuccesses,1);assert.equal(value.sync.failedIntervals,1);assert.equal(value.sync.pendingIntervals,1);assert.equal(value.sync.onTimePercent,20);
 assert.equal(value.sync.partialHistorySources,1);assert.equal(value.sync.unobservedSourceHours,14*24-4);assert.equal(value.sync.knownAuthorizedHours,4);
});
test('pause, expiry and cadence versions bound authorized intervals; unknown history is never success',()=>{
 const active=event(3,-1);active.permission.expiresAt=at(-.5);
 const value=computeSourceOperationalMetrics({...input(),sourceIds:['source','unregistered'],permissions:[event(),event(2,-2.5,'PAUSED'),active]},now);
 assert.equal(value.sync.dueIntervals,3);assert.equal(value.sync.missedIntervals,3);assert.equal(value.sync.knownAuthorizedHours,2);assert.equal(value.sync.unknownHistorySources,1);assert.equal(value.sync.partialHistorySources,1);
 const gap=computeSourceOperationalMetrics({...input(),permissions:[event(),event(3,-1)]},now);
 assert.equal(gap.sync.dueIntervals,2);assert.equal(gap.sync.knownAuthorizedHours,1);assert.equal(gap.sync.unobservedSourceHours,14*24-1);
 const empty=computeSourceOperationalMetrics({...input(),permissions:[]},now);assert.equal(empty.sync.onTimePercent,null);assert.equal(empty.sync.unknownHistorySources,1);assert.equal(empty.sync.dueIntervals,0);
});
test('14-day window counts an expected obligation independently of retained run count',()=>{
 const long=event(1,-15*24);long.permission.expiresAt=at(24);
 const value=computeSourceOperationalMetrics({...input(),permissions:[long],runs:[run('old',-15*24,-15*24+.5)]},now);
 assert.equal(value.sync.dueIntervals,337);assert.equal(value.sync.missedIntervals,336);assert.equal(value.sync.pendingIntervals,1);assert.equal(value.sync.unobservedSourceHours,0);assert.equal(value.sync.partialHistorySources,0);assert.equal(value.sync.onTimePercent,0);
});
test('pause/resume and cadence resets cannot credit one root to two intervals; active renewals retain attribution',()=>{
 const resumed=computeSourceOperationalMetrics({...input(),permissions:[event(1,-2),event(2,-1.8,'PAUSED'),event(3,-1.5)],runs:[run('resumed',-1.5,-1.4)]},now);
 assert.equal(resumed.sync.dueIntervals,3);assert.equal(resumed.sync.onTimeSuccesses,1);assert.equal(resumed.sync.missedIntervals,1);assert.equal(resumed.sync.pendingIntervals,1);
 const renewal=computeSourceOperationalMetrics({...input(),permissions:[event(1,-2),event(2,-1.8)],runs:[run('renewed',-1.5,-1.4)]},now);
 assert.equal(renewal.sync.dueIntervals,3);assert.equal(renewal.sync.onTimeSuccesses,1);
 const boundary=event(1,-2);boundary.permission.expiresAt=at(-1.8);
 const exactRenewal=computeSourceOperationalMetrics({...input(),permissions:[boundary,event(2,-1.8)],runs:[run('exact-renewal',-1.5,-1.4)]},now);
 assert.equal(exactRenewal.sync.dueIntervals,3);assert.equal(exactRenewal.sync.onTimeSuccesses,1);assert.equal(exactRenewal.sync.missedIntervals,1);
 const faster=event(2,-1.5);faster.permission.cadenceMinutes=30;
 const cadence=computeSourceOperationalMetrics({...input(),permissions:[event(1,-2),faster],runs:[run('retimed',-1.5,-1.4)]},now);
 assert.equal(cadence.sync.dueIntervals,5);assert.equal(cadence.sync.onTimeSuccesses,1);assert.equal(cadence.sync.missedIntervals,3);assert.equal(cadence.sync.pendingIntervals,1);
});
test('7-day decision cohort and outstanding changes are separate; workload excludes old entries',()=>{
 const value=computeSourceOperationalMetrics({...input(),changes:[
  {opportunityId:'a',version:2,detectedAt:at(-10*24),decidedAt:at(-2*24)},
  {opportunityId:'b',version:2,detectedAt:at(-3*24),decidedAt:at(-24)},
  {opportunityId:'c',version:2,detectedAt:at(-8*24),decidedAt:null},
  {opportunityId:'d',version:2,detectedAt:at(-24),decidedAt:null},
  {opportunityId:'e',version:2,detectedAt:at(-10*24),decidedAt:at(-8*24)}
 ],reviewTimes:[{actorId:'a',minutes:30,at:at(-1)},{actorId:'b',minutes:60,at:at(-24)},{actorId:'a',minutes:90,at:at(-8*24)}],unknownLegacyChanges:2},now);
 assert.deepEqual(value.changes.completed,{samples:2,medianHours:120,p90Hours:192});assert.deepEqual(value.changes.outstanding,{samples:2,medianHours:108,p90Hours:192});assert.equal(value.changes.olderOutstanding,1);assert.equal(value.changes.detectedInWindow,2);assert.equal(value.changes.unknownLegacyChanges,2);assert.equal(value.workload.entries,2);assert.equal(value.workload.reviewers,2);assert.equal(value.workload.hours,1.5);
});
test('catalogue revisions start material clocks and first review decisions complete them without publishing drafts',()=>{
 const folder=mkdtempSync(join(tmpdir(),'source-metric-')),file=join(folder,'db.sqlite'),catalogue=createRepository(file),record=fixtureList(now)[0].record,db=new DatabaseSync(file);
 db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT,email_verified_at TEXT)');const store=createSourceControlRepository(file);
 try{
  const first=catalogue.importRecord(record,now).opportunity;
  catalogue.importRecord({...record,fetchedAt:at(1)},new Date(at(1)));
  let changed=catalogue.importRecord({...record,fetchedAt:at(1),title:'Material title change'},new Date(at(2))).opportunity;
  catalogue.review(first.id,{expectedVersion:changed.version,decision:'REJECT',reason:'Synthetic decision'},new Date(at(5)));
  changed=catalogue.importRecord({...record,title:'Another material change'},new Date(at(6))).opportunity;
  const metrics=store.overview(new Date(at(8))).metrics;
  assert.deepEqual(metrics.changes.completed,{samples:1,medianHours:3,p90Hours:3});assert.deepEqual(metrics.changes.outstanding,{samples:1,medianHours:2,p90Hours:2});assert.equal(metrics.changes.detectedInWindow,2);assert.equal(catalogue.getAdmin(changed.id)?.status,'DRAFT');assert.equal(catalogue.listPublic({},new Date(at(8))).total,0);
 }finally{store.close();db.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
});
test('staged detection starts the review clock before import and unimported changes remain outstanding',()=>{
 const folder=mkdtempSync(join(tmpdir(),'source-stage-metric-')),file=join(folder,'db.sqlite'),catalogue=createRepository(file),record=fixtureList(now)[0].record,db=new DatabaseSync(file),actor='operator';
 db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT,email_verified_at TEXT)');db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(actor,'OPERATOR',now.toISOString());catalogue.importRecord(record,now);const store=createSourceControlRepository(file);
 try{
  const {sourceId,version,updatedAt,...editable}=permission();
  store.savePermission(record.source.id,{...editable,expectedVersion:0,fields:SOURCE_RECORD_FIELDS,origin:new URL(record.source.url).origin,ownerId:actor,reason:'Synthetic'},actor,now);
  const changed={...record,title:'Staged changed title'},queued=store.queue(record.source.id,'detection',actor,new Date(at(1))),lease=store.claim(queued.id,new Date(at(1)));
  store.commitBatch(queued.id,lease.token,{expectedCursor:null,nextCursor:'done',records:[changed],complete:true},new Date(at(1)));
  assert.equal(store.overview(new Date(at(2))).metrics.changes.outstanding.medianHours,1);
  catalogue.importRecord({...record,fetchedAt:at(2)},new Date(at(2))); // Bookkeeping must not reset the earlier staged detection clock.
  const imported=catalogue.importRecord(changed,new Date(at(3))).opportunity,stage=store.overview(new Date(at(3))).stages[0];store.markImported(stage.id,imported.id,actor,new Date(at(3)));
  catalogue.review(imported.id,{expectedVersion:imported.version,decision:'REJECT',reason:'Synthetic review'},new Date(at(6)));
  const metrics=store.overview(new Date(at(8))).metrics;assert.deepEqual(metrics.changes.completed,{samples:1,medianHours:5,p90Hours:5});assert.equal(metrics.changes.outstanding.samples,0);
 }finally{store.close();db.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
});
test('repeated staged fetches of identical material content keep one earliest clock and do not reappear after import',()=>{
 const folder=mkdtempSync(join(tmpdir(),'source-dedup-metric-')),file=join(folder,'db.sqlite'),catalogue=createRepository(file),record=fixtureList(now)[0].record,db=new DatabaseSync(file),actor='operator';
 db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT,email_verified_at TEXT)');db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(actor,'OPERATOR',now.toISOString());catalogue.importRecord(record,now);const store=createSourceControlRepository(file);
 try{
  const {sourceId,version,updatedAt,...editable}=permission();store.savePermission(record.source.id,{...editable,expectedVersion:0,fields:SOURCE_RECORD_FIELDS,origin:new URL(record.source.url).origin,ownerId:actor,reason:'Synthetic'},actor,now);
  for(const hour of [1,2,3]){const queued=store.queue(record.source.id,`repeat-${hour}`,actor,new Date(at(hour))),lease=store.claim(queued.id,new Date(at(hour)));store.commitBatch(queued.id,lease.token,{expectedCursor:null,nextCursor:'done',records:[{...record,title:'Repeated material change',fetchedAt:at(hour)}],complete:true},new Date(at(hour)));}
  const waiting=store.overview(new Date(at(4))).metrics.changes;assert.equal(waiting.detectedInWindow,1);assert.deepEqual(waiting.outstanding,{samples:1,medianHours:3,p90Hours:3});
  const changed=catalogue.importRecord({...record,title:'Repeated material change',fetchedAt:at(3)},new Date(at(4))).opportunity;
  catalogue.review(changed.id,{expectedVersion:changed.version,decision:'REJECT',reason:'Synthetic decision'},new Date(at(5)));
  const decided=store.overview(new Date(at(6))).metrics.changes;assert.deepEqual(decided.completed,{samples:1,medianHours:4,p90Hours:4});assert.equal(decided.outstanding.samples,0);
  catalogue.importRecord({...record,title:'Later different change'},new Date(at(7)));
  const later=store.overview(new Date(at(8))).metrics.changes;assert.equal(later.outstanding.samples,1);assert.equal(later.outstanding.medianHours,1);
 }finally{store.close();db.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
});
test('alias provenance remains explicitly excluded when mutable links cannot establish an auditable change clock',()=>{
 const folder=mkdtempSync(join(tmpdir(),'source-alias-metric-')),file=join(folder,'db.sqlite'),catalogue=createRepository(file),record=fixtureList(now)[0].record,db=new DatabaseSync(file),actor='operator';
 db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY,role TEXT,email_verified_at TEXT)');db.prepare('INSERT INTO accounts VALUES(?,?,?)').run(actor,'OPERATOR',now.toISOString());const original=catalogue.importRecord(record,now).opportunity,store=createSourceControlRepository(file);
 try{
  const {sourceId,version,updatedAt,...editable}=permission();
  const register=(id:string)=>store.savePermission(id,{...editable,expectedVersion:0,fields:SOURCE_RECORD_FIELDS,origin:new URL(record.source.url).origin,ownerId:actor,reason:'Synthetic'},actor,now);
  const stage=(value:typeof record,hour:number,key:string)=>{const time=new Date(at(hour)),queued=store.queue(value.source.id,key,actor,time),lease=store.claim(queued.id,time);store.commitBatch(queued.id,lease.token,{expectedCursor:null,nextCursor:'done',records:[value],complete:true},time);return store.overview(time).stages.find(item=>item.runId===queued.id)!;};
  register(record.source.id);const first=stage(record,0,'first');store.markImported(first.id,original.id,actor,now);
  const alias={...record,source:{...record.source,id:'alias-source'},externalId:'alias-record'};db.prepare('INSERT INTO sources VALUES(?,?)').run(alias.source.id,JSON.stringify(alias.source));register(alias.source.id);
  const second=stage(alias,1,'alias-first');assert.equal(store.linkExactRecord(second.id,actor,new Date(at(1))),original.id);
  stage({...alias,fetchedAt:at(2)},2,'alias-refresh');assert.equal(store.overview(new Date(at(3))).metrics.changes.outstanding.samples,0);
  stage({...alias,fetchedAt:at(3),source:{...alias.source,permissionEvidence:'Changed synthetic permission evidence'}},3,'alias-permission-change');
  let metrics=store.overview(new Date(at(4))).metrics.changes;assert.equal(metrics.outstanding.samples,0);assert.equal(metrics.completed.samples,0);assert.equal(metrics.excludedAliasSnapshots,3);
  const changed=store.overview(new Date(at(4))).stages.find(item=>item.record?.source.permissionEvidence==='Changed synthetic permission evidence')!;
  assert.equal(store.linkExactRecord(changed.id,actor,new Date(at(4))),original.id);
  metrics=store.overview(new Date(at(5))).metrics.changes;assert.equal(metrics.outstanding.samples,0);assert.equal(metrics.completed.samples,0);assert.equal(metrics.excludedAliasSnapshots,3);
 }finally{store.close();db.close();catalogue.close();rmSync(folder,{recursive:true,force:true});}
});
