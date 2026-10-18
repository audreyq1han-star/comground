'use client';
import { RANKING_POLICY_VERSION } from '../../../../packages/domain/rules.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudentMatches } from '../../../../packages/domain/app-contracts.ts';
import type { MeasurementConsent, RecommendationExposure, RecommendationPresentation } from '../../../../packages/domain/measurement-contracts.ts';
import { messageOf } from '../Api';
import { useCampaign } from './CampaignContext';
import { useStudent } from './StudentSession';

export function recommendationIdentity(result: StudentMatches) {
  return JSON.stringify([result.profileVersion, result.data.map(item => [item.opportunity.id, item.opportunity.occurrenceId ?? 'primary', item.opportunity.version])]);
}
type State = { data: RecommendationPresentation | null; exposure: RecommendationExposure | null; loading: boolean; refreshing: boolean; error: string; refreshError: string; acknowledgementError: string; campaignError: string };
export function useRecommendations() {
  const { request, readRevision, getSessionEpoch } = useStudent();
  const { campaign, ready } = useCampaign();
  const campaignId = campaign?.id;
  const [state, setState] = useState<State>({data:null,exposure:null,loading:true,refreshing:false,error:'',refreshError:'',acknowledgementError:'',campaignError:''});
  const sequence = useRef(0), busy = useRef(false), active = useRef(true);
  const initialStarted = useRef(false), queuedRevalidation = useRef(false);
  const [drainedRevision, setDrainedRevision] = useState(0);
  const initialId = useRef<string|null>(null);
  const lastRequest = useRef({ measured:true, requestId:'' });
  const presentation = useRef<{token:string;identity:string;epoch:number}|null>(null);
  const acknowledging = useRef<string|null>(null);
  const acknowledged = useRef(new Set<string>());
  const load = useCallback(async (measured:boolean, requestId:string) => {
    if (!active.current) return;
    const current = ++sequence.current; busy.current = true;
    const epoch = getSessionEpoch();
    const isCurrent = () => active.current && current === sequence.current && epoch === getSessionEpoch();
    if (measured) presentation.current = null;
    lastRequest.current = {measured,requestId};
    setState(previous=>({...previous,loading:previous.data===null,refreshing:previous.data!==null,error:'',refreshError:'',acknowledgementError:'',campaignError:''}));
    try {
      let result: RecommendationPresentation;
      let campaignError = '';
      const consent = await request<{data:MeasurementConsent}>('/api/student/measurement');
      if (!isCurrent()) return;
      if (measured && consent.data.enabled && campaignId) {
        try { await request('/api/student/attribution',{method:'POST',body:JSON.stringify({campaignId})}); }
        catch (cause) { campaignError = `Campaign attribution was not changed: ${messageOf(cause)}`; }
        if (!isCurrent()) return;
      }
      if (measured) result = await request<RecommendationPresentation>('/api/student/recommendations',{method:'POST',body:JSON.stringify({requestId})});
      else {
        const matches = await request<StudentMatches>('/api/student/matches',{method:'POST',body:'{}'});
        result = {...matches,presentationToken:null,measurementEnabled:consent.data.enabled,rulesVersion:RANKING_POLICY_VERSION};
      }
      if (!isCurrent() || queuedRevalidation.current) return;
      const identity = recommendationIdentity(result);
      // A focus check of the same cards must retain a pending acknowledgement.
      // Different preferences, listing versions, dates or consent discard it.
      const preservePresentation = !measured && result.measurementEnabled && presentation.current?.epoch === epoch && presentation.current.identity === identity;
      if (preservePresentation) result = {...result,presentationToken:presentation.current!.token};
      else presentation.current = result.presentationToken ? {token:result.presentationToken,identity,epoch} : null;
      setState(previous=>({...previous,data:result,exposure:preservePresentation?previous.exposure:null,loading:false,refreshing:false,error:'',refreshError:'',acknowledgementError:'',campaignError}));
    } catch(cause) {
      if (isCurrent() && !queuedRevalidation.current) setState(previous=>({...previous,loading:false,refreshing:false,error:previous.data?'':messageOf(cause),refreshError:previous.data?messageOf(cause):''}));
    } finally {
      if (isCurrent()) {
        busy.current = false;
        if (queuedRevalidation.current) {
          queuedRevalidation.current = false;
          setDrainedRevision(revision => revision + 1);
        }
      }
    }
  },[request,campaignId,getSessionEpoch]);
  useEffect(()=>{
    active.current = true;
    return()=>{active.current=false;++sequence.current;busy.current=false;queuedRevalidation.current=false;presentation.current=null;initialStarted.current=false;};
  },[]);
  useEffect(()=>{
    if(!ready)return;
    // Coalesce focus/session refreshes while busy; never lose the latest read or
    // turn a background revalidation into another measured presentation.
    if(busy.current){queuedRevalidation.current=true;return;}
    initialId.current ??= crypto.randomUUID();
    const measured = !initialStarted.current;
    initialStarted.current = true;
    void load(measured,initialId.current);
  },[ready,readRevision,load,drainedRevision]);
  const reload = useCallback(()=>{ if(!busy.current)void load(true,crypto.randomUUID()); },[load]);
  const retry = useCallback(()=>{ if(!busy.current)void load(lastRequest.current.measured,lastRequest.current.requestId||crypto.randomUUID()); },[load]);
  const acknowledge = useCallback(async(token:string)=>{
    const epoch = getSessionEpoch();
    const isCurrent = () => active.current && presentation.current?.token === token && presentation.current.epoch === epoch && epoch === getSessionEpoch();
    if(!isCurrent()||acknowledging.current===token||acknowledged.current.has(token))return;
    acknowledging.current=token;
    try {
      const result=await request<{data:RecommendationExposure|null}>('/api/student/recommendations/exposures',{method:'POST',body:JSON.stringify({presentationToken:token})});
      if (!isCurrent()) return;
      acknowledged.current.add(token);
      setState(previous=>({...previous,exposure:result.data,acknowledgementError:''}));
    } catch(cause) { if(isCurrent())setState(previous=>({...previous,acknowledgementError:messageOf(cause)})); }
    finally { if(acknowledging.current===token)acknowledging.current=null; }
  },[request,getSessionEpoch]);
  const consentChanged = useCallback((consent:MeasurementConsent)=>{
    if (!active.current) return;
    ++sequence.current;busy.current=false;queuedRevalidation.current=false;presentation.current=null;
    setState(previous=>({...previous,exposure:null,acknowledgementError:'',data:previous.data?{...previous.data,measurementEnabled:consent.enabled,presentationToken:null}:null}));
    // A consent change never retroactively measures the cards already on screen.
    void load(false,crypto.randomUUID());
  },[load]);
  return {...state,reload,retry,acknowledge,consentChanged};
}
