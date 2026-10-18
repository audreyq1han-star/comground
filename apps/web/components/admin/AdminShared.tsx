'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, messageOf } from '../Api';
import { useAdminSession } from './AdminShell';

export function useAdminResource<T>(url: string) {
  const [data,setData] = useState<T | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const sequence = useRef(0);
  const { invalidate } = useAdminSession();
  const reload = useCallback(async () => {
    const current = ++sequence.current; setLoading(true); setError('');
    try { const result = await api<{data:T}>(url); if (current === sequence.current) setData(result.data); }
    catch(e) { if (current === sequence.current) { setError(messageOf(e)); if (e instanceof ApiError && (e.status === 401 || e.code === 'INVALID_SESSION')) { setData(null); invalidate(); } } }
    finally { if (current === sequence.current) setLoading(false); }
  },[url,invalidate]);
  useEffect(() => { setData(null); void reload(); return () => { sequence.current += 1; }; },[reload]);
  return {data,loading,error,reload};
}

export function useAdminMutation() {
  const [pending,setPending] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [conflict,setConflict] = useState(false);
  const busy = useRef(false);
  const {invalidate} = useAdminSession();
  async function run(task:()=>Promise<void>, message:string) {
    if(busy.current) return false;
    busy.current=true; setPending(true);setError('');setSuccess('');setConflict(false);
    try {await task();setSuccess(message);return true;}
    catch(e){const stale=e instanceof ApiError && e.status===409 && (e.code==='VERSION_CONFLICT'||e.code==='STATE_CONFLICT');setConflict(stale);setError(stale ? 'This record changed since you loaded it. Reload the current version, inspect the changes, then submit a new decision.' : messageOf(e));if(e instanceof ApiError && (e.status===401 || e.code==='INVALID_SESSION'))invalidate();return false;}
    finally{busy.current=false;setPending(false);}
  }
  return {pending,error,success,conflict,run};
}

/** Keep ordinary refreshes quiet; announce a changed record without losing keyboard position. */
export function useVersionFocus(version: string | number) {
  const target = useRef<HTMLHeadingElement>(null);
  const previous = useRef(version);
  useEffect(() => {
    if (previous.current !== version) target.current?.focus({ preventScroll: true });
    previous.current = version;
  }, [version]);
  return target;
}

export function AdminPageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}) {
  return <header className="op-page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
export function StatusPill({value}:{value:string}) {return <span className={`op-status op-status-${value.toLowerCase().replaceAll('_','-')}`}>{value.replaceAll('_',' ')}</span>;}
export function Timestamp({value}:{value:string|null}) {return value ? <time dateTime={value}>{new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</time> : <span>Not recorded</span>;}
export function ResourceState({loading,error,empty,emptyTitle='Nothing to show yet',emptyMessage='Records will appear here when the relevant local workflow is used.',retry}:{loading:boolean;error:string;empty:boolean;emptyTitle?:string;emptyMessage?:string;retry:()=>void}) {
  if(error)return <div className="notice error" role="alert"><p>{error}</p>{!empty&&<p>This view may be out of date. Reload it before making another versioned decision.</p>}<button className="button secondary" onClick={retry}>Retry loading</button></div>;
  if(loading&&empty)return <div className="op-loading" aria-busy="true" role="status">Loading current local records…</div>;
  if(empty)return <div className="op-empty" role="status"><h2>{emptyTitle}</h2><p>{emptyMessage}</p></div>;
  return null;
}
export function MutationNotice({state,reload}:{state:ReturnType<typeof useAdminMutation>;reload?:()=>void}) {const successFocus=useRef<HTMLParagraphElement>(null);useEffect(()=>{if(state.success)successFocus.current?.focus({preventScroll:true});},[state.success]);return <>{state.error && <div className="notice error" role="alert"><p>{state.error}</p>{state.conflict&&reload&&<button className="button secondary" onClick={reload} disabled={state.pending}>Reload current version</button>}</div>}{state.success&&<p ref={successFocus} tabIndex={-1} className="notice success" role="status">{state.success}</p>}</>;}
export function ReasonAction({label,description,onSubmit,pending,disabled=false,danger=false,id}:{label:string;description?:string;onSubmit:(reason:string)=>Promise<boolean|void>;pending:boolean;disabled?:boolean;danger?:boolean;id:string}) {
  const [reason,setReason]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!reason.trim()||pending||disabled)return;const done=await onSubmit(reason.trim());if(done!==false)setReason('');}
  return <form className="op-reason-form" onSubmit={submit}>{description&&<p>{description}</p>}<div className="field"><label htmlFor={`${id}-reason`}>Reason for this action</label><textarea id={`${id}-reason`} value={reason} onChange={e=>setReason(e.target.value)} required minLength={3} maxLength={1000} rows={2} disabled={pending||disabled} placeholder="Use synthetic details. Explain the decision." /></div><button className={`button ${danger?'danger':'primary'}`} disabled={pending||disabled||reason.trim().length<3} type="submit">{pending?'Saving…':label}</button></form>;
}
