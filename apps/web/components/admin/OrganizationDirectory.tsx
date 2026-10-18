'use client';
import { useState } from 'react';
import type { OrganizationSummary } from '../../../../packages/domain/app-contracts.ts';
import { AdminPageHeading, ResourceState, useAdminResource } from './AdminShared';

export function OrganizationDirectory(){
  const state=useAdminResource<OrganizationSummary[]>('/api/admin/organizations');const [query,setQuery]=useState('');
  const visible=(state.data||[]).filter(org=>org.name.toLowerCase().includes(query.toLowerCase()));
  return <><AdminPageHeading eyebrow="SUPPLY / ORGANIZATION DIRECTORY" title="Know who is behind a listing." description="Every organization here is fictional. This directory demonstrates the record structure; none has been verified or contacted." action={<button className="button secondary" onClick={()=>void state.reload()} disabled={state.loading}>Refresh organizations</button>}/><div className="op-toolbar"><div className="field"><label htmlFor="org-search">Find an organization</label><input id="org-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Organization name"/></div></div><ResourceState {...state} empty={!state.data} retry={()=>void state.reload()}/>{state.data&&(visible.length?<div className="op-directory">{visible.map(org=><article className="op-panel" key={org.id}><span className="op-unverified">Synthetic — not verified</span><h2>{org.name}</h2><p className="op-break">{org.url}</p><dl className="op-facts"><div><dt>Local opportunity records</dt><dd>{org.opportunityCount}</dd></div><div><dt>Organization ID</dt><dd className="op-break">{org.id}</dd></div></dl><p className="op-help">Real identity, source rights and an authorized contact must be checked outside this demo before any real listing is accepted.</p></article>)}</div>:<div className="op-empty"><h2>No matching organizations.</h2><p>Clear the search or import a fixture with an organization record.</p></div>)}</>;
}
