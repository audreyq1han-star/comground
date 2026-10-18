import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { StudentOwnerId, StudentProfile } from '../../../packages/domain/app-contracts.ts';
import { EVIDENCE_LABEL, type EvidenceClaim } from '../../../packages/domain/evidence-contracts.ts';
import { getAccountById } from './account-repository.ts';
import { isAccountOwner, readPrivacyState } from './privacy-store.ts';
import type { AggregateMetrics, Attribution, Campaign, MeasurementConsent, MeasurementExport, MeasurementOutcome, MeasurementOutcomeKind, MeasurementSummary, RecommendationExposure, RecommendationFeedback, RecommendationRef, RecommendationVerdict } from '../../../packages/domain/measurement-contracts.ts';
import { RepositoryError } from './errors.ts';
import { createCommunityStore } from './community-repository.ts';
import { objectInput } from './http.ts';
import { RANKING_POLICY_VERSION } from '../../../packages/domain/rules.ts';

export const MEASUREMENT_RULES_VERSION = RANKING_POLICY_VERSION;
const DAY = 86400000;
const CAMPAIGNS: readonly Campaign[] = [
  { id: 'demo-school-club', name: 'Synthetic school club campaign', channel: 'SCHOOL_CLUB', paused: false, version: 1, path: '/communities/demo-neighborhood?campaign=demo-school-club', isSynthetic: true },
  { id: 'demo-community', name: 'Synthetic community campaign', channel: 'COMMUNITY', paused: false, version: 1, path: '/communities/demo-neighborhood?campaign=demo-community', isSynthetic: true },
];
const fail = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
const initialConsent = (profileVersion: number | null): MeasurementConsent => ({ enabled: false, version: 0, profileVersion, consentedAt: null, retentionDays: 90 });
type ConsentRow = { enabled: number; version: number; consented_at: string | null };
type ExposureRow = { id: string; owner: string; request_id: string; presented_at: string; profile_version: number; profile_started_at?: string | null; rules_version: string; items_json: string; campaign_id: string | null; campaign_snapshot_json?: string | null };
type FeedbackRow = { exposure_id: string; opportunity_id: string; occurrence_id: string; verdict: RecommendationVerdict; at: string };
type OutcomeRow = { exposure_id: string; opportunity_id: string; occurrence_id: string; kind: MeasurementOutcomeKind; at: string };
export type PresentationReceipt = { owner: StudentOwnerId; requestId: string; issuedAt: string; consentVersion: number; profileVersion: number; rulesVersion: string; items: RecommendationRef[] };
export type OutcomeInput = Pick<RecommendationRef, 'opportunityId' | 'occurrenceId' | 'startsAt' | 'endsAt'> & { kind: MeasurementOutcomeKind; eventKey: string };
export type SyntheticIntroduction = { opportunityId: string; occurrenceId: string; startsAt: string; endsAt: string; recordedAt: string };
export type AggregateInput = { owner: string; exposure: RecommendationExposure; feedback: RecommendationFeedback[]; outcomes: MeasurementOutcome[]; introductions?: SyntheticIntroduction[]; attendanceHistory?: MeasurementOutcome[]; usefulHistory?: {at:string;presentedAt:string;observationEndsAt:string;profileStartedAt:string|null}[] };

function sameInstant(left: string | undefined, right: string | undefined): boolean { return !!left && !!right && Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right); }
function datedRef(ref: RecommendationRef): boolean { return !!ref.startsAt && !!ref.endsAt && Number.isFinite(Date.parse(ref.startsAt)) && Date.parse(ref.endsAt) > Date.parse(ref.startsAt); }
function inPresentationWindow(row: AggregateInput, at: string, now: Date): boolean { return Date.parse(at) >= Date.parse(row.exposure.presentedAt) && Date.parse(at) <= Date.parse(row.exposure.observationEndsAt) && Date.parse(at) <= now.getTime(); }
function nextStepSets(rows: AggregateInput[], now: Date) {
  const owners = (matches: (row: AggregateInput) => boolean) => new Set(rows.filter(matches).map(row => row.owner));
  const recipients = owners(row => row.exposure.items.length > 0);
  const applied = owners(row => row.outcomes.some(outcome => outcome.kind === 'APPLIED' && inPresentationWindow(row,outcome.at,now) && row.exposure.items.some(ref => ref.opportunityId === outcome.opportunityId && ref.occurrenceId === outcome.occurrenceId)));
  const exactApplied = owners(row => row.outcomes.some(outcome => outcome.kind === 'APPLIED' && inPresentationWindow(row,outcome.at,now) && row.exposure.items.some(ref => datedRef(ref) && ref.opportunityId === outcome.opportunityId && ref.occurrenceId === outcome.occurrenceId)));
  const introductions = owners(row => (row.introductions ?? []).some(introduction => inPresentationWindow(row,introduction.recordedAt,now) && row.exposure.items.some(ref => datedRef(ref) && ref.opportunityId === introduction.opportunityId && ref.occurrenceId === introduction.occurrenceId && sameInstant(ref.startsAt,introduction.startsAt) && sameInstant(ref.endsAt,introduction.endsAt))));
  const union = new Set([...exactApplied,...introductions]), both = new Set([...exactApplied].filter(owner => introductions.has(owner))), unlinked = new Set([...applied].filter(owner => !exactApplied.has(owner)));
  return { recipients, applied, exactApplied, introductions, union, both, unlinked };
}
function checkVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail('INVALID_INPUT', 422, 'Provide the current version as a whole number.');
  return value;
}
function exposureDto(row: ExposureRow): RecommendationExposure {
  return { id: row.id, requestId: row.request_id, presentedAt: row.presented_at, profileVersion: row.profile_version, profileStartedAt: row.profile_started_at ?? null, rulesVersion: row.rules_version, items: JSON.parse(row.items_json), campaignId: row.campaign_id, campaignSnapshot: row.campaign_snapshot_json ? JSON.parse(row.campaign_snapshot_json) as Campaign : null, observationEndsAt: new Date(Date.parse(row.presented_at) + 7 * DAY).toISOString() };
}
function feedbackDto(row: FeedbackRow): RecommendationFeedback { return { exposureId: row.exposure_id, opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, verdict: row.verdict, at: row.at }; }
function outcomeDto(row: OutcomeRow): MeasurementOutcome { return { exposureId: row.exposure_id, opportunityId: row.opportunity_id, occurrenceId: row.occurrence_id, kind: row.kind, at: row.at, evidenceKind: row.kind === 'APPLIED' || row.kind === 'ATTENDED' ? 'SELF_REPORTED' : row.kind === 'NOT_RELEVANT' ? 'PRIVATE_FIT_FEEDBACK' : 'LOCAL_ACTION' }; }

/** No schema setup or transaction: account export can include this on its own connection. */
export function exportMeasurementData(db: DatabaseSync, owner: StudentOwnerId, now = new Date()): MeasurementExport {
  const profile = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined;
  const profileVersion = profile ? (JSON.parse(profile.profile_json) as { version: number }).version : null;
  const cutoff = new Date(now.getTime() - 90 * DAY).toISOString();
  db.prepare('DELETE FROM measurement_exposures WHERE owner=? AND presented_at<?').run(owner, cutoff);
  db.prepare('DELETE FROM measurement_attribution WHERE owner=? AND attributed_at<?').run(owner, cutoff);
  const consent = db.prepare('SELECT enabled,version,consented_at FROM measurement_consent WHERE owner=?').get(owner) as ConsentRow | undefined;
  const attributed = db.prepare('SELECT * FROM measurement_attribution WHERE owner=?').get(owner) as { campaign_id: string; attributed_at: string; campaign_snapshot_json?: string | null } | undefined;
  const campaign = attributed?.campaign_snapshot_json ? JSON.parse(attributed.campaign_snapshot_json) as Campaign : attributed ? CAMPAIGNS.find(item => item.id === attributed.campaign_id) : undefined;
  return {
    consent: consent ? { enabled: !!consent.enabled, version: consent.version, profileVersion, consentedAt: consent.consented_at, retentionDays: 90 } : initialConsent(profileVersion),
    attribution: campaign && attributed ? { campaignId: campaign.id, channel: campaign.channel, attributedAt: attributed.attributed_at, campaignSnapshot: campaign } : null,
    exposures: (db.prepare('SELECT * FROM measurement_exposures WHERE owner=? ORDER BY presented_at,id').all(owner) as ExposureRow[]).map(exposureDto),
    feedback: (db.prepare('SELECT f.* FROM measurement_feedback f JOIN measurement_exposures e ON e.id=f.exposure_id WHERE e.owner=? ORDER BY f.at,f.exposure_id,f.opportunity_id,f.occurrence_id').all(owner) as FeedbackRow[]).map(feedbackDto),
    outcomes: (db.prepare('SELECT o.* FROM measurement_outcomes o JOIN measurement_exposures e ON e.id=o.exposure_id WHERE e.owner=? ORDER BY o.at,o.exposure_id,o.kind').all(owner) as OutcomeRow[]).map(outcomeDto),
  };
}

/** Pure aggregate calculation: example data and tests never enter the live database. */
export function calculateMeasurement(rows: AggregateInput[], now: Date): AggregateMetrics {
  const owners = (filter: (row: AggregateInput) => boolean) => new Set(rows.filter(filter).map(row => row.owner));
  const seekers = owners(() => true), recipients = owners(row => row.exposure.items.length > 0);
  const inWindow = (row: AggregateInput, at: string) => Date.parse(at) >= Date.parse(row.exposure.presentedAt) && Date.parse(at) <= Date.parse(row.exposure.observationEndsAt) && Date.parse(at) <= now.getTime();
  const late = (row: AggregateInput, at: string) => Date.parse(at) > Date.parse(row.exposure.observationEndsAt) && Date.parse(at) <= now.getTime();
  const relevant = owners(row => row.feedback.some(item => item.verdict === 'RELEVANT' && inWindow(row, item.at)));
  const negative = owners(row => row.feedback.some(item => item.verdict === 'NOT_RELEVANT' && inWindow(row, item.at)) || row.outcomes.some(item => item.kind === 'NOT_RELEVANT' && inWindow(row, item.at)));
  const respondents = owners(row => row.feedback.some(item => inWindow(row, item.at)) || row.outcomes.some(item => item.kind === 'NOT_RELEVANT' && inWindow(row, item.at)));
  const lateRespondents = owners(row => row.feedback.some(item => late(row, item.at)) || row.outcomes.some(item => item.kind === 'NOT_RELEVANT' && late(row, item.at)));
  const lateRelevant = owners(row => row.feedback.some(item => item.verdict === 'RELEVANT' && late(row, item.at)));
  const completed = owners(row => row.exposure.items.length > 0 && Date.parse(row.exposure.observationEndsAt) <= now.getTime());
  const applied = owners(row => row.outcomes.some(item => item.kind === 'APPLIED' && inWindow(row, item.at)));
  const nextStep = nextStepSets(rows, now);
  // A retained profile-consent baseline is recorded with the presentation; legacy rows stay unknown.
  const first = new Map<string, { at: number; baseline: number }>();
  for (const row of rows) {
    if (!relevant.has(row.owner)) continue;
    const history = row.usefulHistory ?? row.feedback.filter(item=>item.verdict==='RELEVANT').map(item=>({at:item.at,presentedAt:row.exposure.presentedAt,observationEndsAt:row.exposure.observationEndsAt,profileStartedAt:row.exposure.profileStartedAt??null}));
    for (const feedback of history) {
      const at=Date.parse(feedback.at),baseline=Date.parse(feedback.profileStartedAt??'');
      if(at<Date.parse(feedback.presentedAt)||at>Date.parse(feedback.observationEndsAt)||at>now.getTime())continue;
      if(!first.has(row.owner)||at<first.get(row.owner)!.at)first.set(row.owner,{at,baseline});
    }
  }
  const hours = [...first.values()].filter(item => Number.isFinite(item.baseline) && item.baseline <= item.at).map(item => (item.at - item.baseline) / 3600000).sort((a,b) => a-b);
  const timingSuppressed = hours.length < 3;
  const median = hours.length % 2 ? hours[Math.floor(hours.length/2)] : (hours[hours.length/2-1]+hours[hours.length/2])/2;
  // Historical observations are measured from report timestamps, not verified attendance dates.
  const attendance = new Map<string, Map<string, number>>();
  for (const row of rows) for (const item of row.attendanceHistory ?? row.outcomes) {
    const at = Date.parse(item.at);
    if (item.kind !== 'ATTENDED' || item.evidenceKind !== 'SELF_REPORTED' || at > now.getTime() || at < now.getTime()-90*DAY) continue;
    const entries = attendance.get(row.owner) ?? new Map<string,number>();
    entries.set(item.opportunityId, Math.min(at, entries.get(item.opportunityId) ?? at)); attendance.set(row.owner, entries);
  }
  let mature = 0, repeated = 0;
  for (const entries of attendance.values()) {
    const dates = [...entries.values()].sort((a,b)=>a-b), end = dates[0] + 28*DAY;
    if (end <= now.getTime()) { mature += 1; if (dates.length > 1 && dates[1] <= end) repeated += 1; }
  }
  const denominator = recipients.size;
  return {
    seekers: seekers.size, recipients: denominator, noMatchOnlySeekers: [...seekers].filter(owner => !recipients.has(owner)).length, batches: rows.length,
    respondents: respondents.size, relevantRecipients: relevant.size, notRelevantRecipients: negative.size, lateRespondents: lateRespondents.size, lateRelevantRecipients: lateRelevant.size,
    savedRecipients: owners(row => row.outcomes.some(item => item.kind === 'SAVED')).size,
    openedRecipients: owners(row => row.outcomes.some(item => item.kind === 'OPENED')).size,
    appliedWithin7Days: applied.size, attendedRecipients: owners(row => row.outcomes.some(item => item.kind === 'ATTENDED')).size,
    nextStep: { appliedExactWithin7Days: nextStep.exactApplied.size, syntheticIntroductionsWithin7Days: nextStep.introductions.size, bothWithin7Days: nextStep.both.size, recipientsWithin7Days: nextStep.union.size, unlinkedAppliedWithin7Days: nextStep.unlinked.size, rate: denominator ? nextStep.union.size / denominator : null, evidenceKind: 'SELF_REPORT_OR_SYNTHETIC_NOT_VERIFIED' },
    completedObservationRecipients: completed.size, partialObservationRecipients: [...recipients].filter(owner => !completed.has(owner)).length,
    firstUsefulMatch: { sampleCount: hours.length, missingBaselineRecipients: first.size-hours.length, medianHours: timingSuppressed ? null : median, p90Hours: timingSuppressed ? null : hours[Math.ceil(hours.length*.9)-1], suppressed: timingSuppressed },
    repeatSelfReported: { evidenceKind: 'SELF_REPORTED', historyDays: 90, observationDays: 28, observedParticipants: attendance.size, matureParticipants: mature, partialParticipants: attendance.size-mature, repeatedWithin28Days: repeated, rate: mature ? repeated/mature : null },
    usefulRate: denominator ? relevant.size / denominator : null, applicationRate: denominator ? applied.size / denominator : null, coverageRate: seekers.size ? denominator / seekers.size : null,
  };
}

export function calculationExample(now: Date): MeasurementSummary['calculationExample'] {
  const rows: AggregateInput[] = Array.from({ length: 8 }, (_, i) => {
    const presentedAt = new Date(now.getTime() - (i < 4 ? 10 : 2) * DAY).toISOString();
    const item = { opportunityId: `example-opportunity-${i}`, occurrenceId: 'primary', version: 1 };
    const exposure: RecommendationExposure = { id: `example-batch-${i}`, requestId: `example-request-${i}`, presentedAt, profileVersion: 1, rulesVersion: MEASUREMENT_RULES_VERSION, items: i < 6 ? [item] : [], campaignId: i % 2 ? 'demo-community' : 'demo-school-club', observationEndsAt: new Date(Date.parse(presentedAt) + 7 * DAY).toISOString() };
    return { owner: `calculation-only-person-${i}`, exposure, feedback: i < 3 ? [{ ...item, exposureId: exposure.id, verdict: 'RELEVANT', at: presentedAt }] : i === 3 ? [{ ...item, exposureId: exposure.id, verdict: 'NOT_RELEVANT', at: presentedAt }] : [], outcomes: i < 2 ? [{ ...item, exposureId: exposure.id, kind: 'APPLIED', at: new Date(Date.parse(presentedAt) + DAY).toISOString(), evidenceKind: 'SELF_REPORTED' }] : [] };
  });
  return { label: 'Separate synthetic calculation example — not live activity', description: 'Eight fictional seekers, six shortlist recipients, three relevant responses and two self-reported applications within seven days. Two recipients did not respond; two seekers had no matches. Four recipient windows are complete and two remain partial. These records are calculated in memory and never seeded into live measurement.', metrics: calculateMeasurement(rows, now), channels: CAMPAIGNS.map(campaign => ({ label: campaign.name, metrics: calculateMeasurement(rows.filter(row => row.exposure.campaignId === campaign.id), now) })) };
}

/** Shares the student's SQLite connection. Outcome hooks never open nested transactions. */
export function createMeasurementStore(db: DatabaseSync, options: { seedExamples?: boolean; allowOwner?: (owner: StudentOwnerId) => boolean } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS measurement_consent (owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), version INTEGER NOT NULL, consented_at TEXT);
    CREATE TABLE IF NOT EXISTS measurement_campaigns (id TEXT PRIMARY KEY, paused INTEGER NOT NULL CHECK(paused IN (0,1)), version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS measurement_attribution (owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE, campaign_id TEXT NOT NULL REFERENCES measurement_campaigns(id), attributed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS measurement_exposures (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES student_profiles(persona_id) ON DELETE CASCADE, request_id TEXT NOT NULL, presented_at TEXT NOT NULL, profile_version INTEGER NOT NULL, rules_version TEXT NOT NULL, items_json TEXT NOT NULL, campaign_id TEXT REFERENCES measurement_campaigns(id), UNIQUE(owner, request_id));
    CREATE TABLE IF NOT EXISTS measurement_feedback (exposure_id TEXT NOT NULL REFERENCES measurement_exposures(id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN ('RELEVANT','NOT_RELEVANT')), at TEXT NOT NULL, PRIMARY KEY(exposure_id,opportunity_id,occurrence_id));
    CREATE TABLE IF NOT EXISTS measurement_outcomes (exposure_id TEXT NOT NULL REFERENCES measurement_exposures(id) ON DELETE CASCADE, opportunity_id TEXT NOT NULL, occurrence_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('SAVED','OPENED','APPLIED','ATTENDED','NOT_RELEVANT')), event_key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(exposure_id,opportunity_id,occurrence_id,kind), UNIQUE(event_key));
    CREATE INDEX IF NOT EXISTS measurement_exposure_owner ON measurement_exposures(owner,presented_at);
  `);
  if (!(db.prepare('PRAGMA table_info(measurement_exposures)').all() as {name:string}[]).some(column=>column.name==='profile_started_at')) db.exec('ALTER TABLE measurement_exposures ADD COLUMN profile_started_at TEXT');
  const community = createCommunityStore(db, { seedExamples: options.seedExamples !== false });
  for (const table of ['measurement_attribution', 'measurement_exposures']) if (!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(column => column.name === 'campaign_snapshot_json')) db.exec(`ALTER TABLE ${table} ADD COLUMN campaign_snapshot_json TEXT`);
  const campaignColumns = new Set((db.prepare('PRAGMA table_info(measurement_campaigns)').all() as {name:string}[]).map(column => column.name));
  for (const name of ['name','channel','path']) if (!campaignColumns.has(name)) db.exec(`ALTER TABLE measurement_campaigns ADD COLUMN ${name} TEXT`);
  function syncCampaigns(): Campaign[] {
    db.exec('SAVEPOINT measurement_campaign_sync');
    try {
      db.prepare('UPDATE measurement_campaigns SET paused=1 WHERE paused<>1').run();
      const current = community.campaigns();
      for (const item of current) db.prepare('INSERT INTO measurement_campaigns(id,paused,version,name,channel,path) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET paused=excluded.paused,version=excluded.version,name=excluded.name,channel=excluded.channel,path=excluded.path').run(item.id, Number(item.paused), item.version, item.name, item.channel, item.path);
      db.exec('RELEASE measurement_campaign_sync'); return current;
    } catch (error) { db.exec('ROLLBACK TO measurement_campaign_sync; RELEASE measurement_campaign_sync'); throw error; }
  }
  syncCampaigns();
  // Historical rows predate snapshots. Only the two known legacy IDs can be backfilled.
  for (const item of CAMPAIGNS) {
    const snapshot = JSON.stringify(item);
    for (const table of ['measurement_attribution','measurement_exposures']) db.prepare(`UPDATE ${table} SET campaign_snapshot_json=? WHERE campaign_id=? AND campaign_snapshot_json IS NULL`).run(snapshot, item.id);
  }
  // Cohort admission changes cannot preserve an old opt-in for later reactivation.
  if (options.allowOwner) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of db.prepare('SELECT owner FROM measurement_consent WHERE enabled=1').all() as {owner:StudentOwnerId}[]) if (!options.allowOwner(row.owner)) {
        db.prepare('DELETE FROM measurement_exposures WHERE owner=?').run(row.owner);
        db.prepare('DELETE FROM measurement_attribution WHERE owner=?').run(row.owner);
        db.prepare('UPDATE measurement_consent SET enabled=0,consented_at=NULL,version=version+1 WHERE owner=?').run(row.owner);
      }
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  function transaction<T>(action: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = action(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  const tableExists = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  function currentMeasurementOwner(owner: StudentOwnerId): boolean {
    if (options.allowOwner?.(owner) === false) return false;
    const stored = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as {profile_json:string} | undefined;
    if (!stored) return false;
    const profile = JSON.parse(stored.profile_json) as StudentProfile;
    if (!isAccountOwner(owner)) return (owner === 'demo-alex' || owner === 'demo-sam') && readPrivacyState(db,owner,profile).storage;
    const account = tableExists('accounts') ? getAccountById(db,owner) : null;
    return !!account && account.role === 'STUDENT' && account.emailVerified && account.adultConfirmed && account.ageBand === 'ADULT' && account.admission === 'ADMITTED' && profile.preferences?.schoolStage === 'HIGH_SCHOOL' && tableExists('student_privacy') && readPrivacyState(db,owner,profile).storage;
  }
  function snapshotRefs(items: RecommendationRef[]): RecommendationRef[] {
    return items.map(item => {
      // Never trust optional caller dates or substitute today's publication for the shown version.
      const ref = { opportunityId:item.opportunityId, occurrenceId:item.occurrenceId, version:item.version };
      const row = tableExists('published_occurrence_snapshots') ? db.prepare('SELECT snapshot_json FROM published_occurrence_snapshots WHERE opportunity_id=? AND occurrence_id=? AND version=?').get(ref.opportunityId,ref.occurrenceId,ref.version) as {snapshot_json:string}|undefined : undefined;
      if (!row) return ref;
      const snapshot = JSON.parse(row.snapshot_json) as {id?:string;occurrenceId?:string;version?:number;startsAt?:string;endsAt?:string};
      const dates = { ...ref, startsAt:snapshot.startsAt, endsAt:snapshot.endsAt };
      return snapshot.id === ref.opportunityId && snapshot.occurrenceId === ref.occurrenceId && snapshot.version === ref.version && datedRef(dates) ? dates : ref;
    });
  }
  function requireProfile(owner: StudentOwnerId): void { if (!db.prepare('SELECT 1 FROM student_profiles WHERE persona_id = ?').get(owner)) fail('CONSENT_REQUIRED', 403, 'Complete your profile before choosing optional measurement.'); }
  function profileVersion(owner: StudentOwnerId): number | null { const row = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(owner) as { profile_json: string } | undefined; return row ? (JSON.parse(row.profile_json) as { version: number }).version : null; }
  function consent(owner: StudentOwnerId): MeasurementConsent {
    const row = db.prepare('SELECT enabled,version,consented_at FROM measurement_consent WHERE owner = ?').get(owner) as ConsentRow | undefined;
    return row ? { enabled: !!row.enabled && options.allowOwner?.(owner) !== false, version: row.version, profileVersion: profileVersion(owner), consentedAt: row.consented_at, retentionDays: 90 } : initialConsent(profileVersion(owner));
  }
  function requireEnabled(owner: StudentOwnerId): MeasurementConsent { requireProfile(owner); if (options.allowOwner?.(owner) === false) fail('MEASUREMENT_NOT_ADMITTED',403,'Optional measurement is unavailable for this account cohort.'); const state = consent(owner); if (!state.enabled) fail('MEASUREMENT_DISABLED', 403, 'Optional local measurement is off. Enable it explicitly before recording a shortlist or campaign.'); return state; }
  function purge(owner: StudentOwnerId): void {
    db.prepare('DELETE FROM measurement_exposures WHERE owner = ?').run(owner);
    db.prepare('DELETE FROM measurement_attribution WHERE owner = ?').run(owner);
  }
  function prune(now: Date): void {
    const cutoff = new Date(now.getTime() - 90 * DAY).toISOString();
    db.prepare('DELETE FROM measurement_exposures WHERE presented_at < ?').run(cutoff);
    db.prepare('DELETE FROM measurement_attribution WHERE attributed_at < ?').run(cutoff);
  }
  function setConsent(owner: StudentOwnerId, input: unknown, now = new Date()): MeasurementConsent {
    const value = objectInput(input, ['expectedVersion', 'expectedProfileVersion', 'enabled']), expectedVersion = checkVersion(value.expectedVersion), expectedProfileVersion = checkVersion(value.expectedProfileVersion);
    if (value.enabled === true && options.allowOwner?.(owner) === false) fail('MEASUREMENT_NOT_ADMITTED',403,'Optional measurement is unavailable for this account cohort.');
    if (typeof value.enabled !== 'boolean') fail('INVALID_INPUT', 422, 'Choose whether optional local measurement is enabled.');
    return transaction(() => {
      requireProfile(owner); const current = consent(owner);
      if (current.profileVersion !== expectedProfileVersion) return fail('VERSION_CONFLICT', 409, 'This profile changed. Reload measurement settings before saving.');
      if (current.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'Measurement settings changed. Reload before saving.');
      if (current.enabled === value.enabled) { if (!value.enabled) purge(owner); return current; }
      const at = value.enabled ? now.toISOString() : null;
      db.prepare('INSERT INTO measurement_consent(owner,enabled,version,consented_at) VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,version=excluded.version,consented_at=excluded.consented_at').run(owner, value.enabled ? 1 : 0, current.version + 1, at);
      if (!value.enabled) purge(owner);
      return consent(owner);
    });
  }
  function campaigns(activeOnly = false): Campaign[] { return syncCampaigns().filter(item => !activeOnly || !item.paused); }
  function updateCampaign(id: string, input: unknown, actor = 'demo-reviewer'): Campaign {
    const value = objectInput(input, ['expectedVersion', 'paused']), expectedVersion = checkVersion(value.expectedVersion);
    if (typeof value.paused !== 'boolean') return fail('INVALID_INPUT', 422, 'Set the campaign pause state.');
    return transaction(() => {
      const current = campaigns().find(item => item.id === id) ?? fail('NOT_FOUND', 404, 'Choose a reviewed synthetic campaign.');
      if (current.version !== expectedVersion) return fail('VERSION_CONFLICT', 409, 'This campaign changed. Reload before saving.');
      const record = community.get(id);
      if (record.state === 'ARCHIVED') return fail('STATE_CONFLICT', 409, 'Archived campaign history cannot be reactivated.');
      if (current.paused !== value.paused) {
        if (value.paused) community.update(id, { action: 'PAUSE', expectedVersion }, actor);
        else community.update(id, { action: 'APPROVE', expectedVersion }, actor);
      }
      return campaigns().find(item => item.id === id)!;
    });
  }
  function attribution(owner: StudentOwnerId, now = new Date()): Attribution | null {
    prune(now);
    const row = db.prepare('SELECT * FROM measurement_attribution WHERE owner=?').get(owner) as { campaign_id: string; attributed_at: string; campaign_snapshot_json: string | null } | undefined;
    if (!row) return null;
    const campaign = row.campaign_snapshot_json ? JSON.parse(row.campaign_snapshot_json) as Campaign : null;
    if (!campaign) return null;
    return { campaignId: campaign.id, channel: campaign.channel, attributedAt: row.attributed_at, campaignSnapshot: campaign };
  }
  function attribute(owner: StudentOwnerId, input: unknown, now = new Date()): Attribution {
    const value = objectInput(input, ['campaignId']);
    return transaction(() => {
      requireEnabled(owner);
      const selected = campaigns().find(item => item.id === value.campaignId) ?? fail('INVALID_CAMPAIGN', 422, 'Choose an allowlisted synthetic campaign.');
      const existing = attribution(owner, now);
      if (existing) return existing;
      if (selected.paused) return fail('CAMPAIGN_PAUSED', 409, 'This synthetic campaign is paused. No new attribution was stored.');
      db.prepare('INSERT INTO measurement_attribution(owner,campaign_id,attributed_at,campaign_snapshot_json) VALUES (?,?,?,?)').run(owner, selected.id, now.toISOString(), JSON.stringify(selected));
      return attribution(owner, now)!;
    });
  }
  function exposures(owner: StudentOwnerId): RecommendationExposure[] { return (db.prepare('SELECT * FROM measurement_exposures WHERE owner=? ORDER BY presented_at,id').all(owner) as ExposureRow[]).map(exposureDto); }
  function getExposure(owner: StudentOwnerId, id: string): RecommendationExposure {
    const row = db.prepare('SELECT * FROM measurement_exposures WHERE owner=? AND id=?').get(owner, id) as ExposureRow | undefined;
    return row ? exposureDto(row) : fail('NOT_FOUND', 404, 'That shown shortlist is not available in this profile.');
  }
  function recordExposure(receipt: PresentationReceipt, now = new Date()): RecommendationExposure {
    return transaction(() => {
      const state = requireEnabled(receipt.owner);
      if (state.version !== receipt.consentVersion) return fail('STALE_PRESENTATION', 409, 'Measurement consent changed. Generate a new shortlist.');
      if (state.profileVersion !== receipt.profileVersion) return fail('STALE_PRESENTATION', 409, 'This profile changed. Generate a new shortlist.');
      prune(now);
      const existing = (db.prepare('SELECT * FROM measurement_exposures WHERE owner=? AND request_id=?').get(receipt.owner, receipt.requestId) as ExposureRow | undefined);
      if (existing) {
        const identity = (items: RecommendationRef[]) => JSON.stringify(items.map(({opportunityId,occurrenceId,version}) => ({opportunityId,occurrenceId,version})));
        if (existing.profile_version !== receipt.profileVersion || existing.rules_version !== receipt.rulesVersion || identity(JSON.parse(existing.items_json)) !== identity(receipt.items)) return fail('REQUEST_CONFLICT', 409, 'This presentation request was already used for a different shortlist. Generate a new shortlist.');
        return exposureDto(existing);
      }
      // Bound each synthetic profile to 250 batches; dependent outcomes/feedback cascade.
      db.prepare('DELETE FROM measurement_exposures WHERE owner=? AND id IN (SELECT id FROM measurement_exposures WHERE owner=? ORDER BY presented_at DESC,id DESC LIMIT -1 OFFSET 249)').run(receipt.owner, receipt.owner);
      const firstTouch = attribution(receipt.owner, now);
      const id = randomUUID();
      const profile = db.prepare('SELECT profile_json FROM student_profiles WHERE persona_id=?').get(receipt.owner) as {profile_json:string};
      const started = (JSON.parse(profile.profile_json) as {consentedAt?:string}).consentedAt;
      const profileStartedAt = started && Number.isFinite(Date.parse(started)) && Date.parse(started) <= now.getTime() ? started : null;
      const attributed = db.prepare('SELECT campaign_snapshot_json FROM measurement_attribution WHERE owner=?').get(receipt.owner) as { campaign_snapshot_json: string | null } | undefined;
      db.prepare('INSERT INTO measurement_exposures(id,owner,request_id,presented_at,profile_version,rules_version,items_json,campaign_id,profile_started_at,campaign_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, receipt.owner, receipt.requestId, now.toISOString(), receipt.profileVersion, receipt.rulesVersion, JSON.stringify(snapshotRefs(receipt.items)), firstTouch?.campaignId ?? null, profileStartedAt, attributed?.campaign_snapshot_json ?? null);
      return getExposure(receipt.owner, id);
    });
  }
  function feedback(owner: StudentOwnerId, input: unknown, now = new Date()): RecommendationFeedback {
    const value = objectInput(input, ['exposureId', 'opportunityId', 'occurrenceId', 'verdict']);
    if (typeof value.exposureId !== 'string' || typeof value.opportunityId !== 'string' || typeof value.occurrenceId !== 'string' || (value.verdict !== 'RELEVANT' && value.verdict !== 'NOT_RELEVANT')) return fail('INVALID_INPUT', 422, 'Choose a shown occurrence and relevant or not relevant.');
    return transaction(() => {
      requireEnabled(owner); prune(now);
      const batch = getExposure(owner, value.exposureId as string);
      if (!batch.items.some(item => item.opportunityId === value.opportunityId && item.occurrenceId === value.occurrenceId)) return fail('NOT_PRESENTED', 422, 'Feedback must refer to an occurrence in this shown shortlist.');
      const existing = db.prepare('SELECT * FROM measurement_feedback WHERE exposure_id=? AND opportunity_id=? AND occurrence_id=?').get(batch.id, value.opportunityId as string, value.occurrenceId as string) as FeedbackRow | undefined;
      if (existing) {
        if (existing.verdict !== value.verdict) return fail('FEEDBACK_CONFLICT', 409, 'This shown occurrence already has a recorded response.');
        return feedbackDto(existing);
      }
      db.prepare('INSERT INTO measurement_feedback(exposure_id,opportunity_id,occurrence_id,verdict,at) VALUES (?,?,?,?,?)').run(batch.id, value.opportunityId as string, value.occurrenceId as string, value.verdict as string, now.toISOString());
      return { exposureId: batch.id, opportunityId: value.opportunityId as string, occurrenceId: value.occurrenceId as string, verdict: value.verdict as RecommendationVerdict, at: now.toISOString() };
    });
  }
  function recordOutcome(owner: StudentOwnerId, input: OutcomeInput, now = new Date()): void {
    if (!consent(owner).enabled) return;
    const occurrenceId = input.occurrenceId || 'primary';
    const candidates = exposures(owner).filter(item => Date.parse(item.presentedAt) <= now.getTime() && now.getTime() - Date.parse(item.presentedAt) <= 90 * DAY && item.items.some(ref => ref.opportunityId === input.opportunityId && ref.occurrenceId === occurrenceId && (!datedRef(ref) || !['APPLIED','ATTENDED'].includes(input.kind) || (sameInstant(ref.startsAt,input.startsAt) && sameInstant(ref.endsAt,input.endsAt)))));
    const batch = candidates.at(-1);
    if (!batch) return;
    db.prepare('INSERT OR IGNORE INTO measurement_outcomes(exposure_id,opportunity_id,occurrence_id,kind,event_key,at) VALUES (?,?,?,?,?,?)').run(batch.id, input.opportunityId, occurrenceId, input.kind, `${owner}:${input.kind}:${input.eventKey}`, now.toISOString());
  }
  function exportData(owner: StudentOwnerId, now = new Date()): MeasurementExport {
    return exportMeasurementData(db, owner, now);
  }
  function summary(now = new Date()): MeasurementSummary {
    prune(now);
    const rows = (db.prepare('SELECT e.* FROM measurement_exposures e JOIN measurement_consent c ON c.owner=e.owner WHERE c.enabled=1 AND c.consented_at IS NOT NULL AND e.presented_at>=c.consented_at AND e.presented_at>=? AND e.presented_at<=? ORDER BY e.presented_at,e.id').all(new Date(now.getTime() - 30 * DAY).toISOString(), now.toISOString()) as ExposureRow[]).filter(row => currentMeasurementOwner(row.owner as StudentOwnerId));
    const introductions = new Map<string,SyntheticIntroduction[]>();
    for (const owner of new Set(rows.map(row => row.owner))) {
      const consentedAt = Date.parse(consent(owner as StudentOwnerId).consentedAt ?? '');
      const claims = tableExists('student_evidence_claims') ? (db.prepare('SELECT record_json FROM student_evidence_claims WHERE owner=?').all(owner) as {record_json:string}[]).map(row => JSON.parse(row.record_json) as EvidenceClaim) : [];
      introductions.set(owner, claims.filter(claim => claim.kind === 'INTRODUCTION' && claim.status === 'RECORDED' && claim.evidenceLabel === EVIDENCE_LABEL && !!claim.evidence && Number.isFinite(consentedAt) && Date.parse(claim.createdAt) >= consentedAt && Date.parse(claim.evidence.validFrom) >= Math.max(consentedAt,Date.parse(claim.createdAt)) && Date.parse(claim.evidence.validFrom) <= now.getTime() && Date.parse(claim.evidence.validUntil) > now.getTime() && Number.isFinite(Date.parse(claim.startsAt)) && Date.parse(claim.endsAt) > Date.parse(claim.startsAt)).map(claim => ({opportunityId:claim.opportunityId,occurrenceId:claim.occurrenceId,startsAt:claim.startsAt,endsAt:claim.endsAt,recordedAt:claim.evidence!.validFrom})));
    }
    const inputs: AggregateInput[] = rows.map(row => ({ owner: row.owner, exposure: exposureDto(row), introductions:introductions.get(row.owner) ?? [], feedback: (db.prepare('SELECT * FROM measurement_feedback WHERE exposure_id=?').all(row.id) as FeedbackRow[]).map(feedbackDto), outcomes: (db.prepare('SELECT * FROM measurement_outcomes WHERE exposure_id=?').all(row.id) as OutcomeRow[]).map(outcomeDto), usefulHistory: (db.prepare("SELECT f.at,e.presented_at AS presentedAt,e.profile_started_at AS profileStartedAt FROM measurement_feedback f JOIN measurement_exposures e ON e.id=f.exposure_id JOIN measurement_consent c ON c.owner=e.owner WHERE e.owner=? AND e.presented_at>=c.consented_at AND f.verdict='RELEVANT'").all(row.owner) as {at:string;presentedAt:string;profileStartedAt:string|null}[]).map(item=>({...item,observationEndsAt:new Date(Date.parse(item.presentedAt)+7*DAY).toISOString()})), attendanceHistory: (db.prepare("SELECT o.* FROM measurement_outcomes o JOIN measurement_exposures e ON e.id=o.exposure_id JOIN measurement_consent c ON c.owner=e.owner WHERE e.owner=? AND e.presented_at>=c.consented_at AND o.kind='ATTENDED' AND o.at>=? AND o.at<=?").all(row.owner,new Date(now.getTime()-90*DAY).toISOString(),now.toISOString()) as OutcomeRow[]).map(outcomeDto) }));
    const weeklyFrom = new Date(now.getTime()-7*DAY).toISOString(), weeklyInputs = inputs.filter(row => Date.parse(row.exposure.presentedAt) >= Date.parse(weeklyFrom));
    const labels = new Map<string, { id: string; label: string; exposureIds: Set<string> }>();
    for (const row of rows) {
      const snapshot = row.campaign_snapshot_json ? JSON.parse(row.campaign_snapshot_json) as Campaign : null;
      const id = row.campaign_id ?? 'unattributed', label = snapshot?.name ?? (row.campaign_id ? 'Retained campaign with unavailable legacy metadata' : 'No opted-in campaign attribution');
      const key = `${id}:${snapshot?.channel ?? ''}:${label}`;
      const group = labels.get(key) ?? { id, label, exposureIds: new Set<string>() }; group.exposureIds.add(row.id); labels.set(key, group);
    }
    const channelGroups = [...labels.values()].map(item => ({ id: item.id, label: item.label, inputs: inputs.filter(row => item.exposureIds.has(row.exposure.id)) }));
    const rulesGroups = [...new Set(inputs.map(row => row.exposure.rulesVersion))].map(rulesVersion => ({ rulesVersion, inputs: inputs.filter(row => row.exposure.rulesVersion === rulesVersion) }));
    // Check atomic membership partitions, not just group sizes: overlapping campaign,
    // rule, weekly and next-step sets must not reveal one or two people by subtraction.
    const allOwners = new Set(inputs.map(item => item.owner));
    const groups = [inputs,weeklyInputs,...channelGroups.map(group => group.inputs),...rulesGroups.map(group => group.inputs)];
    const cells = groups.flatMap(group => [new Set(group.map(row => row.owner)),...Object.values(nextStepSets(group,now))]);
    const partitions = new Map<string,number>();
    for (const owner of allOwners) { const key = cells.map(cell => cell.has(owner) ? '1' : '0').join(''); partitions.set(key,(partitions.get(key) ?? 0)+1); }
    const suppressed = allOwners.size < 3 || [...partitions.values()].some(size => size < 3);
    const result = (items: AggregateInput[]) => ({ suppressed, suppressionReason: suppressed ? 'Totals, weekly views, cohorts and next-step combinations are hidden together when any non-empty membership group or complement contains fewer than three currently opted-in profiles. Hidden values are not zeros.' : null, metrics: suppressed ? null : calculateMeasurement(items, now) });
    return {
      generatedAt: now.toISOString(), windowDays: 30, outcomeWindowDays: 7, cohortThreshold: 3, studentIdentitiesIncluded: false, evidenceLabel: 'Opted-in synthetic local actions and self-reports',
      periodVersion:'presentation-cohorts-v2', weekly:{windowDays:7,from:weeklyFrom,through:now.toISOString(),...result(weeklyInputs)},
      live: result(inputs), channels: channelGroups.map(group => ({ campaignId: group.id, label: group.label, ...result(group.inputs) })), rulesVersions: suppressed ? [] : rulesGroups.map(group => ({ rulesVersion: group.rulesVersion, ...result(group.inputs) })),
      calculationExample: calculationExample(now),
      definitions: {
        usefulRate: 'Distinct recipients with at least one explicit relevant response within seven days of its presentation / all distinct shown-shortlist recipients, including nonresponders. Save and open do not count as relevance.',
        applicationRate: 'Distinct recipients with an occurrence-linked, self-reported APPLIED event within seven days after presentation / all shown-shortlist recipients. No organizer confirmation is inferred.',
        nextStepRate: 'Distinct recipients with either an exact-date self-reported APPLIED event or a currently valid synthetic operator-recorded INTRODUCTION acknowledged within seven days after that exact occurrence was shown / all shown-shortlist recipients, including nonresponders. A recipient with both counts once. Immutable publication-version date snapshots must agree; legacy presentations without dates cannot join. Expiry, revocation, withdrawal, opt-out and loss of admission remove introduction contributions. This combines self-report with SYNTHETIC_NOT_VERIFIED evidence, never real organizer confirmation.',
        coverageRate: 'Distinct recipients of at least one recommendation / all distinct seekers who were shown a result, including empty results. No-match-only seekers are shown separately.',
        observation: 'Period version presentation-cohorts-v2 retains the legacy thirty-day presentation report and adds a rolling weekly (last seven days) presentation cohort with its own first-useful timing, sample and no-match counts. Both use seven-day relevance/next-step follow-up; open observation windows remain provisional. Late feedback is separate. First-useful hours use each relevant recipient’s earliest retained qualifying response across up to ninety days since recorded profile storage consent; missing baselines remain unknown and timing samples below three are hidden. Repeat self-reports use distinct opportunities and complete 28-day windows after the first report. These are not organizer-verified outcomes.',
        privacy: 'Explicit opt-in only. No IP, user agent, referrer, name, preferences or free text are stored in measurement. Ninety-day retention and at most 250 batches per profile; opt-out and profile deletion purge owned records. Small cohorts and complementary totals are suppressed. Calculation examples never enter live data.',
      },
    };
  }
  return { prune, consent, setConsent, campaigns, updateCampaign, attribution, attribute, getExposure, recordExposure, feedback, recordOutcome, exportData, summary };
}
export type MeasurementStore = ReturnType<typeof createMeasurementStore>;
