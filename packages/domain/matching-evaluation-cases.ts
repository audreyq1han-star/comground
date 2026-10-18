import type { EligibilityResult, FixtureRecord, Preferences } from './contracts.ts';
import { fixtureList } from './fixtures.ts';

const now = new Date('2026-10-17T12:00:00Z');
const fixtures = fixtureList(now);
const garden = fixtures.find(item => item.fixtureId === 'garden')!.record;
const baseline: Preferences = {
  ageMin: 16, ageMax: 17, availableFrom: '2026-10-17T00:00:00Z', availableUntil: '2026-11-17T23:59:59Z',
  mode: 'ANY', area: 'Example neighborhood', interests: ['outdoors'], maxFee: 0,
  hasTraining: false, hasGuardian: false, requiresSchoolCredit: false,
};
type Case = { name: string; fixture?: string; preferences?: Partial<Preferences>; record?: Partial<FixtureRecord>; expected: EligibilityResult['status']; code?: string };

// Expected outcomes are explicit product examples, not computed with the implementation's rules.
// True credit approval appears only as a rule-test input, never as a shipped catalogue fixture.
const cases: Case[] = [
  { name: 'age band entirely below minimum', preferences: { ageMin: 14, ageMax: 15 }, expected: 'INELIGIBLE', code: 'AGE_OUTSIDE_RANGE' },
  { name: 'single exact minimum age', preferences: { ageMin: 16, ageMax: 16 }, expected: 'ELIGIBLE' },
  { name: 'band straddles minimum', preferences: { ageMin: 15, ageMax: 17 }, expected: 'INELIGIBLE' },
  { name: 'adult band with no upper restriction', preferences: { ageMin: 18, ageMax: 24 }, expected: 'ELIGIBLE' },
  { name: 'whole band ends at exact maximum', record: { maxAge: 17 }, expected: 'ELIGIBLE' },
  { name: 'band straddles maximum', record: { maxAge: 16 }, expected: 'INELIGIBLE' },
  { name: 'band entirely above maximum', record: { minAge: 12, maxAge: 15 }, expected: 'INELIGIBLE' },
  { name: 'missing minimum remains unknown', record: { minAge: null }, expected: 'NEEDS_CONFIRMATION', code: 'AGE_UNCONFIRMED' },
  { name: 'inverted source age restriction remains unknown', record: { minAge: 18, maxAge: 17 }, expected: 'NEEDS_CONFIRMATION' },
  { name: 'noninteger source minimum remains unknown', record: { minAge: 15.5 }, expected: 'NEEDS_CONFIRMATION' },
  { name: 'age zero does not bypass a minimum', preferences: { ageMin: 0, ageMax: 0 }, expected: 'INELIGIBLE' },
  { name: 'availability equals complete occurrence', preferences: { availableFrom: garden.startsAt, availableUntil: garden.endsAt }, expected: 'ELIGIBLE' },
  { name: 'availability begins one millisecond late', preferences: { availableFrom: new Date(Date.parse(garden.startsAt) + 1).toISOString() }, expected: 'INELIGIBLE', code: 'OUTSIDE_AVAILABILITY' },
  { name: 'availability ends one millisecond early', preferences: { availableUntil: new Date(Date.parse(garden.endsAt) - 1).toISOString() }, expected: 'INELIGIBLE' },
  { name: 'availability begins after occurrence ends', preferences: { availableFrom: '2026-11-01T00:00:00Z' }, expected: 'INELIGIBLE' },
  { name: 'availability ends before occurrence begins', preferences: { availableUntil: '2026-10-20T00:00:00Z' }, expected: 'INELIGIBLE' },
  { name: 'equivalent timezone offsets fully cover occurrence', preferences: { availableFrom: '2026-10-24T12:00:00+02:00', availableUntil: '2026-10-24T14:00:00+02:00' }, expected: 'ELIGIBLE' },
  { name: 'malformed occurrence date cannot match', record: { startsAt: 'not a date' }, expected: 'INELIGIBLE', code: 'INVALID_DATES' },
  { name: 'occurrence cannot match at its exact start', record: { startsAt: now.toISOString() }, expected: 'INELIGIBLE', code: 'OCCURRENCE_STARTED' },
  { name: 'inverted occurrence cannot match', record: { endsAt: garden.startsAt }, expected: 'INELIGIBLE', code: 'INVALID_DATES' },
  { name: 'in-person preference fits in-person occurrence', preferences: { mode: 'IN_PERSON' }, expected: 'ELIGIBLE' },
  { name: 'remote preference excludes in-person occurrence', preferences: { mode: 'REMOTE' }, expected: 'INELIGIBLE', code: 'MODE_MISMATCH' },
  { name: 'remote occurrence fits remote preference', fixture: 'remote', preferences: { mode: 'REMOTE' }, expected: 'ELIGIBLE' },
  { name: 'in-person preference excludes remote occurrence', fixture: 'remote', preferences: { mode: 'IN_PERSON' }, expected: 'INELIGIBLE' },
  { name: 'coarse area comparison ignores casing and outer whitespace', preferences: { area: '  EXAMPLE NEIGHBORHOOD  ' }, expected: 'ELIGIBLE' },
  { name: 'missing student area needs confirmation for in-person work', preferences: { area: '' }, expected: 'NEEDS_CONFIRMATION', code: 'AREA_UNCONFIRMED' },
  { name: 'different coarse area is incompatible', preferences: { area: 'Example riverside' }, expected: 'INELIGIBLE', code: 'AREA_MISMATCH' },
  { name: 'remote work does not require a student area', fixture: 'remote', preferences: { area: '' }, expected: 'ELIGIBLE' },
  { name: 'missing source area needs confirmation for in-person work', record: { area: '' }, expected: 'NEEDS_CONFIRMATION', code: 'LOCATION_UNCONFIRMED' },
  { name: 'free occurrence fits zero budget', expected: 'ELIGIBLE' },
  { name: 'fee exactly equals budget', record: { fee: 5 }, preferences: { maxFee: 5 }, expected: 'ELIGIBLE' },
  { name: 'fee exceeds budget by smallest demonstrated unit', record: { fee: 5.01 }, preferences: { maxFee: 5 }, expected: 'INELIGIBLE', code: 'FEE_OVER_BUDGET' },
  { name: 'unknown fee cannot match a generous budget', record: { fee: null }, preferences: { maxFee: 1000 }, expected: 'NEEDS_CONFIRMATION', code: 'FEE_UNCONFIRMED' },
  { name: 'negative source fee remains unknown', record: { fee: -1 }, expected: 'NEEDS_CONFIRMATION' },
  { name: 'NaN source fee remains unknown', record: { fee: Number.NaN }, expected: 'NEEDS_CONFIRMATION' },
  { name: 'completed training meets stated requirement', record: { requiresTraining: true }, preferences: { hasTraining: true }, expected: 'ELIGIBLE' },
  { name: 'uncompleted required training blocks matching', record: { requiresTraining: true }, expected: 'INELIGIBLE', code: 'TRAINING_REQUIRED' },
  { name: 'unknown training requirement stays unknown even with training', record: { requiresTraining: null }, preferences: { hasTraining: true }, expected: 'NEEDS_CONFIRMATION', code: 'TRAINING_UNCONFIRMED' },
  { name: 'optional training does not disqualify trained student', preferences: { hasTraining: true }, expected: 'ELIGIBLE' },
  { name: 'guardian availability meets stated requirement', record: { requiresGuardian: true }, preferences: { hasGuardian: true }, expected: 'ELIGIBLE' },
  { name: 'unavailable required guardian blocks matching', record: { requiresGuardian: true }, expected: 'INELIGIBLE', code: 'GUARDIAN_REQUIRED' },
  { name: 'unknown guardian requirement stays unknown despite availability', record: { requiresGuardian: null }, preferences: { hasGuardian: true }, expected: 'NEEDS_CONFIRMATION', code: 'GUARDIAN_UNCONFIRMED' },
  { name: 'guardian availability is harmless when not required', preferences: { hasGuardian: true }, expected: 'ELIGIBLE' },
  { name: 'unapproved credit blocks student requiring it', preferences: { requiresSchoolCredit: true }, expected: 'INELIGIBLE', code: 'CREDIT_NOT_APPROVED' },
  { name: 'unknown credit blocks student requiring it', record: { schoolCreditApproved: null }, preferences: { requiresSchoolCredit: true }, expected: 'NEEDS_CONFIRMATION', code: 'CREDIT_UNCONFIRMED' },
  { name: 'explicit credit approval can satisfy future supported input', record: { schoolCreditApproved: true }, preferences: { requiresSchoolCredit: true }, expected: 'ELIGIBLE' },
  { name: 'unknown credit is irrelevant when student does not request it', record: { schoolCreditApproved: null }, expected: 'ELIGIBLE' },
  { name: 'cancelled occurrence is excluded', record: { isCancelled: true }, expected: 'INELIGIBLE', code: 'CANCELLED' },
  { name: 'pending source permission is excluded', record: { source: { ...garden.source, permission: 'PENDING' } }, expected: 'INELIGIBLE', code: 'SOURCE_NOT_APPROVED' },
  { name: 'revoked source permission is excluded', record: { source: { ...garden.source, permission: 'REVOKED' } }, expected: 'INELIGIBLE', code: 'SOURCE_NOT_APPROVED' },
  { name: 'permission without supporting evidence is excluded', record: { source: { ...garden.source, permissionEvidence: '' } }, expected: 'INELIGIBLE' },
  { name: 'listing expires at exact validity boundary', record: { validUntil: now.toISOString() }, expected: 'INELIGIBLE', code: 'EXPIRED' },
  { name: 'one millisecond of remaining validity is still current', record: { validUntil: new Date(now.getTime() + 1).toISOString() }, expected: 'ELIGIBLE' },
  { name: 'listing expired one millisecond ago is excluded', record: { validUntil: new Date(now.getTime() - 1).toISOString() }, expected: 'INELIGIBLE' },
  { name: 'future confirmation is excluded', record: { confirmedAt: '2026-10-18T00:00:00Z' }, expected: 'INELIGIBLE', code: 'INVALID_CONFIRMATION' },
  { name: 'future fetch is excluded', record: { fetchedAt: '2026-10-18T00:00:00Z' }, expected: 'INELIGIBLE', code: 'INVALID_CONFIRMATION' },
  { name: 'source changed after confirmation needs renewed confirmation', record: { sourceUpdatedAt: '2026-10-17T06:00:00Z' }, expected: 'INELIGIBLE', code: 'UNCONFIRMED_CHANGE' },
  { name: 'pantry can include ages14–15 with guardian', fixture: 'pantry', preferences: { ageMin: 14, ageMax: 15, hasGuardian: true }, expected: 'ELIGIBLE' },
  { name: 'pantry excludes otherwise compatible student without guardian', fixture: 'pantry', expected: 'INELIGIBLE', code: 'GUARDIAN_REQUIRED' },
  { name: 'river work fits trained student in its actual coarse area', fixture: 'river-cleanup', preferences: { area: 'Example riverside', hasTraining: true }, expected: 'ELIGIBLE' },
  { name: 'river work excludes trained student in different area', fixture: 'river-cleanup', preferences: { hasTraining: true }, expected: 'INELIGIBLE', code: 'AREA_MISMATCH' },
  { name: 'animal task fits adult with training and exact fee budget', fixture: 'animal-care', preferences: { ageMin: 18, ageMax: 24, hasTraining: true, maxFee: 5 }, expected: 'ELIGIBLE' },
  { name: 'animal task excludes teenager despite training and fee budget', fixture: 'animal-care', preferences: { hasTraining: true, maxFee: 5 }, expected: 'INELIGIBLE', code: 'AGE_OUTSIDE_RANGE' },
  { name: 'arts task fits whole youth band with guardian and fee budget', fixture: 'youth-arts', preferences: { hasGuardian: true, maxFee: 10 }, expected: 'ELIGIBLE' },
  { name: 'arts task excludes a band spanning its upper age limit', fixture: 'youth-arts', preferences: { ageMin: 16, ageMax: 18, hasGuardian: true, maxFee: 10 }, expected: 'INELIGIBLE', code: 'AGE_OUTSIDE_RANGE' },
  { name: 'remote technology task fits trained student without an area', fixture: 'remote-tech', preferences: { area: '', hasTraining: true, mode: 'REMOTE' }, expected: 'ELIGIBLE' },
  { name: 'remote technology task requires training even for remote work', fixture: 'remote-tech', preferences: { area: '', mode: 'REMOTE' }, expected: 'INELIGIBLE', code: 'TRAINING_REQUIRED' },
  { name: 'past reading is never a current match', fixture: 'past-reading', expected: 'INELIGIBLE', code: 'OCCURRENCE_STARTED' },
];


export const EVALUATION_CASE_SET_VERSION = 'high-school-eligibility-v1';
export const EVALUATION_CLOCK = now.toISOString();
export function curatedEvaluationCases() { return cases.map((entry,index)=>({id:`eligibility-${String(index+1).padStart(2,'0')}`,title:entry.name,record:{...structuredClone(fixtures.find(item=>item.fixtureId===(entry.fixture??'garden'))!.record),...entry.record},preferences:{...baseline,...entry.preferences},expected:entry.expected,expectedReason:entry.code??null})); }
