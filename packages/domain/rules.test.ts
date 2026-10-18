import test from 'node:test';
import assert from 'node:assert/strict';
import type { FixtureRecord, Preferences, PublicOpportunity } from './contracts.ts';
import { fixtureList } from './fixtures.ts';
import { RANKING_POLICY_VERSION, syntheticTravelMinutes, DomainError, evaluateEligibility, isCurrent, parseFixture, parsePreferences, publicationIssues, rankMatches } from './rules.ts';

const now = new Date('2026-10-17T12:00:00.000Z');
const fixture = (id = 'garden'): FixtureRecord => structuredClone(fixtureList(now).find(item => item.fixtureId === id)!.record);
const preferences = (): Preferences => ({
  ageMin: 16, ageMax: 17, availableFrom: now.toISOString(), availableUntil: '2026-11-17T12:00:00.000Z',
  mode: 'ANY', area: 'Example neighborhood', interests: ['environment', 'outdoors'], maxFee: 0,
  hasTraining: false, hasGuardian: false, requiresSchoolCredit: false,
});
const publicRecord = (record = fixture(), id = 'op-garden'): PublicOpportunity => {
  const { externalId: _externalId, sourceUpdatedAt: _updated, isCancelled: _cancelled, source, ...rest } = record;
  return { ...rest, id, version: 1, source: { name: source.name, url: source.url } };
};

test('synthetic fixtures have stable identifiers, isolated objects and dates relative to the supplied clock', () => {
  const first = fixtureList(now);
  const later = fixtureList(new Date(now.getTime() + 86_400_000));
  assert.deepEqual(first.map(item => item.fixtureId), ['garden', 'remote', 'missing-age', 'expired', 'cancelled', 'no-permission', 'garden-changed', 'pantry', 'river-cleanup', 'animal-care', 'youth-arts', 'remote-tech', 'past-reading', 'garden-series']);
  assert.equal(Date.parse(later[0].record.startsAt) - Date.parse(first[0].record.startsAt), 86_400_000);
  first[0].record.title = 'mutated';
  assert.notEqual(fixture().title, 'mutated');
  assert.equal(fixture('garden-changed').externalId, fixture().externalId);
  assert.notEqual(fixture('garden-changed').minAge, fixture().minAge);
  assert.deepEqual(fixtureList(new Date('2026-10-17T23:59:59Z')), fixtureList(now));
  for (const { record, label } of later) {
    assert.match(label, /synthetic/i);
    assert.equal(parseFixture(record).isSynthetic, true);
    assert.equal(new URL(record.signupUrl).hostname, 'example.invalid');
  }
});

test('the shipped catalogue has diverse current examples and no fabricated school-credit approval', () => {
  const examples = fixtureList(now);
  const publishable = examples.filter(item => publicationIssues(item.record, now).length === 0);
  const unique = new Map(publishable.map(item => [`${item.record.source.id}:${item.record.externalId}`, item.record]));
  assert.ok(unique.size >= 6, 'At least six distinct current publishable opportunities');
  assert.ok(new Set([...unique.values()].map(record => record.source.id)).size >= 2, 'At least two approved synthetic sources');
  assert.ok(new Set([...unique.values()].map(record => record.category)).size >= 4, 'Different interests have different catalogue choices');
  assert.ok([...unique.values()].some(record => record.requiresTraining === true));
  assert.ok([...unique.values()].some(record => record.requiresGuardian === true));
  assert.ok([...unique.values()].some(record => (record.fee ?? 0) > 0));
  assert.ok([...unique.values()].some(record => record.mode === 'REMOTE'));
  assert.ok([...unique.values()].some(record => record.mode === 'IN_PERSON'));
  for (const { fixtureId, record } of examples) {
    assert.equal(record.schoolCreditApproved, false, `${fixtureId} makes no school-credit approval claim`);
    assert.match(record.organization.name, /synthetic/i, fixtureId);
    assert.match(record.source.name, /synthetic/i, fixtureId);
    assert.doesNotMatch(record.evidence.map(item => item.excerpt).join(' '), /school credit approved/i, fixtureId);
  }
});

test('past reading can be published at its genuine historical fixture clock but is unavailable now', () => {
  const record = fixture('past-reading');
  assert.equal(record.externalId, 'synthetic-past-reading-001');
  const historicalNow = new Date(Date.parse(record.startsAt) - 3_600_000);
  assert.ok(Date.parse(record.sourceUpdatedAt) <= Date.parse(record.confirmedAt));
  assert.ok(Date.parse(record.confirmedAt) <= historicalNow.getTime());
  assert.ok(Date.parse(record.fetchedAt) <= historicalNow.getTime());
  assert.ok(Date.parse(record.validUntil) > historicalNow.getTime());
  assert.deepEqual(publicationIssues(record, historicalNow), []);
  assert.equal(isCurrent(record, historicalNow), true);
  assert.ok(Date.parse(record.endsAt) < now.getTime());
  assert.equal(isCurrent(record, now), false);
  assert.ok(publicationIssues(record, now).length > 0);
});

test('fixture parsing rejects unsafe URLs and malformed structures instead of coercing values', () => {
  for (const signupUrl of ['javascript:alert(1)', 'https://real-organization.org/signup', 'http://example.invalid/signup', 'https://user:pass@example.invalid/signup']) {
    assert.throws(() => parseFixture({ ...fixture(), signupUrl }), DomainError);
  }
  assert.throws(() => parseFixture({ ...fixture(), minAge: '16' }), DomainError);
  assert.throws(() => parseFixture({ ...fixture(), isSynthetic: false }), DomainError);
  assert.throws(() => parseFixture({ ...fixture(), unknown: 'discarding private inputs silently is unsafe' }), DomainError);
  assert.throws(() => parseFixture(null), DomainError);
});

test('dates must contain a timezone, exist on the calendar and have a sensible order', () => {
  assert.throws(() => parseFixture({ ...fixture(), startsAt: '2026-02-30T10:00:00Z' }), DomainError);
  assert.throws(() => parseFixture({ ...fixture(), startsAt: '2026-10-19T10:00:00' }), DomainError);
  assert.throws(() => parseFixture({ ...fixture(), endsAt: fixture().startsAt }), DomainError);
  assert.throws(() => parseFixture({ ...fixture(), timezone: 'Not/A-Timezone' }), DomainError);
  assert.equal(parseFixture({ ...fixture(), startsAt: '2026-10-19T10:00:00+02:00' }).startsAt, '2026-10-19T10:00:00+02:00');
});

test('preferences are validated without accepting names, email or coerced booleans', () => {
  assert.deepEqual(parsePreferences(preferences()), preferences());
  assert.throws(() => parsePreferences({ ...preferences(), email: 'student@example.invalid' }), DomainError);
  assert.throws(() => parsePreferences({ ...preferences(), hasGuardian: 'false' }), DomainError);
  assert.throws(() => parsePreferences({ ...preferences(), ageMin: 18, ageMax: 17 }), DomainError);
  assert.throws(() => parsePreferences({ ...preferences(), availableUntil: preferences().availableFrom }), DomainError);
  assert.throws(() => parsePreferences({ ...preferences(), maxFee: -1 }), DomainError);
});

test('only complete, permitted, current fixture records may be published', () => {
  assert.deepEqual(publicationIssues(fixture(), now), []);
  assert.deepEqual(publicationIssues(fixture('remote'), now), []);
  for (const id of ['missing-age', 'expired', 'cancelled', 'no-permission']) {
    assert.ok(publicationIssues(fixture(id), now).length, id);
  }
  assert.ok(publicationIssues({ ...fixture(), source: { ...fixture().source, permissionEvidence: '' } }, now).length);
  assert.ok(publicationIssues({ ...fixture(), confirmedAt: '2026-10-18T12:00:00Z' }, now).length);
});

test('current records fail closed at start/expiry boundaries and for revoked permissions', () => {
  const record = fixture();
  assert.equal(isCurrent(record, now), true);
  assert.equal(isCurrent(record, new Date(record.startsAt)), false);
  assert.equal(isCurrent({ ...record, validUntil: now.toISOString() }, now), false);
  assert.equal(isCurrent({ ...record, source: { ...record.source, permission: 'REVOKED' } }, now), false);
  assert.equal(isCurrent({ ...record, isCancelled: true }, now), false);
});

test('whole age bands must qualify; unknown minimum age is never eligible', () => {
  assert.equal(evaluateEligibility(fixture(), preferences(), now).status, 'ELIGIBLE');
  for (const band of [{ ageMin: 14, ageMax: 15 }, { ageMin: 15, ageMax: 17 }]) {
    assert.equal(evaluateEligibility(fixture(), { ...preferences(), ...band }, now).status, 'INELIGIBLE');
  }
  assert.equal(evaluateEligibility({ ...fixture(), maxAge: 16 }, preferences(), now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(fixture('missing-age'), preferences(), now).status, 'NEEDS_CONFIRMATION');
  assert.equal(evaluateEligibility({ ...fixture(), minAge: 18, maxAge: 17 }, preferences(), now).status, 'NEEDS_CONFIRMATION');
});

test('age-band boundary matrix checks every band around both age limits', () => {
  const record = { ...fixture(), minAge: 16, maxAge: 18 };
  for (let ageMin = 12; ageMin <= 20; ageMin++) {
    for (let ageMax = ageMin; ageMax <= 20; ageMax++) {
      const actual = evaluateEligibility(record, { ...preferences(), ageMin, ageMax }, now);
      assert.equal(actual.status, ageMin >= 16 && ageMax <= 18 ? 'ELIGIBLE' : 'INELIGIBLE', `${ageMin}-${ageMax}`);
    }
  }
});

test('permission cancellation and freshness remain hard gates when eligibility is otherwise compatible', () => {
  for (const id of ['expired', 'cancelled', 'no-permission']) {
    assert.equal(evaluateEligibility(fixture(id), preferences(), now).status, 'INELIGIBLE', id);
  }
  const record = fixture();
  assert.equal(evaluateEligibility({ ...record, sourceUpdatedAt: '2026-10-17T06:00:00Z' }, preferences(), now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(publicRecord({ ...record, validUntil: now.toISOString() }), preferences(), now).status, 'INELIGIBLE');
  assert.ok(publicationIssues({ ...record, evidence: [] }, now).length);
});

test('availability must contain the full occurrence and mode/coarse area must fit', () => {
  const record = fixture();
  assert.equal(evaluateEligibility(record, { ...preferences(), availableFrom: record.startsAt, availableUntil: record.endsAt }, now).status, 'ELIGIBLE');
  assert.equal(evaluateEligibility(record, { ...preferences(), availableFrom: new Date(Date.parse(record.startsAt) + 1).toISOString() }, now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(record, { ...preferences(), availableUntil: new Date(Date.parse(record.endsAt) - 1).toISOString() }, now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(record, { ...preferences(), mode: 'REMOTE' }, now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(record, { ...preferences(), area: 'Another area' }, now).status, 'INELIGIBLE');
  assert.equal(evaluateEligibility(record, { ...preferences(), area: '' }, now).status, 'NEEDS_CONFIRMATION');
  assert.equal(evaluateEligibility(fixture('remote'), { ...preferences(), area: '' }, now).status, 'ELIGIBLE');
});

test('fee, training, guardian and requested school credit are hard requirements', () => {
  const cases: [Partial<FixtureRecord>, Partial<Preferences>][] = [
    [{ fee: 10 }, {}], [{ requiresTraining: true }, {}], [{ requiresGuardian: true }, {}],
    [{ schoolCreditApproved: false }, { requiresSchoolCredit: true }],
  ];
  for (const [recordChanges, prefChanges] of cases) {
    assert.equal(evaluateEligibility({ ...fixture(), ...recordChanges }, { ...preferences(), ...prefChanges }, now).status, 'INELIGIBLE');
  }
  assert.equal(evaluateEligibility({ ...fixture(), fee: 10, requiresTraining: true, requiresGuardian: true }, { ...preferences(), maxFee: 10, hasTraining: true, hasGuardian: true }, now).status, 'ELIGIBLE');
  for (const field of ['fee', 'requiresTraining', 'requiresGuardian', 'schoolCreditApproved'] as const) {
    assert.equal(evaluateEligibility({ ...fixture(), [field]: null }, { ...preferences(), requiresSchoolCredit: true }, now).status, 'NEEDS_CONFIRMATION', field);
  }
});

test('ranking discards noneligible/expired records, uses deterministic interest overlap and does not expose a confidence claim', () => {
  const garden = publicRecord();
  const remote = publicRecord(fixture('remote'), 'op-remote');
  const invalid = publicRecord(fixture('missing-age'), 'op-missing');
  const expired = publicRecord(fixture('expired'), 'op-expired');
  const records = [remote, invalid, expired, garden];
  const first = rankMatches(records, preferences(), now);
  assert.deepEqual(first.map(match => match.opportunity.id), ['op-garden', 'op-remote']);
  assert.deepEqual(first, rankMatches([...records].reverse(), preferences(), now));
  assert.ok(first.every(match => match.eligibility.status === 'ELIGIBLE' && match.reasons.length > 0));
  assert.doesNotMatch(first.flatMap(match => match.reasons).join(' '), /\d+%|\bAI\b|guaranteed|verified/i);
  assert.deepEqual(rankMatches(records, { ...preferences(), ageMin: 1, ageMax: 2 }, now), []);
});

test('explicit occurrences retain stable primary identity and enforce bounded valid schedules', () => {
  const series = fixture('garden-series');
  const parsed = parseFixture(series);
  assert.equal(parsed.occurrences?.length, 3);
  assert.equal(parsed.startsAt, parsed.occurrences![0].startsAt);
  for (const occurrences of [[], series.occurrences!.slice(1), [...series.occurrences!, series.occurrences![0]], Array.from({length:13},(_,i)=>({...series.occurrences![0],id:i===0?'primary':`date-${i}`}))]) assert.throws(()=>parseFixture({...series,occurrences}),DomainError);
  assert.throws(()=>parseFixture({...series,occurrences:[{...series.occurrences![0],endsAt:series.occurrences![0].startsAt}]}),DomainError);
  assert.throws(()=>parseFixture({...series,occurrences:[{...series.occurrences![0],timezone:'Invalid/Zone'}]}),DomainError);
  for (const id of ['date.with.dot', 'x'.repeat(41), '-date', 'date:other']) assert.throws(()=>parseFixture({...series,occurrences:[series.occurrences![0],{...series.occurrences![1],id}]}),DomainError);
  assert.equal(parseFixture({...series,occurrences:[series.occurrences![0],{...series.occurrences![1],id:'x'.repeat(40)}]}).occurrences![1].id.length,40);
});

test('matching chooses a later compatible date and returns one result per parent', () => {
  const series = publicRecord(fixture('garden-series'),'series');
  const second = series.occurrences![1];
  const prefs = {...preferences(),availableFrom:second.startsAt,availableUntil:second.endsAt};
  const matches = rankMatches([series],prefs,now);
  assert.equal(matches.length,1); assert.equal(matches[0].opportunity.occurrenceId,'week-2');
  assert.equal(matches[0].opportunity.startsAt,second.startsAt);
  assert.equal(evaluateEligibility({...series,occurrenceId:'primary'},prefs,now).status,'INELIGIBLE');
  assert.equal(evaluateEligibility({...series,occurrenceId:'missing'},prefs,now).status,'INELIGIBLE');
});

test('expired or cancelled primary does not invalidate a fresh sibling; whole-parent cancellation does', () => {
  const series = fixture('garden-series');
  const afterPrimary = new Date(Date.parse(series.occurrences![0].validUntil)+1);
  assert.equal(isCurrent(series,afterPrimary),true); assert.deepEqual(publicationIssues(series,afterPrimary),[]);
  const partial = {...series,occurrences:series.occurrences!.map(item=>({...item,isCancelled:item.id==='primary'}))};
  assert.equal(isCurrent(partial,now),true); assert.deepEqual(publicationIssues(partial,now),[]);
  assert.equal(parseFixture(partial).isCancelled,false);
  const matches = rankMatches([publicRecord(partial,'series')],preferences(),now);
  assert.equal(matches[0].opportunity.occurrenceId,'week-2');
  assert.equal(isCurrent({...partial,isCancelled:true},now),false);
  const allCancelled = {...series,occurrences:series.occurrences!.map(item=>({...item,isCancelled:true}))};
  assert.ok(publicationIssues(allCancelled,now).length);
});


test('school stage is separate from age and optional travel tolerance is bounded',()=>{
  assert.equal(parsePreferences({...preferences(),schoolStage:'HIGH_SCHOOL',ageMin:18,ageMax:18}).schoolStage,'HIGH_SCHOOL');
  for(const maxTravelMinutes of [-1,121,1.5,'15'])assert.throws(()=>parsePreferences({...preferences(),maxTravelMinutes}),DomainError);
  assert.equal(syntheticTravelMinutes('Example neighborhood','Example downtown'),30);
  assert.equal(syntheticTravelMinutes('Unknown','Example neighborhood'),null);
});
test('travel unknowns fail closed and age clarification narrows only the selected age range',()=>{
 const item=publicRecord({...fixture(),area:'Example downtown'});
 assert.ok(evaluateEligibility(item,{...preferences(),maxTravelMinutes:15},now).reasonCodes.includes('TRAVEL_OVER_LIMIT'));
 assert.equal(evaluateEligibility(item,{...preferences(),maxTravelMinutes:30},now).status,'ELIGIBLE');
 assert.equal(evaluateEligibility(item,{...preferences(),area:'Unknown',maxTravelMinutes:30},now).status,'NEEDS_CONFIRMATION');
 const adult=publicRecord({...fixture(),minAge:18});
 assert.equal(evaluateEligibility(adult,{...preferences(),ageMin:16,ageMax:18},now).status,'INELIGIBLE');
 assert.equal(evaluateEligibility(adult,{...preferences(),ageMin:18,ageMax:18},now).status,'ELIGIBLE');
});
test('ranking exposes versioned interest travel and freshness components after hard eligibility',()=>{
 const result=rankMatches([publicRecord()],preferences(),now)[0];
 assert.equal(result.ranking?.policyVersion,RANKING_POLICY_VERSION);
 assert.equal(result.rankScore,result.ranking!.interest+result.ranking!.travel+result.ranking!.freshness);
 const blocked=publicRecord({...fixture(),requiresGuardian:true});
 assert.equal(rankMatches([blocked],preferences(),now).length,0);
});


test('school-program simulation requires the exact reviewed program scope without changing public credit facts',()=>{
 const record=publicRecord(),prefs={...preferences(),requiresSchoolCredit:true,schoolProgramId:'synthetic:test-program'};
 assert.equal(evaluateEligibility(record,prefs,now).status,'NEEDS_CONFIRMATION');
 assert.equal(rankMatches([record],prefs,now,{syntheticSchoolProgramApprovals:['other']}).length,0);
 const matches=rankMatches([record],prefs,now,{syntheticSchoolProgramApprovals:[record.id]});
 assert.equal(matches.length,1);assert.equal(matches[0].opportunity.schoolCreditApproved,false);
 assert.match(matches[0].reasons.join(' '),/does not certify real school service credit/);
 assert.throws(()=>parsePreferences({...prefs,schoolProgramId:'A real school name'}),DomainError);
});
