import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPANSION_GATES, evaluateExpansionReview, type ExpansionGate, type ExpansionReview } from './expansion-readiness.ts';
const now = new Date('2026-10-17T12:00:00.000Z');
function reviewed(): ExpansionReview {
  return {
    format: 'comground-expansion-review-v1', version: 1, previousReview: null,
    recordedAt: '2026-10-17T10:00:00.000Z', validUntil: '2026-10-18T10:00:00.000Z',
    scope: { stage: 'HIGH_SCHOOL', geography: 'synthetic district', cohort: 'synthetic 18+ high-school cohort', ageBands: ['ADULT_HIGH_SCHOOL'] },
    release: { commit: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}` },
    gates: Object.fromEntries(Object.keys(EXPANSION_GATES).map(key => [key, { status: 'PASSED', evidence: ['synthetic-reviewed-evidence'], reviewedBy: 'synthetic-owner-reference', reviewedAt: '2026-10-17T09:00:00.000Z' }])) as ExpansionReview['gates'],
    decision: { requested: 'GO', reference: 'synthetic-decision' },
  };
}
test('all complete adult high-school review declarations can pass without implying evidence verification', () => {
  const result = evaluateExpansionReview(reviewed(), now);
  assert.equal(result.decision, 'GO'); assert.deepEqual(result.blockers, []); assert.equal(result.productionTeenAdmission, false);
});
test('every unknown, blocked or unsubstantiated gate fails closed even when a go was requested', () => {
  for (const key of Object.keys(EXPANSION_GATES) as ExpansionGate[]) {
    for (const patch of [{ status: 'UNKNOWN' }, { status: 'BLOCKED' }, { evidence: [] }, { reviewedBy: null }, { reviewedAt: null }, { reviewedAt: '2026-10-17T11:00:00.000Z' }]) {
      const record = reviewed(); Object.assign(record.gates[key], patch);
      assert.equal(evaluateExpansionReview(record, now).decision, 'NO_GO', `${key}: ${JSON.stringify(patch)}`);
    }
  }
});
test('teen production scope, missing release/cutoff/history and an explicit no-go cannot be overridden by passed gates', () => {
  const cases: ExpansionReview[] = [];
  let record = reviewed(); record.scope.ageBands.push('TEEN_13_17'); cases.push(record);
  record = reviewed(); record.version = 2; cases.push(record);
  record = reviewed(); record.scope.geography = null; cases.push(record);
  record = reviewed(); record.release.commit = null; cases.push(record);
  record = reviewed(); record.release.imageDigest = null; cases.push(record);
  record = reviewed(); record.recordedAt = '2026-10-18T10:00:00.000Z'; cases.push(record);
  record = reviewed(); record.validUntil = now.toISOString(); cases.push(record);
  record = reviewed(); record.decision.reference = null; cases.push(record);
  record = reviewed(); record.decision.requested = 'NO_GO'; cases.push(record);
  for (const candidate of cases) assert.equal(evaluateExpansionReview(candidate, now).decision, 'NO_GO');
  record = reviewed(); record.version = 2; record.previousReview = 'review-v1'; assert.equal(evaluateExpansionReview(record, now).decision, 'GO');
});
test('unsupported or malformed review records return no-go without reflecting untrusted content', () => {
  const base = reviewed();
  for (const candidate of [null, {}, { ...base, extra: 'untrusted' }, { ...base, recordedAt: '2026-02-30T00:00:00.000Z' }, { ...base, scope: { ...base.scope, stage: 'COLLEGE' } }, { ...base, scope: { ...base.scope, ageBands: [] } }, { ...base, gates: { ...base.gates, extra: {} } }, { ...base, release: { ...base.release, imageDigest: 'latest' } }]) {
    const result = evaluateExpansionReview(candidate, now); assert.equal(result.decision, 'NO_GO'); assert.equal(result.record, null); assert.equal(result.blockers.length, 1);
  }
});
