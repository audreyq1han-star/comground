'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useRuntime } from './account/RuntimeContext';
import { AiExplanations } from './student/AiExplanations';
import { OpportunityCard } from './OpportunityCard';
import { StudentGate } from './student/StudentSession';
import { PageHeading, LoadState, EmptyPanel } from './student/StudentCommon';
import { MeasurementControl } from './student/MeasurementControl';
import { RecommendationFeedback } from './student/RecommendationFeedback';
import { useRecommendations } from './student/useRecommendations';
function MatchContent() {
  const resource = useRecommendations();
  const { runtime } = useRuntime();
  const matches = resource.data;
  const prefs = matches?.preferences;
  const shortlist = useRef<HTMLDivElement>(null);
  const token=matches?.presentationToken;
  const {acknowledge}=resource;
  useEffect(()=>{
    const element=shortlist.current;if(!token||!element)return;
    let visible=false,active=true,frame=0;
    const present=()=>{
      if(!active||!visible||document.visibilityState!=='visible')return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{if(active&&visible&&document.visibilityState==='visible')void acknowledge(token);});});
    };
    const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);present();},{threshold:0.05});
    observer.observe(element);document.addEventListener('visibilitychange',present);
    return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',present);};
  },[token,acknowledge]);
  return <>
    <PageHeading eyebrow="MATCHES / REQUIREMENTS FIRST" title="A shortlist with a reason." description="Hard eligibility comes first. Each choice includes an eligible date. Shared interests order the options that fit; rules provide the default explanations." action={<Link className="button secondary" href="/profile">Edit preferences</Link>} />
    {runtime?.capabilities.accounts && <p className="notice"><Link href="/account/privacy">Manage personalized matching and privacy choices</Link>. Personalized matches are optional and off until you choose them.</p>}
    <details className="settings-panel"><summary>Optional local measurement settings</summary><MeasurementControl onSaved={resource.consentChanged}/></details>
    <LoadState {...resource} retry={resource.retry}>
      {matches && prefs && <section aria-label="Your displayed shortlist">
        <div className="preference-summary"><span className="rule-badge">Stored profile v{matches.profileVersion}</span><span>Ages {prefs.ageMin}–{prefs.ageMax}</span><span>{prefs.mode==='REMOTE'?'Remote':prefs.area||'No area selected'}</span><span>{prefs.interests.join(', ')||'No interest preference'}</span><span>{prefs.requiresSchoolCredit?'School credit required':'School credit not required'}</span><button className="plain-button" onClick={resource.reload} disabled={resource.refreshing}>Refresh matches</button></div>
        <div className="results-heading"><h2>Your shortlist</h2><p role="status">{matches.eligibleCount} eligible examples · showing {matches.data.length}</p></div>
        <p className="fine-print">{matches.measurementEnabled ? resource.exposure?'This visible shortlist was recorded under your separate measurement choice. Relevance is optional.':'Measurement is on. Only a newly generated shortlist presented on screen is recorded; focus checks, dashboard and digest previews do not add presentations. Use Refresh matches to generate one.' : 'Optional measurement is off. Your shortlist is available without recording recommendation exposures or relevance.'}</p>
        {resource.campaignError&&<p className="notice warning" role="status">{resource.campaignError}</p>}
        {resource.acknowledgementError&&<p className="notice error" role="alert">{resource.acknowledgementError} <button className="plain-button" onClick={()=>{if(token)void acknowledge(token);}}>Retry recording displayed shortlist</button></p>}
        {matches.data.length ? <div ref={shortlist} className="dashboard-matches">{matches.data.map((match,index)=><div key={`${match.opportunity.id}:${match.opportunity.occurrenceId??'primary'}`} data-opportunity-id={match.opportunity.id} data-occurrence-id={match.opportunity.occurrenceId??'primary'}>
          <OpportunityCard opportunity={match.opportunity} reasons={match.reasons} position={index+1}/>
          {resource.exposure&&<RecommendationFeedback key={resource.exposure.id} exposureId={resource.exposure.id} opportunityId={match.opportunity.id} occurrenceId={match.opportunity.occurrenceId??'primary'} title={match.opportunity.title} disabled={resource.refreshing}/>}
        </div>)}</div> : <div ref={shortlist}><EmptyPanel title="No current examples meet all your requirements." text="Check your example dates, area and practical requirements. Unknown or incompatible dates stay out of the shortlist. Keep requirements that matter; you can also browse for context." href="/profile" label="Review preferences"/></div>}
        <AiExplanations key={`${matches.profileVersion}:${matches.data.map(item=>`${item.opportunity.id}:${item.opportunity.version}:${item.opportunity.occurrenceId}`).join()}`} matches={matches}/>
        <p className="matching-footnote">No percentage confidence or school-credit certification. Another date under the same title may have different availability. Saving or previewing a date does not mean you applied.</p>
      </section>}
    </LoadState>
  </>;
}
export function Matches(){return <div className="page-shell student-page"><StudentGate><MatchContent/></StudentGate></div>;}
