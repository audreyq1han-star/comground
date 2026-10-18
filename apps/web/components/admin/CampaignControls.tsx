'use client';
import Link from 'next/link';
import type { Campaign } from '../../../../packages/domain/measurement-contracts.ts';
import { api } from '../Api';
import { MutationNotice, ResourceState, StatusPill, useAdminMutation, useAdminResource, useVersionFocus } from './AdminShared';

export function CampaignControls() {
  const state = useAdminResource<Campaign[]>('/api/admin/campaigns');
  return <section className="op-panel" data-testid="campaign-controls">
    <div className="op-section-heading"><div><p className="eyebrow">SYNTHETIC ATTRIBUTION / ALLOWLISTED LINKS</p><h2>Synthetic campaign links</h2></div><button className="button secondary" disabled={state.loading} onClick={() => void state.reload()}>Refresh campaigns</button></div>
    <p>These local entry links carry a predefined demo campaign code. Attribution starts only after explicit measurement consent. No real partner, invitation or outreach is represented.</p>
    <ResourceState {...state} empty={!state.data} retry={() => void state.reload()}/>
    {state.data?.map(campaign => <CampaignControl key={campaign.id} campaign={campaign} reload={state.reload} loading={state.loading || !!state.error}/>)}
    <Link prefetch={false} className="text-link" href="/admin/measurement">Inspect consented cohorts and reporting suppression →</Link>
  </section>;
}

function CampaignControl({ campaign, reload, loading }: { campaign: Campaign; reload: () => Promise<void>; loading: boolean }) {
  const mutation = useAdminMutation();
  const heading = useVersionFocus(campaign.version);
  async function toggle() {
    await mutation.run(async () => {
      await api(`/api/admin/campaigns/${encodeURIComponent(campaign.id)}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: campaign.version, paused: !campaign.paused }) });
      await reload();
    }, campaign.paused ? 'Synthetic campaign resumed for new consented attribution.' : 'Synthetic campaign paused. Existing attribution and history are retained.');
  }
  return <article className="op-details" data-campaign-id={campaign.id}>
    <div className="op-section-heading"><div><h3 ref={heading} tabIndex={-1}>{campaign.name}</h3><p className="op-meta">{campaign.channel === 'SCHOOL_CLUB' ? 'School / club example' : 'Community example'} · Version {campaign.version}</p></div><StatusPill value={campaign.paused ? 'PAUSED' : 'ACTIVE'}/></div>
    <p className="op-break">Campaign code: <code>{campaign.id}</code></p>
    <p><Link className="text-link" href={campaign.path}>{campaign.paused ? 'Preview paused entry · no new attribution' : 'Open synthetic campaign entry'} →</Link></p>
    <p className="op-help">Pausing prevents new first-touch attribution to this campaign. It preserves previously consented attribution and does not pause the community page.</p>
    <MutationNotice state={mutation} reload={() => void reload()}/>
    <button className={`button ${campaign.paused ? 'primary' : 'danger'}`} disabled={loading || mutation.pending} onClick={() => void toggle()}>{mutation.pending ? 'Saving campaign…' : campaign.paused ? 'Resume synthetic campaign' : 'Pause synthetic campaign'}</button>
  </article>;
}
