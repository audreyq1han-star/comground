import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StudentMatches } from '../../../packages/domain/app-contracts.ts';
import type { RecommendationExposure, RecommendationRef } from '../../../packages/domain/measurement-contracts.ts';
import { calculateMeasurement, calculationExample, createMeasurementStore, MEASUREMENT_RULES_VERSION, type AggregateInput, type PresentationReceipt } from './measurement-repository.ts';
import { assertCurrentPositiveFeedback, presentationRequestId, readPresentation, recommendationRefs, signPresentation } from './measurement-presentation.ts';

const now = new Date('2026-10-17T09:00:00Z'), DAY = 86400000;
const ref: RecommendationRef = { opportunityId: 'garden', occurrenceId: 'morning', version: 2 };
function setup(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS student_profiles(persona_id TEXT PRIMARY KEY,profile_json TEXT NOT NULL);');
  db.prepare('INSERT OR IGNORE INTO student_profiles VALUES (?,?)').run('demo-alex', JSON.stringify({ version: 7 }));
  db.prepare('INSERT OR IGNORE INTO student_profiles VALUES (?,?)').run('demo-sam', JSON.stringify({ version: 8 }));
  return { db, store: createMeasurementStore(db) };
}
function enable(store: ReturnType<typeof createMeasurementStore>, owner: 'demo-alex' | 'demo-sam' = 'demo-alex') {
  const state = store.consent(owner);
  return store.setConsent(owner, { enabled: true, expectedVersion: state.version, expectedProfileVersion: state.profileVersion }, now);
}
function receipt(overrides: Partial<PresentationReceipt> = {}): PresentationReceipt { return { owner: 'demo-alex', requestId: randomUUID(), issuedAt: now.toISOString(), consentVersion: 1, profileVersion: 7, rulesVersion: MEASUREMENT_RULES_VERSION, items: [ref], ...overrides }; }

test('measurement is explicitly default off, stores no outcomes or attribution before opt-in, and validates owner profile/version', () => {
  const { db, store } = setup();
  try {
    assert.deepEqual(store.consent('demo-alex'), { enabled: false, version: 0, profileVersion: 7, consentedAt: null, retentionDays: 90 });
    store.recordOutcome('demo-alex', { ...ref, kind: 'SAVED', eventKey: 'before-consent' }, now);
    assert.throws(() => store.attribute('demo-alex', { campaignId: 'demo-school-club' }, now), { code: 'MEASUREMENT_DISABLED' });
    assert.throws(() => store.recordExposure(receipt(), now), { code: 'MEASUREMENT_DISABLED' });
    assert.deepEqual(store.exportData('demo-alex', now).outcomes, []);
    for (const input of [{ enabled: true, expectedVersion: 0 }, { enabled: true, expectedVersion: 0, expectedProfileVersion: 6 }, { enabled: true, expectedVersion: 0, expectedProfileVersion: 7, owner: 'demo-sam' }]) assert.throws(() => store.setConsent('demo-alex', input, now));
    const state = enable(store);
    assert.equal(state.enabled, true); assert.equal(state.version, 1);
    assert.equal(store.consent('demo-sam').enabled, false);
  } finally { db.close(); }
});
test('delete/recreate cannot revive a previous consent mutation and leaves no owned measurement history', () => {
  const { db, store } = setup();
  try {
    const before = store.consent('demo-alex');
    enable(store); store.recordExposure(receipt(), now);
    db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run('demo-alex');
    assert.equal(store.exportData('demo-alex', now).consent.profileVersion, null);
    assert.equal(store.exportData('demo-alex', now).exposures.length, 0);
    db.prepare('INSERT INTO student_profiles VALUES (?,?)').run('demo-alex', JSON.stringify({ version: 9 }));
    assert.throws(() => store.setConsent('demo-alex', { enabled: true, expectedVersion: before.version, expectedProfileVersion: before.profileVersion }, now), { code: 'VERSION_CONFLICT' });
    assert.equal(store.consent('demo-alex').enabled, false);
  } finally { db.close(); }
});
test('campaigns are allowlisted, first touch is immutable, paused campaigns reject new attribution, and changes are versioned', () => {
  const { db, store } = setup();
  try {
    enable(store); enable(store, 'demo-sam');
    assert.throws(() => store.attribute('demo-alex', { campaignId: 'arbitrary-referrer' }, now), { code: 'INVALID_CAMPAIGN' });
    assert.throws(() => store.attribute('demo-alex', { campaignId: 'demo-school-club', referrer: 'https://outside.invalid' }, now), { code: 'INVALID_INPUT' });
    const first = store.attribute('demo-alex', { campaignId: 'demo-school-club' }, now);
    assert.deepEqual(store.attribute('demo-alex', { campaignId: 'demo-community' }, now), first);
    const paused = store.updateCampaign('demo-school-club', { expectedVersion: 1, paused: true });
    assert.equal(paused.version, 2); assert.ok(paused.path.startsWith('/communities/'));
    assert.equal(store.campaigns(true).some(item => item.id === paused.id), false);
    assert.throws(() => store.updateCampaign(paused.id, { expectedVersion: 1, paused: false }), { code: 'VERSION_CONFLICT' });
    assert.throws(() => store.attribute('demo-sam', { campaignId: paused.id }, now), { code: 'CAMPAIGN_PAUSED' });
    assert.deepEqual(store.attribute('demo-alex', { campaignId: paused.id }, now), first);
    assert.equal(store.recordExposure(receipt(), now).campaignId, first.campaignId);
  } finally { db.close(); }
});
test('presentation acknowledgement records exactly one versioned batch, including empty results, and rejects conflicting requests', () => {
  const { db, store } = setup();
  try {
    enable(store);
    const input = receipt(), first = store.recordExposure(input, now);
    assert.deepEqual(first.items, [ref]); assert.equal(first.rulesVersion, MEASUREMENT_RULES_VERSION);
    assert.deepEqual(store.recordExposure(input, new Date(now.getTime() + 1000)), first);
    assert.throws(() => store.recordExposure({ ...input, items: [{ ...ref, occurrenceId: 'evening' }] }, now), { code: 'REQUEST_CONFLICT' });
    assert.throws(() => store.recordExposure(receipt({ profileVersion: 6 }), now), { code: 'STALE_PRESENTATION' });
    store.recordExposure(receipt({ items: [] }), now);
    assert.equal(store.exportData('demo-alex', now).exposures.length, 2);
    assert.deepEqual(store.exportData('demo-sam', now).exposures, []);
  } finally { db.close(); }
});
test('recommendation feedback belongs to exact shown owner/occurrence, has no free text, and is immutable idempotent per batch', () => {
  const { db, store } = setup();
  try {
    enable(store); enable(store, 'demo-sam');
    const exposure = store.recordExposure(receipt(), now), input = { exposureId: exposure.id, opportunityId: ref.opportunityId, occurrenceId: ref.occurrenceId, verdict: 'RELEVANT' };
    assert.throws(() => store.feedback('demo-sam', input, now), { code: 'NOT_FOUND' });
    assert.throws(() => store.feedback('demo-alex', { ...input, occurrenceId: 'evening' }, now), { code: 'NOT_PRESENTED' });
    assert.throws(() => store.feedback('demo-alex', { ...input, note: 'Do not store' }, now), { code: 'INVALID_INPUT' });
    const recorded = store.feedback('demo-alex', input, now);
    assert.deepEqual(store.feedback('demo-alex', input, now), recorded);
    assert.throws(() => store.feedback('demo-alex', { ...input, verdict: 'NOT_RELEVANT' }, now), { code: 'FEEDBACK_CONFLICT' });
    assert.equal(store.exportData('demo-alex', now).feedback.length, 1);
    assert.equal(store.exportData('demo-sam', now).feedback.length, 0);
  } finally { db.close(); }
});
test('negative responses to an owned historical presentation remain valid when positive relevance is stale', () => {
  const { db, store } = setup();
  try {
    enable(store);
    const exposure = store.recordExposure(receipt(), now);
    const current = { data: [], profileVersion: 9 } as unknown as StudentMatches;
    assert.throws(() => assertCurrentPositiveFeedback('RELEVANT', exposure, ref, current), { code: 'STALE_PRESENTATION' });
    assert.doesNotThrow(() => assertCurrentPositiveFeedback('NOT_RELEVANT', exposure, ref, current));
    const negative = store.feedback('demo-alex', { exposureId: exposure.id, opportunityId: ref.opportunityId, occurrenceId: ref.occurrenceId, verdict: 'NOT_RELEVANT' }, now);
    assert.equal(negative.verdict, 'NOT_RELEVANT');
    assert.throws(() => store.feedback('demo-sam', { ...negative }, now));
  } finally { db.close(); }
});
test('actual outcome hooks link the latest prior exact occurrence and roll back with the calling student mutation', () => {
  const { db, store } = setup();
  try {
    enable(store);
    store.recordOutcome('demo-alex', { ...ref, kind: 'SAVED', eventKey: 'before-presentation' }, now);
    const first = store.recordExposure(receipt(), now);
    store.recordOutcome('demo-alex', { ...ref, occurrenceId: 'evening', kind: 'APPLIED', eventKey: 'wrong-occurrence' }, now);
    store.recordOutcome('demo-alex', { ...ref, kind: 'SAVED', eventKey: 'save-one' }, now);
    store.recordOutcome('demo-alex', { ...ref, kind: 'SAVED', eventKey: 'save-one' }, now);
    assert.equal(store.exportData('demo-alex', now).outcomes.length, 1);
    const later = new Date(now.getTime() + 1000), second = store.recordExposure(receipt(), later);
    store.recordOutcome('demo-alex', { ...ref, kind: 'APPLIED', eventKey: 'activity:2' }, later);
    db.exec('BEGIN'); store.recordOutcome('demo-alex', { ...ref, kind: 'ATTENDED', eventKey: 'activity:3' }, later); db.exec('ROLLBACK');
    const outcomes = store.exportData('demo-alex', later).outcomes;
    assert.equal(outcomes.length, 2); assert.equal(outcomes.find(item => item.kind === 'SAVED')?.exposureId, first.id);
    assert.equal(outcomes.find(item => item.kind === 'APPLIED')?.exposureId, second.id);
    assert.equal(outcomes.find(item => item.kind === 'APPLIED')?.evidenceKind, 'SELF_REPORTED');
  } finally { db.close(); }
});
test('opt-out purges exposure, attribution, private feedback and outcomes; old consent receipts cannot return after opt-in', () => {
  const { db, store } = setup();
  try {
    enable(store); store.attribute('demo-alex', { campaignId: 'demo-community' }, now);
    const input = receipt(), exposure = store.recordExposure(input, now);
    store.feedback('demo-alex', { exposureId: exposure.id, opportunityId: ref.opportunityId, occurrenceId: ref.occurrenceId, verdict: 'RELEVANT' }, now);
    store.recordOutcome('demo-alex', { ...ref, kind: 'APPLIED', eventKey: 'activity:2' }, now);
    store.setConsent('demo-alex', { expectedVersion: 1, expectedProfileVersion: 7, enabled: false }, now);
    const data = store.exportData('demo-alex', now);
    assert.equal(data.consent.enabled, false); assert.equal(data.attribution, null); assert.deepEqual(data.exposures, []); assert.deepEqual(data.feedback, []); assert.deepEqual(data.outcomes, []);
    enable(store);
    assert.throws(() => store.recordExposure(input, now), { code: 'STALE_PRESENTATION' });
  } finally { db.close(); }
});
test('small-cohort live summaries suppress complementary totals and identifiers, and never mix the calculation example into storage', () => {
  const { db, store } = setup();
  try {
    enable(store); enable(store, 'demo-sam');
    store.recordExposure(receipt(), now); store.recordExposure(receipt({ owner: 'demo-sam', profileVersion: 8, items: [] }), now);
    const summary = store.summary(now);
    assert.equal(summary.live.suppressed, true); assert.equal(summary.live.metrics, null);
    assert.ok(summary.channels.every(item => item.suppressed && item.metrics === null)); assert.deepEqual(summary.rulesVersions, []);
    assert.equal(JSON.stringify(summary).includes('demo-alex'), false); assert.equal(JSON.stringify(summary).includes('demo-sam'), false);
    assert.equal(JSON.stringify(summary).includes('garden'), false);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM measurement_exposures').get() as { n: number }).n, 2);
    assert.equal(summary.calculationExample.metrics.seekers, 8);
  } finally { db.close(); }
});
test('pure metrics retain nonresponders and zero-match seekers; opens/saves are not substantive applications or relevance', () => {
  const example = calculationExample(now).metrics;
  assert.equal(example.seekers, 8); assert.equal(example.recipients, 6); assert.equal(example.noMatchOnlySeekers, 2);
  assert.equal(example.respondents, 4); assert.equal(example.relevantRecipients, 3); assert.equal(example.notRelevantRecipients, 1);
  assert.equal(example.usefulRate, .5); assert.equal(example.applicationRate, 2 / 6); assert.equal(example.coverageRate, .75);
  assert.equal(example.completedObservationRecipients, 4); assert.equal(example.partialObservationRecipients, 2);
  const exposure: RecommendationExposure = { id: 'batch', requestId: 'request', presentedAt: now.toISOString(), observationEndsAt: new Date(now.getTime() + 7 * DAY).toISOString(), items: [ref], profileVersion: 1, rulesVersion: 'test-v1', campaignId: null };
  const input: AggregateInput = { owner: 'person', exposure, feedback: [], outcomes: [{ ...ref, exposureId: 'batch', kind: 'SAVED', at: now.toISOString(), evidenceKind: 'LOCAL_ACTION' }, { ...ref, exposureId: 'batch', kind: 'OPENED', at: now.toISOString(), evidenceKind: 'LOCAL_ACTION' }] };
  const metrics = calculateMeasurement([input, { ...input, exposure: { ...exposure, id: 'again' } }], now);
  assert.equal(metrics.recipients, 1); assert.equal(metrics.batches, 2); assert.equal(metrics.savedRecipients, 1); assert.equal(metrics.openedRecipients, 1);
  assert.equal(metrics.appliedWithin7Days, 0); assert.equal(metrics.relevantRecipients, 0); assert.equal(metrics.usefulRate, 0);
  input.outcomes.push({ ...ref, exposureId: 'batch', kind: 'APPLIED', at: exposure.observationEndsAt, evidenceKind: 'SELF_REPORTED' });
  assert.equal(calculateMeasurement([input], new Date(now.getTime() + 8 * DAY)).appliedWithin7Days, 1);
  input.outcomes[2].at = new Date(Date.parse(exposure.observationEndsAt) + 1).toISOString();
  assert.equal(calculateMeasurement([input], new Date(now.getTime() + 8 * DAY)).appliedWithin7Days, 0);
});
test('presentation tokens bind owner, profile/consent versions, exact occurrence publication version, expiry and process key without storing requests', () => {
  const matches = { data: [{ opportunity: { id: ref.opportunityId, occurrenceId: ref.occurrenceId, version: ref.version } }], profileVersion: 7 } as unknown as StudentMatches;
  const requestId = randomUUID(), token = signPresentation('demo-alex', requestId, matches, 1, now, 'test-key');
  const decoded = readPresentation(token, 'demo-alex', now, 'test-key');
  assert.equal(decoded.profileVersion, 7); assert.equal(decoded.consentVersion, 1); assert.deepEqual(decoded.items, [ref]);
  assert.deepEqual(recommendationRefs(matches), [ref]);
  for (const read of [() => readPresentation(token, 'demo-sam', now, 'test-key'), () => readPresentation(token, 'demo-alex', now, 'restart-key'), () => readPresentation(`${token}tampered`, 'demo-alex', now, 'test-key'), () => readPresentation(token, 'demo-alex', new Date(now.getTime() + 15 * 60000 + 1), 'test-key')]) assert.throws(read, { code: 'INVALID_PRESENTATION' });
  assert.throws(() => presentationRequestId('a-user-chosen-free-text'), { code: 'INVALID_INPUT' });
});
test('ninety-day retention and per-profile bounds remove dependent data without removing other profiles', () => {
  const { db, store } = setup();
  try {
    enable(store); enable(store, 'demo-sam');
    store.attribute('demo-alex', { campaignId: 'demo-community' }, now);
    const old = store.recordExposure(receipt(), now);
    store.feedback('demo-alex', { exposureId: old.id, opportunityId: ref.opportunityId, occurrenceId: ref.occurrenceId, verdict: 'RELEVANT' }, now);
    for (let i = 0; i < 251; i++) store.recordExposure(receipt(), new Date(now.getTime() + i + 1));
    assert.equal(store.exportData('demo-alex', new Date(now.getTime() + 1000)).exposures.length, 250);
    assert.equal(store.exportData('demo-alex', new Date(now.getTime() + 1000)).feedback.length, 0);
    const afterRetention = new Date(now.getTime() + 91 * DAY);
    store.recordExposure(receipt({ owner: 'demo-sam', profileVersion: 8 }), afterRetention);
    assert.equal(store.exportData('demo-alex', afterRetention).exposures.length, 0);
    assert.equal(store.exportData('demo-alex', afterRetention).attribution, null);
    assert.equal(store.exportData('demo-sam', afterRetention).exposures.length, 1);
  } finally { db.close(); }
});
test('consent, attribution, occurrence feedback, self-reported outcomes and campaign pause persist across database restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comground-measurement-test-')), filename = join(dir, 'measurement.sqlite');
  let db: DatabaseSync | undefined;
  try {
    let opened = setup(filename); db = opened.db; let store = opened.store;
    enable(store); store.attribute('demo-alex', { campaignId: 'demo-school-club' }, now);
    const exposure = store.recordExposure(receipt(), now);
    store.feedback('demo-alex', { exposureId: exposure.id, opportunityId: ref.opportunityId, occurrenceId: ref.occurrenceId, verdict: 'NOT_RELEVANT' }, now);
    store.recordOutcome('demo-alex', { ...ref, kind: 'APPLIED', eventKey: 'applied:2' }, now);
    store.updateCampaign('demo-community', { expectedVersion: 1, paused: true });
    const before = store.exportData('demo-alex', now); db.close(); db = undefined;
    opened = setup(filename); db = opened.db; store = opened.store;
    assert.deepEqual(store.exportData('demo-alex', now), before); assert.equal(store.campaigns().find(item => item.id === 'demo-community')?.paused, true);
    db.prepare('DELETE FROM student_profiles WHERE persona_id=?').run('demo-alex');
    for (const table of ['measurement_consent', 'measurement_attribution', 'measurement_exposures', 'measurement_feedback', 'measurement_outcomes']) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('usefulness has an inclusive seven-day window with late feedback explicitly separate', () => {
  const exposure: RecommendationExposure = { id:'window',requestId:'request',presentedAt:now.toISOString(),observationEndsAt:new Date(now.getTime()+7*DAY).toISOString(),items:[ref],profileVersion:1,rulesVersion:'test',campaignId:null };
  const input: AggregateInput = { owner:'person',exposure,feedback:[{...ref,exposureId:'window',verdict:'RELEVANT',at:exposure.observationEndsAt}],outcomes:[] };
  assert.equal(calculateMeasurement([input],new Date(now.getTime()+9*DAY)).relevantRecipients,1);
  input.feedback[0].at=new Date(now.getTime()+7*DAY+1).toISOString();
  const late=calculateMeasurement([input],new Date(now.getTime()+9*DAY));
  assert.equal(late.relevantRecipients,0);assert.equal(late.usefulRate,0);assert.equal(late.lateRelevantRecipients,1);assert.equal(late.lateRespondents,1);
  input.feedback[0].at=new Date(now.getTime()-1).toISOString();
  assert.equal(calculateMeasurement([input],now).relevantRecipients,0);
});

test('first-useful timing deduplicates recipients, excludes missing baseline and suppresses tiny samples', () => {
  const rows: AggregateInput[]=[2,4,8].map((hours,index)=>({owner:`owner-${index}`,exposure:{id:`batch-${index}`,requestId:`request-${index}`,profileStartedAt:now.toISOString(),presentedAt:now.toISOString(),observationEndsAt:new Date(now.getTime()+7*DAY).toISOString(),items:[ref],profileVersion:1,rulesVersion:'test',campaignId:null},feedback:[{...ref,exposureId:`batch-${index}`,verdict:'RELEVANT',at:new Date(now.getTime()+hours*3600000).toISOString()}],outcomes:[]}));
  const metrics=calculateMeasurement([...rows,rows[0]],new Date(now.getTime()+DAY));
  assert.deepEqual(metrics.firstUsefulMatch,{sampleCount:3,missingBaselineRecipients:0,medianHours:4,p90Hours:8,suppressed:false});
  assert.equal(calculateMeasurement([rows[0]],new Date(now.getTime()+DAY)).firstUsefulMatch.medianHours,null);
  rows[0].exposure.profileStartedAt=null;
  assert.equal(calculateMeasurement(rows,new Date(now.getTime()+DAY)).firstUsefulMatch.missingBaselineRecipients,1);
});

test('historical repeats count distinct opportunities and complete observation, never organizer confirmation', () => {
  const exposure: RecommendationExposure={id:'batch',requestId:'request',presentedAt:now.toISOString(),observationEndsAt:new Date(now.getTime()+7*DAY).toISOString(),items:[ref],profileVersion:1,rulesVersion:'test',campaignId:null};
  const attendance=(opportunityId:string,days:number)=>({...ref,opportunityId,exposureId:'batch',kind:'ATTENDED' as const,at:new Date(now.getTime()+days*DAY).toISOString(),evidenceKind:'SELF_REPORTED' as const});
  const row:AggregateInput={owner:'person',exposure,feedback:[],outcomes:[],attendanceHistory:[attendance('garden',0),attendance('garden',2),attendance('other',3)]};
  const complete=calculateMeasurement([row],new Date(now.getTime()+30*DAY));
  assert.equal(complete.repeatSelfReported.observedParticipants,1);assert.equal(complete.repeatSelfReported.matureParticipants,1);assert.equal(complete.repeatSelfReported.repeatedWithin28Days,1);assert.equal(complete.repeatSelfReported.evidenceKind,'SELF_REPORTED');
  assert.equal(calculateMeasurement([row],new Date(now.getTime()+10*DAY)).repeatSelfReported.matureParticipants,0);
  row.attendanceHistory=[attendance('garden',0),attendance('garden',2)];
  assert.equal(calculateMeasurement([row],new Date(now.getTime()+30*DAY)).repeatSelfReported.repeatedWithin28Days,0);
});

test('account cohort gate rejects forged teen measurement opt-in/exposure/attribution while allowing opt-out',()=>{
 const {db}=setup();const store=createMeasurementStore(db,{allowOwner:owner=>owner!=='demo-alex'});
 try{
  assert.equal(store.consent('demo-alex').enabled,false);
  assert.throws(()=>store.setConsent('demo-alex',{enabled:true,expectedVersion:0,expectedProfileVersion:7},now),{code:'MEASUREMENT_NOT_ADMITTED'});
  assert.throws(()=>store.recordExposure(receipt(),now),{code:'MEASUREMENT_NOT_ADMITTED'});
  assert.throws(()=>store.attribute('demo-alex',{campaignId:'demo-school-club'},now),{code:'MEASUREMENT_NOT_ADMITTED'});
  assert.equal(store.setConsent('demo-alex',{enabled:false,expectedVersion:0,expectedProfileVersion:7},now).enabled,false);
  store.recordOutcome('demo-alex',{...ref,kind:'APPLIED',eventKey:'forged'},now);assert.equal(store.exportData('demo-alex',now).outcomes.length,0);
  assert.equal(enable(store,'demo-sam').enabled,true);
 }finally{db.close();}
});

test('presentation retains profile baseline in own export and missing legacy baseline remains unknown',()=>{
 const {db,store}=setup();try{
  db.prepare('UPDATE student_profiles SET profile_json=? WHERE persona_id=?').run(JSON.stringify({version:7,consentedAt:new Date(now.getTime()-DAY).toISOString()}),'demo-alex');enable(store);
  const batch=store.recordExposure(receipt(),now);assert.equal(batch.profileStartedAt,new Date(now.getTime()-DAY).toISOString());
  db.prepare('UPDATE student_profiles SET profile_json=? WHERE persona_id=?').run(JSON.stringify({version:8,consentedAt:now.toISOString()}),'demo-alex');
  assert.equal(store.exportData('demo-alex',now).exposures[0].profileStartedAt,batch.profileStartedAt);
  db.prepare('UPDATE measurement_exposures SET profile_started_at=NULL WHERE id=?').run(batch.id);assert.equal(store.exportData('demo-alex',now).exposures[0].profileStartedAt,null);
  store.setConsent('demo-alex',{enabled:false,expectedVersion:1,expectedProfileVersion:8},now);assert.deepEqual(store.exportData('demo-alex',now).exposures,[]);
 }finally{db.close();}
});


test('cohort migration purges old measurement consent and cannot resurrect it after readmission',()=>{
 const {db,store}=setup();try{enable(store);store.recordExposure(receipt(),now);const gated=createMeasurementStore(db,{allowOwner:owner=>owner!=='demo-alex'});assert.equal(gated.consent('demo-alex').enabled,false);assert.equal(gated.exportData('demo-alex',now).consent.enabled,false);assert.deepEqual(gated.exportData('demo-alex',now).exposures,[]);const readmitted=createMeasurementStore(db,{allowOwner:()=>true});assert.equal(readmitted.consent('demo-alex').enabled,false);assert.equal(readmitted.consent('demo-alex').version,2);}finally{db.close();}
});
