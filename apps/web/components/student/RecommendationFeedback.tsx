'use client';
import { useRef, useState } from 'react';
import type { RecommendationFeedback as Feedback, RecommendationVerdict } from '../../../../packages/domain/measurement-contracts.ts';
import { messageOf } from '../Api';
import { useStudent } from './StudentSession';
export function RecommendationFeedback({exposureId,opportunityId,occurrenceId,title,disabled}:{exposureId:string;opportunityId:string;occurrenceId:string;title:string;disabled:boolean}) {
  const {request}=useStudent();
  const [verdict,setVerdict]=useState<RecommendationVerdict|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const busy=useRef(false);
  async function send(next:RecommendationVerdict){
    if(busy.current||disabled||verdict)return;busy.current=true;setPending(true);setError('');
    try{const result=await request<{data:Feedback}>('/api/student/recommendations/feedback',{method:'POST',body:JSON.stringify({exposureId,opportunityId,occurrenceId,verdict:next})});setVerdict(result.data.verdict);}
    catch(cause){setError(`${messageOf(cause)} Refresh matches if this date or your preferences changed.`);}
    finally{busy.current=false;setPending(false);}
  }
  return <section className="settings-panel" aria-label={`Relevance of ${title}`}>
    <p>Is this selected date relevant to the example persona?</p><div className="button-row"><button type="button" className="button secondary" disabled={disabled||pending||verdict!==null} aria-pressed={verdict==='RELEVANT'} onClick={()=>void send('RELEVANT')}>Relevant</button><button type="button" className="button secondary" disabled={disabled||pending||verdict!==null} aria-pressed={verdict==='NOT_RELEVANT'} onClick={()=>void send('NOT_RELEVANT')}>Not relevant</button></div>
    <p className="fine-print">Optional structured relevance only. It is separate from reporting incorrect facts, applying or attending.</p>
    {verdict&&<><p role="status" className="action-status">{verdict==='RELEVANT'?'Relevance recorded: relevant.':'Relevance recorded: not relevant.'}</p><p className="fine-print">Your response is fixed for this displayed shortlist. Use Refresh matches to assess a new shortlist.</p></>}{error&&<p role="alert" className="notice error">{error}</p>}
  </section>;
}
