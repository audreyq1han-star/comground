'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ActivityItem, StudentSaved } from '../../../../packages/domain/app-contracts.ts';
import { messageOf } from '../Api';
import { useRuntime } from '../account/RuntimeContext';
import { useStudent } from './StudentSession';
export function OpportunityActions({id,occurrenceId,signupUrl}:{id:string;occurrenceId:string;signupUrl:string}){
  const {runtime}=useRuntime();const account=!!runtime?.capabilities.accounts;
  const {session,loading,request,readRevision}=useStudent();const [saved,setSaved]=useState<boolean|null>(null);const [pending,setPending]=useState(false);const [error,setError]=useState('');const [status,setStatus]=useState('');const [preview,setPreview]=useState<ActivityItem|null>(null);const dialog=useRef<HTMLDialogElement>(null);const previewOpener=useRef<HTMLButtonElement>(null);
  const [checkingSave, setCheckingSave] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [saveAttempt, setSaveAttempt] = useState(0);
  const saveRead = useRef(0);
  const actionPending = useRef(false);
  const personaId = session.profile?.personaId;
  useEffect(() => { setSaved(null); setPreview(null); setError(''); setStatus(''); }, [id, occurrenceId, personaId]);
  useEffect(() => {
    let active = true;
    const current = ++saveRead.current;
    if (!personaId || pending) return;
    setCheckingSave(true); setSaveError('');
    request<{data:StudentSaved[]}>('/api/student/saves')
      .then(result => { if (active && current === saveRead.current) setSaved(result.data.some(item => item.opportunityId === id && item.occurrenceId === occurrenceId)); })
      .catch(e => { if (active && current === saveRead.current) setSaveError(messageOf(e)); })
      .finally(() => { if (active && current === saveRead.current) setCheckingSave(false); });
    return () => { active = false; };
  }, [id, occurrenceId, personaId, request, readRevision, pending, saveAttempt]);
  async function save() {
    if (actionPending.current || saved === null || checkingSave || saveError) return;
    actionPending.current = true; ++saveRead.current; setPending(true); setError(''); setStatus('');
    try {
      if (saved) await request(`/api/student/saves/${encodeURIComponent(id)}/${encodeURIComponent(occurrenceId)}`, { method:'DELETE' });
      else await request('/api/student/saves', { method:'POST', body:JSON.stringify({opportunityId:id,occurrenceId}) });
      setSaved(!saved); setStatus(saved ? 'Removed from saved ideas.' : account?'Saved to your account.':'Saved to this demo persona.');
    } catch(e) { setError(messageOf(e)); }
    finally { actionPending.current = false; setPending(false); }
  }
  async function handoff() {
    if (actionPending.current) return;
    actionPending.current = true; ++saveRead.current; setPending(true); setError('');
    try {
      const result = await request<{data:ActivityItem}>('/api/student/handoffs', {method:'POST',body:JSON.stringify({opportunityId:id,occurrenceId})});
      setPreview(result.data); requestAnimationFrame(()=>dialog.current?.showModal());
    } catch(e) { setError(messageOf(e)); }
    finally { actionPending.current = false; setPending(false); }
  }
  function containDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const currentDialog = event.currentTarget;
    const controls = Array.from(currentDialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]'
    )).filter(control => control.tabIndex >= 0
      && !control.matches(':disabled, [aria-disabled="true"]')
      && !control.closest('[inert]')
      && control.getClientRects().length > 0
      && window.getComputedStyle(control).visibility !== 'hidden');
    event.preventDefault();
    if (!controls.length) { currentDialog.focus(); return; }
    const index = controls.indexOf(document.activeElement as HTMLElement);
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus();
  }
  if(loading)return <p role="status">Checking your session…</p>;
  if(!session.profile)return <><Link className="button primary full-width" href={account&&!session.authenticated?'/account/login':'/onboarding'}>{account?'Set up your profile to save':'Choose a persona to save'}</Link><p className="fine-print">{account?'Saving requires a verified account and a profile with storage consent.':'Saving and destination previews require a consented synthetic profile.'}</p></>;
  return <div className="opportunity-actions"><button className="button secondary full-width" onClick={save} disabled={pending||checkingSave||saved===null||!!saveError} aria-pressed={saved??false}>{checkingSave?'Checking saved status…':saved?'Saved ✓ · remove':'Save opportunity'}</button>{saveError&&<p role="alert" className="notice error">{saveError}<button type="button" className="plain-button" disabled={pending||checkingSave} onClick={()=>setSaveAttempt(attempt=>attempt+1)}>Retry saved status</button></p>}<button ref={previewOpener} className="button primary full-width" onClick={handoff} disabled={pending}>Preview demo signup →</button>{error&&<p role="alert" className="notice error">{error}</p>}{status&&<p role="status" className="action-status">{status}</p>}<p className="fine-print">A preview creates a demo activity record. It never submits an application.</p><dialog ref={dialog} className="signup-dialog" aria-labelledby="signup-title" onKeyDown={containDialogFocus} onClose={()=>previewOpener.current?.focus({preventScroll:true})}><button className="dialog-close" onClick={()=>dialog.current?.close()} aria-label="Close signup preview">×</button><p className="eyebrow">EXAMPLE DESTINATION ONLY</p><h2 id="signup-title">Signup happens with the organizer.</h2><p>This demo records that you previewed a destination. No external page opens, and nothing is submitted.</p><div className="example-address"><span>Synthetic signup address</span><code>{preview?.signupUrl??signupUrl}</code></div><p className="notice success">Status: demo destination preview. This is not an application.</p><Link className="button primary" href="/activity" onClick={()=>dialog.current?.close()}>View my activity →</Link><button className="button secondary" onClick={()=>dialog.current?.close()}>Keep exploring</button></dialog></div>;
}
