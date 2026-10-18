'use client';
import Link from 'next/link';
import type { AggregateMetrics, MeasurementAggregate, MeasurementSummary } from '../../../../packages/domain/measurement-contracts.ts';
import { AdminPageHeading, ResourceState, Timestamp, useAdminResource } from './AdminShared';

const rate = (value: number | null) => value === null ? 'No denominator' : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value);

function Metrics({ metrics }: { metrics: AggregateMetrics }) {
  return <>
    <div className="op-metrics">
      <div className="op-metric"><strong>{rate(metrics.usefulRate)}</strong><span>Useful within 7 days · {metrics.relevantRecipients} / {metrics.recipients} recipients</span></div>
      <div className="op-metric"><strong>{rate(metrics.applicationRate)}</strong><span>Applied within 7 days · {metrics.appliedWithin7Days} / {metrics.recipients} recipients</span></div>
      <div className="op-metric"><strong>{rate(metrics.nextStep.rate)}</strong><span>Next step within 7 days · {metrics.nextStep.recipientsWithin7Days} / {metrics.recipients} recipients · self-report or synthetic introduction</span></div>
      <div className="op-metric"><strong>{rate(metrics.coverageRate)}</strong><span>Shortlist coverage · {metrics.recipients} / {metrics.seekers} seekers</span></div>
    </div>
    <dl className="op-facts">
      <div><dt>All shortlist recipients</dt><dd>{metrics.recipients} · includes nonresponders</dd></div>
      <div><dt>Seekers with no match only</dt><dd>{metrics.noMatchOnlySeekers}</dd></div>
      <div><dt>Recipients who responded within 7 days</dt><dd>{metrics.respondents}</dd></div>
      <div><dt>Recipients who did not respond</dt><dd>{metrics.recipients - metrics.respondents}</dd></div>
      <div><dt>Confirmed relevance within 7 days</dt><dd>{metrics.relevantRecipients}</dd></div>
      <div><dt>Late responders</dt><dd>{metrics.lateRespondents} · outside seven-day relevance rate</dd></div><div><dt>Late relevant responses</dt><dd>{metrics.lateRelevantRecipients} recipients · excluded from useful rate</dd></div>
      <div><dt>Reported an irrelevant option</dt><dd>{metrics.notRelevantRecipients}</dd></div>
      <div><dt>Saved an option</dt><dd>{metrics.savedRecipients} recipients</dd></div>
      <div><dt>Opened a demo destination</dt><dd>{metrics.openedRecipients} recipients · no application inferred</dd></div>
      <div><dt>Applied within seven days</dt><dd>{metrics.appliedWithin7Days} recipients · self-reported</dd></div>
      <div><dt>Applied to the exact shown dates</dt><dd>{metrics.nextStep.appliedExactWithin7Days} recipients · self-reported</dd></div>
      <div><dt>Introduced within seven days</dt><dd>{metrics.nextStep.syntheticIntroductionsWithin7Days} recipients · synthetic operator evidence, not verified</dd></div>
      <div><dt>Both next-step signals</dt><dd>{metrics.nextStep.bothWithin7Days} recipients · counted once in the union</dd></div>
      <div><dt>Applications without an exact-date link</dt><dd>{metrics.nextStep.unlinkedAppliedWithin7Days} recipients · excluded from the next-step union</dd></div>
      <div><dt>Reported attendance</dt><dd>{metrics.attendedRecipients} recipients · self-reported</dd></div>
      <div><dt>Completed observation windows</dt><dd>{metrics.completedObservationRecipients} recipients</dd></div>
      <div><dt>Partial observation windows</dt><dd>{metrics.partialObservationRecipients} recipients</dd></div>
      <div><dt>Presented batches</dt><dd>{metrics.batches} · repeated batches do not multiply recipients</dd></div>
    </dl>
    <div className="op-details"><h3>Time to first retained useful match</h3><p>Hours from recorded profile storage consent to the earliest retained, in-window relevant response. {metrics.firstUsefulMatch.sampleCount} known-baseline recipients; {metrics.firstUsefulMatch.missingBaselineRecipients} relevant recipients have no usable baseline.</p>{metrics.firstUsefulMatch.suppressed?<p>Median and p90 hidden: at least three timing observations are required.</p>:<p>Median {metrics.firstUsefulMatch.medianHours?.toFixed(1)} hours · p90 {metrics.firstUsefulMatch.p90Hours?.toFixed(1)} hours.</p>}</div>
    <div className="op-details"><h3>Historical repeat self-reports</h3><p>{metrics.repeatSelfReported.observedParticipants} current-cohort recipients have retained attendance reports in the last 90 days. {metrics.repeatSelfReported.matureParticipants} have a complete 28-day observation window after their first report; {metrics.repeatSelfReported.partialParticipants} remain partial.</p><p>{metrics.repeatSelfReported.repeatedWithin28Days} of {metrics.repeatSelfReported.matureParticipants} mature recipients reported another distinct opportunity within 28 days ({rate(metrics.repeatSelfReported.rate)}). Repeated reports for the same opportunity do not count.</p><p className="op-help">This is retained self-report history measured by report timestamps. It is not the blueprint’s organizer-confirmed repeat-participation measure, and it does not establish an expansion gate.</p></div>
    {metrics.partialObservationRecipients > 0 && <p className="notice warning">Some seven-day observation windows are still open. Useful-match and application rates are provisional and includes these recipients in its denominator.</p>}
    <p className="op-help">Views, saves and OPENED events never count as next steps. The union combines exact-date self-reported applications with currently valid synthetic introduction evidence; it is not a real confirmed-outcome rate. Legacy presentations without date snapshots cannot join. Application and attendance events remain self-reports.</p>
  </>;
}

function Aggregate({ value }: { value: MeasurementAggregate }) {
  if (value.suppressed || value.metrics === null) return <div className="op-notice" role="status"><strong>Below the reporting threshold</strong><p>{value.suppressionReason || 'This cohort is too small to display counts or rates safely.'}</p><p>Hidden values are not zeros. No rates or complementary totals are inferred.</p></div>;
  return <Metrics metrics={value.metrics}/>;
}

export function MeasurementPage() {
  const state = useAdminResource<MeasurementSummary>('/api/admin/measurement');
  const data = state.data;
  return <>
    <AdminPageHeading eyebrow="LEARNING / CONSENTED MEASUREMENT" title="Count the denominator, not just the response." description="Synthetic recipient aggregates with explicit consent, observation windows and small-cohort suppression. No student identity or preference appears here." action={<button className="button secondary" disabled={state.loading} onClick={() => void state.reload()}>Refresh measurement</button>}/>
    <ResourceState {...state} empty={!data} retry={() => void state.reload()}/>
    {data && <>
      <section className="op-panel" data-testid="measurement-live">
        <p className="eyebrow">LIVE LOCAL ACTIVITY</p><h2>Live consented activity</h2><p>{data.evidenceLabel}.</p>
        <dl className="op-facts"><div><dt>Reporting period</dt><dd>Last {data.windowDays} days of presentations, from <Timestamp value={new Date(Date.parse(data.generatedAt) - data.windowDays * 86_400_000).toISOString()}/> through <Timestamp value={data.generatedAt}/></dd></div><div><dt>Snapshot generated</dt><dd><Timestamp value={data.generatedAt}/></dd></div><div><dt>Relevance and application observation</dt><dd>{data.outcomeWindowDays} days after a recommendation presentation · APPLIED is self-reported</dd></div><div><dt>Minimum reportable cohort</dt><dd>{data.cohortThreshold} distinct opted-in profiles in every non-empty cohort</dd></div></dl>
        <Aggregate value={data.live}/>
      </section>
      <section className="op-panel" data-testid="measurement-weekly"><p className="eyebrow">WEEKLY PRESENTATION COHORT</p><h2>Weekly useful-match timing and next steps</h2><p>Rolling seven days of presentations, from <Timestamp value={data.weekly.from}/> through <Timestamp value={data.weekly.through}/>. The cohort retains no-match seekers and nonresponders. Follow-up windows may still be open. Period definition: {data.periodVersion}.</p><Aggregate value={data.weekly}/></section>
      <section className="op-panel"><h2>Live campaign cohorts</h2><p className="op-quiet">Each cohort follows the same privacy rules. First-touch attribution is consented and uses only the allowlisted synthetic campaign codes.</p><Link prefetch={false} className="text-link" href="/admin/acquisition">Inspect synthetic entry links and pause controls →</Link>{data.channels.length ? data.channels.map(channel => <div className="op-details" key={channel.campaignId}><h3>{channel.label}</h3><Aggregate value={channel}/></div>) : <p>No reportable campaign cohorts.</p>}</section>
      <section className="op-panel"><h2>Live rules-version cohorts</h2>{data.rulesVersions.length ? data.rulesVersions.map(group => <div className="op-details" key={group.rulesVersion}><h3>{group.rulesVersion}</h3><Aggregate value={group}/></div>) : <p>{data.live.suppressed ? 'Rules-version cohorts are hidden while live reporting is suppressed. This does not mean that no activity exists.' : 'No reportable rules-version cohorts.'}</p>}</section>
      <section className="op-panel"><h2>How the measures are calculated</h2><dl className="op-definition-list"><div><dt>Useful-match rate</dt><dd>{data.definitions.usefulRate}</dd></div><div><dt>Self-reported application rate</dt><dd>{data.definitions.applicationRate}</dd></div><div><dt>Seven-day next-step union</dt><dd>{data.definitions.nextStepRate}</dd></div><div><dt>Coverage and no-match seekers</dt><dd>{data.definitions.coverageRate}</dd></div><div><dt>Seven-day observation</dt><dd>{data.definitions.observation}</dd></div><div><dt>Consent and privacy</dt><dd>{data.definitions.privacy}</dd></div></dl></section>
      <section className="op-panel op-gates" data-testid="measurement-example">
        <p className="eyebrow">CALCULATION EXAMPLE / NOT LIVE ACTIVITY</p><h2>Separate synthetic calculation example</h2><p><strong>{data.calculationExample.label}</strong></p><p>{data.calculationExample.description}</p>
        <Metrics metrics={data.calculationExample.metrics}/>
        <details className="op-details"><summary>Inspect example campaign arithmetic</summary>{data.calculationExample.channels.map((channel, index) => <div key={`${index}-${channel.label}`}><h3>{channel.label} · calculation example</h3><Metrics metrics={channel.metrics}/></div>)}</details>
        <p>This separately computed example demonstrates the formulas. It is not a live cohort, a real pilot outcome or evidence that a launch target has been reached.</p>
      </section>
    </>}
  </>;
}
