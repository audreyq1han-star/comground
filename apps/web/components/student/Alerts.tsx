'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { AlertPreferences, InAppReminder } from '../../../../packages/domain/app-contracts.ts';
import { messageOf } from '../Api';
import { useStudent, StudentGate } from './StudentSession';
import { useStudentResource } from './useStudentResource';
import { PageHeading, LoadState, EmptyPanel } from './StudentCommon';
import { DigestPreview } from './DigestPreview';
import { useRuntime } from '../account/RuntimeContext';
function AlertSettings({ value, onSaved }: { value: AlertPreferences; onSaved: (value: AlertPreferences) => void }) {
  const { request, session } = useStudent();const {runtime}=useRuntime();const account=!!runtime?.capabilities.accounts;
  const [draft, setDraft] = useState(value);
  const [profileVersion,setProfileVersion]=useState(session.profile?.version);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => { if (!dirty) {setDraft(value);setProfileVersion(session.profile?.version);} }, [value, dirty, session.profile?.version]);
  function change(field: keyof AlertPreferences, checked: boolean) {
    setDraft(current => ({ ...current, [field]: checked })); setDirty(true); setStatus('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(''); setStatus('');
    try {
      const result = await request<{ data: AlertPreferences }>('/api/student/alerts', { method: 'PUT', body: JSON.stringify({...draft,...(account?{expectedProfileVersion:profileVersion}:{})}) });
      setDraft(result.data); setDirty(false);
      setStatus(result.data.inApp ? 'In-app preferences saved.' : 'Reminders are off. Existing reminders are immediately suppressed.');
      onSaved(result.data);
    } catch (e) { setError(messageOf(e)); } finally { setPending(false); }
  }
  return <form className="settings-panel alert-preferences" onSubmit={save}>
    <p className="eyebrow">YOUR CHOICE / OFF BY DEFAULT</p><h2>A nudge, only if you want one.</h2><p>{account?'In-app reminders appear when you open the app. Optional email event reminders have a separate setting; enabling these controls sends no email.':'Reminders are calculated locally when you open the app. No email, SMS, push delivery or background scheduler is connected.'}</p>{account&&<Link className="text-link" href="/account/notifications">Manage optional email reminders →</Link>}
    <div className="check-list">
      <label className="main-toggle"><input type="checkbox" checked={draft.inApp} disabled={pending} onChange={event => change('inApp', event.target.checked)} /><span>Enable in-app reminders</span></label>
      <label><input name="event" type="checkbox" checked={draft.eventReminders} disabled={pending || !draft.inApp} onChange={event => change('eventReminders', event.target.checked)} /><span>Event reminders and post-event follow-up<small>Upcoming saved or current activities and a chance to report an outcome.</small></span></label>
      <label><input name="catalogue" type="checkbox" checked={draft.catalogueUpdates} disabled={pending || !draft.inApp} onChange={event => change('catalogueUpdates', event.target.checked)} /><span>Unavailable saved opportunities<small>Know when a saved example can no longer be acted on.</small></span></label>
    </div>
      {dirty && <p className="fine-print">Your unsaved choices are kept during refreshes. <button type="button" className="plain-button" disabled={pending} onClick={() => { setDraft(value);setProfileVersion(session.profile?.version); setDirty(false); }}>Discard changes</button></p>}
    <button className="button primary full-width" disabled={pending} type="submit">{pending ? 'Saving…' : 'Save reminder preferences'}</button>
    {error && <p className="notice error" role="alert">{error}</p>}{status && <p className="action-status" role="status">{status}</p>}
  </form>;
}
function AlertsContent(){const{request}=useStudent();const settings=useStudentResource<{data:AlertPreferences}>('/api/student/alerts');const list=useStudentResource<{data:InAppReminder[]}>('/api/student/reminders');const[pending,setPending]=useState('');const[error,setError]=useState('');const[status,setStatus]=useState('');async function action(id:string,action:'READ'|'DISMISS'){setPending(id);setError('');try{await request(`/api/student/reminders/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({action})});setStatus(action==='READ'?'Reminder marked read.':'Reminder dismissed.');list.reload();}catch(e){setError(messageOf(e));}finally{setPending('');}}return <><PageHeading eyebrow="ALERTS / INSIDE THIS APP ONLY" title="Stay in the loop, on your terms." description="Control which local reminders appear. Opting out suppresses them immediately."/><div className="alerts-layout"><LoadState {...settings} retry={settings.reload}>{settings.data&&<AlertSettings value={settings.data.data} onSaved={value=>{settings.setData({data:value});settings.reload();list.reload();}}/>}</LoadState><section aria-labelledby="reminders-title"><div className="results-heading"><h2 id="reminders-title">Your reminders</h2><button className="plain-button" onClick={list.reload} disabled={list.loading||list.refreshing}>Refresh</button></div>{error&&<p className="notice error" role="alert">{error}</p>}{status&&<p className="action-status" role="status">{status}</p>}<LoadState {...list} retry={list.reload}>{list.data?.data.length?<div className="reminder-list">{list.data.data.map(r=><article key={r.id} className={`reminder-card ${r.read?'read':''}`}><div><span className="category-badge">{r.kind==='UPCOMING'?'Upcoming':r.kind==='FOLLOW_UP'?'Follow-up':'Availability changed'}</span><span className="read-label">{r.read?'Read':'Unread'}</span></div><h3>{r.title}</h3><p>{r.message}</p><div className="reminder-actions"><Link className="text-link" href={r.href}>{r.kind==='FOLLOW_UP'?'Report an outcome':'View details'} →</Link>{!r.read&&<button className="plain-button" disabled={!!pending} onClick={()=>action(r.id,'READ')}>Mark read</button>}<button className="plain-button" disabled={!!pending} onClick={()=>action(r.id,'DISMISS')}>Dismiss</button></div></article>)}</div>:<EmptyPanel title="All quiet here." text={settings.data?.data.inApp?'No eligible reminders right now. Save a current example or check your activity later.':'Reminders are off. Enable the kinds you want to see, then save your preferences.'}/>}</LoadState></section></div><DigestPreview/></>;}
export function Alerts(){return <div className="page-shell student-page"><StudentGate><AlertsContent/></StudentGate></div>;}
