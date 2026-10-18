import type { DatabaseSync } from 'node:sqlite';
import type { SourceControlOverview, SourceOperationalMetrics, SourcePermission, SourceRun, MetricDistribution } from '../../../packages/domain/source-control-contracts.ts';
const DAY=86400000,HOUR=3600000;
type PermissionEvent={sourceId:string;version:number;at:string;permission:SourcePermission};
export type MaterialChange={opportunityId:string;version:number;detectedAt:string;decidedAt:string|null};
type ReviewTime={actorId:string;minutes:number;at:string};
function distribution(hours:number[]):MetricDistribution {
  const values=[...hours].sort((a,b)=>a-b),n=values.length;
  return{samples:n,medianHours:n?(n%2?values[Math.floor(n/2)]:(values[n/2-1]+values[n/2])/2):null,p90Hours:n?values[Math.ceil(n*.9)-1]:null};
}
/** Reconstruct scheduled obligations from permission history, not from the runs that happened to exist. */
export function computeSourceOperationalMetrics(input:{sourceIds:string[];permissions:PermissionEvent[];runs:SourceRun[];changes:MaterialChange[];reviewTimes:ReviewTime[];unknownLegacyChanges?:number;excludedAliasSnapshots?:number},now=new Date()):SourceOperationalMetrics {
  const end=now.getTime(),start=end-14*DAY,week=end-7*DAY;
  const sync:SourceOperationalMetrics['sync']={windowStart:new Date(start).toISOString(),windowEnd:now.toISOString(),sourceCount:input.sourceIds.length,dueIntervals:0,onTimeSuccesses:0,missedIntervals:0,lateSuccesses:0,failedIntervals:0,pendingIntervals:0,onTimePercent:null,unknownHistorySources:0,partialHistorySources:0,unobservedSourceHours:0,knownAuthorizedHours:0};
  const byId=new Map(input.runs.map(run=>[run.id,run]));
  function scheduledRoot(run:SourceRun):SourceRun|null {
    const visited=new Set<string>();let current=run;
    while(!visited.has(current.id)){
      visited.add(current.id);if(current.key.startsWith('due:'))return current;
      const parent=current.key.match(/^replay:(.+):\d+$/)?.[1];if(!parent)return null;
      const prior=byId.get(parent);if(!prior||prior.sourceId!==run.sourceId)return null;current=prior;
    }return null;
  }
  for(const sourceId of input.sourceIds){
    const events=input.permissions.filter(event=>event.sourceId===sourceId&&Number.isFinite(Date.parse(event.at))&&Date.parse(event.at)<=end).sort((a,b)=>a.version-b.version);
    const own=input.runs.filter(run=>run.sourceId===sourceId).map(run=>({run,root:scheduledRoot(run)})).filter(item=>item.root);
    let observed=0,anchor=0,previous:PermissionEvent|undefined;
    for(let index=0;index<events.length;index++){
      const event=events[index],next=events[index+1],from=Date.parse(event.at),until=Math.min(end,next?Date.parse(next.at):end);
      const cadence=event.permission.cadenceMinutes*60000,expiry=Date.parse(event.permission.expiresAt);
      // A missing intermediate version makes the entire preceding segment unobservable.
      const known=(!next||next.version===event.version+1)&&Number.isFinite(cadence)&&cadence>=15*60000&&cadence<=1440*60000&&Number.isFinite(expiry)&&until>=from;
      if(!known){previous=undefined;continue;}
      observed+=Math.max(0,until-Math.max(from,start));
      const continues=previous&&previous.permission.state==='ACTIVE'&&event.permission.state==='ACTIVE'&&previous.permission.cadenceMinutes===event.permission.cadenceMinutes&&Date.parse(previous.permission.expiresAt)>=from&&previous.version+1===event.version;
      if(!continues)anchor=from;
      previous=event;
      if(event.permission.state!=='ACTIVE')continue;
      // A resumed or re-timed root cannot satisfy an older overlapping deadline window.
      // Same-cadence ACTIVE renewals belong to one continuous episode and preserve attribution.
      let attributionEnd=expiry;
      for(let later=index+1;later<events.length;later++){
        const revision=events[later],revisionAt=Date.parse(revision.at),prior=events[later-1];
        if(revisionAt>attributionEnd)break;
        if(revision.version!==prior.version+1||revision.permission.state!=='ACTIVE'||revision.permission.cadenceMinutes!==event.permission.cadenceMinutes){attributionEnd=revisionAt;break;}
        const renewedExpiry=Date.parse(revision.permission.expiresAt);
        if(!Number.isFinite(renewedExpiry)){attributionEnd=revisionAt;break;}
        attributionEnd=renewedExpiry;
      }
      const activeUntil=Math.min(until,expiry),activeStart=Math.max(from,start);
      sync.knownAuthorizedHours+=Math.max(0,activeUntil-activeStart)/HOUR;
      const first=anchor+Math.max(0,Math.ceil((activeStart-anchor)/cadence))*cadence;
      // The current due instant is included; a superseded/expired permission is exclusive at its end.
      for(let due=first;due<=end&&due<expiry&&(!next||due<Date.parse(next.at));due+=cadence){
        if(due<from)continue;
        const deadline=due+cadence;
        const attempts=own.filter(({root})=>Date.parse(root!.createdAt)>=due&&Date.parse(root!.createdAt)<Math.min(deadline,attributionEnd));
        const successes=attempts.filter(({run})=>run.state==='SUCCEEDED'&&Date.parse(run.updatedAt)<=end);
        sync.dueIntervals++;
        if(successes.some(({run})=>Date.parse(run.updatedAt)<=deadline))sync.onTimeSuccesses++;
        else if(successes.length)sync.lateSuccesses++;
        else if(deadline>end)sync.pendingIntervals++;
        else if(!attempts.length)sync.missedIntervals++;
        else sync.failedIntervals++;
      }
    }
    const unobserved=Math.max(0,14*DAY-observed);sync.unobservedSourceHours+=unobserved/HOUR;
    if(!observed)sync.unknownHistorySources++;else if(unobserved>0)sync.partialHistorySources++;
  }
  sync.onTimePercent=sync.dueIntervals?100*sync.onTimeSuccesses/sync.dueIntervals:null;
  const valid=input.changes.filter(change=>Number.isFinite(Date.parse(change.detectedAt))&&Date.parse(change.detectedAt)<=end);
  const completed=valid.filter(change=>change.decidedAt&&Date.parse(change.decidedAt)>=week&&Date.parse(change.decidedAt)<=end&&Date.parse(change.decidedAt)>=Date.parse(change.detectedAt));
  const outstanding=valid.filter(change=>!change.decidedAt||Date.parse(change.decidedAt)>end);
  const times=input.reviewTimes.filter(item=>Date.parse(item.at)>=week&&Date.parse(item.at)<=end&&Number.isFinite(item.minutes)&&item.minutes>0);
  const minutes=times.reduce((total,item)=>total+item.minutes,0);
  return{synthetic:true,asOf:now.toISOString(),sync,changes:{windowStart:new Date(week).toISOString(),windowEnd:now.toISOString(),detectedInWindow:valid.filter(change=>Date.parse(change.detectedAt)>=week).length,completed:distribution(completed.map(change=>(Date.parse(change.decidedAt!)-Date.parse(change.detectedAt))/HOUR)),outstanding:distribution(outstanding.map(change=>(end-Date.parse(change.detectedAt))/HOUR)),olderOutstanding:outstanding.filter(change=>Date.parse(change.detectedAt)<week).length,unknownLegacyChanges:input.unknownLegacyChanges??0,excludedAliasSnapshots:input.excludedAliasSnapshots??0},workload:{windowStart:new Date(week).toISOString(),windowEnd:now.toISOString(),entries:times.length,reviewers:new Set(times.map(item=>item.actorId)).size,minutes,hours:minutes/60,scope:'SOURCE_REVIEW_ONLY'}};
}
function canonical(value:unknown):string{if(Array.isArray(value))return JSON.stringify(value.map(canonical));if(value&&typeof value==='object')return JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return JSON.stringify(value);}
function materialKey(raw:string):string {
  const value=JSON.parse(raw) as Record<string,unknown>;
  // Fetch bookkeeping alone is not a changed opportunity. Permission, evidence and confirmed/valid dates remain material.
  for(const key of ['fetchedAt','sourceUpdatedAt'])delete value[key];
  return canonical(value);
}
function materialChange(before:string,after:string):boolean {return materialKey(before)!==materialKey(after);}
/** Reads immutable catalogue revisions and decisions without projecting text or account identifiers into metrics. */
export function readSourceOperationalMetrics(db:DatabaseSync,sources:{id:string}[],permissions:SourceControlOverview['permissions'],runs:SourceRun[],now=new Date()):SourceOperationalMetrics {
  const revisions=db.prepare('SELECT opportunity_id,version,at,before_json,after_json FROM catalogue_revisions WHERE at<=? ORDER BY opportunity_id,version').all(now.toISOString()) as {opportunity_id:string;version:number;at:string;before_json:string|null;after_json:string}[];
  const decisions=db.prepare("SELECT opportunity_id,version,at FROM catalogue_audit WHERE action IN('PUBLISH','REJECT','WITHDRAW') AND at<=? ORDER BY opportunity_id,version").all(now.toISOString()) as {opportunity_id:string;version:number;at:string}[];
  const current=db.prepare('SELECT id,source_id,external_id,record_json FROM opportunities').all() as {id:string;source_id:string;external_id:string;record_json:string}[];
  const links=db.prepare('SELECT source_id,external_id,opportunity_id FROM source_record_links').all() as {source_id:string;external_id:string;opportunity_id:string}[];
  const staged=(db.prepare('SELECT id,source_id,external_id,opportunity_id,state,record_json,created_at FROM source_staged_records WHERE record_json IS NOT NULL AND created_at<=?').all(now.toISOString()) as {id:string;source_id:string;external_id:string;opportunity_id:string|null;state:string;record_json:string;created_at:string}[]).map(stage=>({...stage,current:current.find(item=>item.id===stage.opportunity_id)||current.find(item=>item.source_id===stage.source_id&&item.external_id===stage.external_id)||current.find(item=>item.id===links.find(link=>link.source_id===stage.source_id&&link.external_id===stage.external_id)?.opportunity_id)}));
  // Mutable source links cannot establish a historical alias-provenance clock. Keep that population explicitly unknown.
  const aliasFamilies=new Set(staged.filter(stage=>stage.opportunity_id&&stage.current&&(stage.current.source_id!==stage.source_id||stage.current.external_id!==stage.external_id)).map(stage=>`${stage.source_id}:${stage.external_id}`));
  const excludedAliases=new Set(staged.filter(stage=>stage.current&&((stage.current.source_id!==stage.source_id||stage.current.external_id!==stage.external_id)||(aliasFamilies.has(`${stage.source_id}:${stage.external_id}`)&&!revisions.some(row=>row.opportunity_id===stage.current!.id&&Date.parse(row.at)<=Date.parse(stage.created_at))))).map(stage=>stage.id));
  const changes:MaterialChange[]=revisions.filter(row=>row.before_json&&materialChange(row.before_json,row.after_json)).map(row=>{
    const previous=revisions.filter(item=>item.opportunity_id===row.opportunity_id&&item.version<row.version&&(!item.before_json||materialChange(item.before_json,item.after_json))).at(-1);
    const detected=staged.filter(stage=>!excludedAliases.has(stage.id)&&stage.current?.id===row.opportunity_id&&Date.parse(stage.created_at)>=Date.parse(previous?.at??row.at)&&Date.parse(stage.created_at)<=Date.parse(row.at)&&!materialChange(stage.record_json,row.after_json)).map(stage=>stage.created_at).sort()[0]??row.at;
    return{opportunityId:row.opportunity_id,version:row.version,detectedAt:detected,decidedAt:decisions.find(decision=>decision.opportunity_id===row.opportunity_id&&decision.version>=row.version&&Date.parse(decision.at)>=Date.parse(row.at))?.at??null};
  });
  // Repeated fetches of one unresolved material payload are one change, first seen at the earliest detection.
  const unresolved=new Map<string,MaterialChange>();
  for(const stage of staged){
    if(stage.state!=='STAGED'||!stage.current||excludedAliases.has(stage.id))continue;
    const history=revisions.filter(row=>row.opportunity_id===stage.current!.id);
    const baseline=history.filter(row=>Date.parse(row.at)<=Date.parse(stage.created_at)).at(-1)?.after_json??stage.current.record_json;
    if(!materialChange(baseline,stage.record_json))continue;
    // Importing this same material payload already transfers its clock to the revision path above.
    if(history.some(row=>Date.parse(row.at)>=Date.parse(stage.created_at)&&!materialChange(row.after_json,stage.record_json)))continue;
    const key=`${stage.current.id}:${materialKey(stage.record_json)}`,prior=unresolved.get(key);
    if(!prior||Date.parse(stage.created_at)<Date.parse(prior.detectedAt))unresolved.set(key,{opportunityId:stage.current.id,version:-1,detectedAt:stage.created_at,decidedAt:null});
  }
  changes.push(...unresolved.values());
  const unknown=(db.prepare("SELECT count(*) AS n FROM import_runs i WHERE i.result='CHANGED' AND i.at<=? AND NOT EXISTS(SELECT 1 FROM catalogue_revisions r WHERE r.opportunity_id=i.opportunity_id AND r.at=i.at AND r.action='IMPORT')").get(now.toISOString()) as {n:number}).n;
  const times=db.prepare('SELECT actor_id AS actorId,minutes,at FROM source_review_time WHERE at>=? AND at<=?').all(new Date(now.getTime()-7*DAY).toISOString(),now.toISOString()) as ReviewTime[];
  return computeSourceOperationalMetrics({sourceIds:sources.map(source=>source.id),permissions,runs,changes,reviewTimes:times,unknownLegacyChanges:unknown,excludedAliasSnapshots:excludedAliases.size},now);
}
