'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicCommunityRecord } from '../../../../packages/domain/distribution-contracts.ts';
import { api, ApiError, messageOf } from '../Api';
import { OpportunityCard } from '../OpportunityCard';
import { EmptyPanel, LoadState, PageHeading } from './StudentCommon';
import styles from '../distribution.module.css';
import { useCampaign } from './CampaignContext';

export function ReviewedCommunityPage({ slug }: { slug: string }) {
  const { campaign, withCampaign } = useCampaign();
  const [data, setData] = useState<PublicCommunityRecord | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [missing, setMissing] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setData(null); setError(''); setMissing(false); api<{ data: PublicCommunityRecord }>(`/api/community-pages/${encodeURIComponent(slug)}`).then(result => { if (active) setData(result.data); }).catch(cause => { if (active) { setMissing(cause instanceof ApiError && cause.status === 404); setError(messageOf(cause)); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [slug, revision]);
  return <div className="page-shell student-page">{missing ? <EmptyPanel title="This community page is unavailable." text="The page may be in draft, paused or removed. Current opportunities are still available in the public catalogue." href="/opportunities" label="Explore opportunities" /> : <LoadState loading={loading} error={error} retry={() => setRevision(value => value + 1)}>{data && <><PageHeading eyebrow={`SYNTHETIC ${data.channel === 'SCHOOL_CLUB' ? 'SCHOOL CLUB' : 'COMMUNITY'}`} title={data.title} description={data.description} /><p className="notice warning">{data.disclosure}</p><section className="settings-panel"><h2>Explore your next step</h2><p>These are current published examples from the shared catalogue. Personal requirements are checked privately after you create a profile. No student list is shared with this page.</p><div className={styles.actions}><Link className="button primary" href={campaign ? withCampaign('/onboarding') : `/onboarding?campaign=${encodeURIComponent(data.id)}`}>Find your fit</Link><Link className="button secondary" href="/opportunities">Browse the catalogue</Link></div><p className="fine-print">This optional campaign code is attributed only after a separate measurement choice. Teen profiles do not enter measurement.</p></section><div className="results-heading"><h2>Current opportunities</h2><span>{data.opportunities.length} examples</span></div>{data.opportunities.length ? <div className="opportunity-grid">{data.opportunities.map(item => <OpportunityCard key={`${item.id}:${item.occurrenceId ?? 'primary'}`} opportunity={item} />)}</div> : <EmptyPanel title="No current opportunities here." text="Return when reviewed opportunities are available. This page does not connect a live feed." href="/opportunities" label="Open the catalogue" />}</>}</LoadState>}</div>;
}
