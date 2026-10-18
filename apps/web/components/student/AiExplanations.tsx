'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { StudentMatches } from '../../../../packages/domain/app-contracts.ts';
import type { AiExplanationResult } from '../../../../packages/domain/ai-contracts.ts';
import { useRuntime } from '../account/RuntimeContext';
import { useStudent } from './StudentSession';
import { messageOf } from '../Api';

export function AiExplanations({ matches }: { matches: StudentMatches }) {
  const { runtime } = useRuntime(), { request, getSessionEpoch } = useStudent();
  const [data, setData] = useState<AiExplanationResult | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const active = useRef(true), busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (!runtime?.capabilities.accounts) return null;
  async function explain() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(''); const epoch = getSessionEpoch();
    try {
      const result = await request<{ data: AiExplanationResult }>('/api/student/matches/explanations', { method: 'POST', body: JSON.stringify({ expectedProfileVersion: matches.profileVersion }) });
      if (active.current && epoch === getSessionEpoch()) setData(result.data);
    } catch (cause) { if (active.current && epoch === getSessionEpoch()) setError(messageOf(cause)); }
    finally { busy.current = false; if (active.current && epoch === getSessionEpoch()) setPending(false); }
  }
  return <section className="settings-panel" aria-label="Optional AI explanations"><h2>Another way to read your matches</h2>
    <p>AI can highlight checked reasons for these choices. It cannot change eligibility, certify safety, or approve school credit. <Link href="/account/privacy">Review your separate AI privacy choice</Link>.</p>
    {runtime.capabilities.aiExplanations ? <button className="button secondary" onClick={() => void explain()} disabled={pending || !matches.data.length}>{pending ? 'Choosing explanations…' : 'Highlight reasons with AI'}</button> : <p className="fine-print">AI explanations are currently unavailable. Your rules-based shortlist remains available.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {data && <div role="status"><p>{data.mode === 'GROUNDED_AI_SELECTION' ? 'AI-selected emphasis from checked facts.' : 'Rules-based explanations are shown because AI was unavailable.'}</p>{data.items.map(item => <div key={`${item.opportunityId}:${item.occurrenceId}`}><h3>{matches.data.find(match => match.opportunity.id === item.opportunityId)?.opportunity.title}</h3><ul>{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>)}<p className="fine-print">{data.limitation}</p></div>}
  </section>;
}
