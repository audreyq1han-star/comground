import type { EligibilityResult, FixtureRecord, MatchResult, OpportunityOccurrence, Preferences, PublicOpportunity } from './contracts.ts';

export class DomainError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join(' '));
    this.name = 'DomainError';
    this.issues = [...issues];
  }
}

type ObjectValue = Record<string, unknown>;
const fail = (message: string): never => { throw new DomainError([message]); };
function object(input: unknown, keys: string[], name: string): ObjectValue {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return fail(`${name} must be an object.`);
  const value = input as ObjectValue;
  if (Object.keys(value).some(key => !keys.includes(key))) return fail(`${name} contains unsupported fields.`);
  return value;
}
function text(value: unknown, name: string, max = 160, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) return fail(`${name} must be a bounded text value.`);
  return value.trim();
}
function identifier(value: unknown, name: string): string {
  const result = text(value, name, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result)) return fail(`${name} must be a simple identifier.`);
  return result;
}
function number(value: unknown, name: string, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) return fail(`${name} must be a valid nonnegative number.`);
  return value;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') return fail(`${name} must be true or false.`);
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(`${name} is not a supported value.`);
  return value as T;
}
function list(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 12) return fail(`${name} must contain at most 12 interests.`);
  return [...new Set(value.map(item => text(item, name, 64).toLowerCase()))];
}
function url(value: unknown, name: string): string {
  const result = text(value, name, 1_024);
  let parsed: URL;
  try { parsed = new URL(result); } catch { return fail(`${name} must be a valid synthetic URL.`); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'example.invalid' || parsed.username || parsed.password || parsed.port) return fail(`${name} must use https://example.invalid without credentials or a custom port.`);
  return result;
}
function instant(value: unknown, name: string): string {
  const result = text(value, name, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!match || !Number.isFinite(Date.parse(result))) return fail(`${name} must be an ISO datetime with timezone.`);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (month < 1 || month > 12 || day < 1 || calendar.getUTCMonth() !== month - 1 || hour > 23 || minute > 59 || second > 59) return fail(`${name} must be a real calendar datetime.`);
  return result;
}
const nullableNumber = (value: unknown, name: string, max: number, integer = false) => value === null ? null : number(value, name, max, integer);
const nullableBoolean = (value: unknown, name: string) => value === null ? null : boolean(value, name);

function parseOccurrence(input: unknown): OpportunityOccurrence {
  const value = object(input, ['id','startsAt','endsAt','timezone','validUntil','isCancelled'], 'Occurrence');
  const id = text(value.id, 'Occurrence ID', 40);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(id)) return fail('Occurrence IDs must use 1–40 letters, digits, hyphens or underscores and start with a letter or digit.');
  const result: OpportunityOccurrence = { id, startsAt: instant(value.startsAt, 'Occurrence start'), endsAt: instant(value.endsAt, 'Occurrence end'), timezone: text(value.timezone, 'Occurrence timezone', 80), validUntil: instant(value.validUntil, 'Occurrence validity'), isCancelled: boolean(value.isCancelled, 'Occurrence cancellation') };
  if (Date.parse(result.startsAt) >= Date.parse(result.endsAt)) return fail('Occurrence end must be after its start.');
  try { new Intl.DateTimeFormat('en', { timeZone: result.timezone }); } catch { return fail('Occurrence timezone must be a recognized timezone.'); }
  return result;
}

export function parseFixture(input: unknown): FixtureRecord {
  const value = object(input, ['isSynthetic', 'source', 'organization', 'externalId', 'title', 'summary', 'category', 'interests', 'minAge', 'maxAge', 'startsAt', 'endsAt', 'timezone', 'mode', 'area', 'fee', 'requiresTraining', 'requiresGuardian', 'schoolCreditApproved', 'signupUrl', 'sourceUpdatedAt', 'fetchedAt', 'confirmedAt', 'validUntil', 'isCancelled', 'evidence', 'occurrences'], 'Fixture');
  if (value.isSynthetic !== true) return fail('Only explicitly synthetic fixtures are accepted.');
  const source = object(value.source, ['id', 'name', 'url', 'method', 'permission', 'permissionEvidence'], 'Source');
  const organization = object(value.organization, ['id', 'name', 'url'], 'Organization');
  if (!Array.isArray(value.evidence) || value.evidence.length > 30) return fail('Evidence must be an array of at most 30 excerpts.');
  const evidence = value.evidence.map(item => {
    const row = object(item, ['field', 'excerpt', 'sourceUrl'], 'Evidence');
    return { field: text(row.field, 'Evidence field', 80), excerpt: text(row.excerpt, 'Evidence excerpt', 1_000), sourceUrl: url(row.sourceUrl, 'Evidence URL') };
  });
  const record: FixtureRecord = {
    isSynthetic: true,
    source: { id: identifier(source.id, 'Source ID'), name: text(source.name, 'Source name'), url: url(source.url, 'Source URL'), method: choice(source.method, ['FIXTURE'], 'Source method'), permission: choice(source.permission, ['APPROVED', 'PENDING', 'REVOKED'], 'Source permission'), permissionEvidence: text(source.permissionEvidence, 'Permission evidence', 2_000, true) },
    organization: { id: identifier(organization.id, 'Organization ID'), name: text(organization.name, 'Organization name'), url: url(organization.url, 'Organization URL') },
    externalId: identifier(value.externalId, 'External ID'), title: text(value.title, 'Title'), summary: text(value.summary, 'Summary', 2_000), category: text(value.category, 'Category', 64), interests: list(value.interests, 'Interests'),
    minAge: nullableNumber(value.minAge, 'Minimum age', 120, true), maxAge: nullableNumber(value.maxAge, 'Maximum age', 120, true),
    startsAt: instant(value.startsAt, 'Start'), endsAt: instant(value.endsAt, 'End'), timezone: text(value.timezone, 'Timezone', 80), mode: choice(value.mode, ['IN_PERSON', 'REMOTE'], 'Mode'), area: text(value.area, 'Area', 80, true),
    fee: nullableNumber(value.fee, 'Fee', 100_000), requiresTraining: nullableBoolean(value.requiresTraining, 'Training requirement'), requiresGuardian: nullableBoolean(value.requiresGuardian, 'Guardian requirement'), schoolCreditApproved: nullableBoolean(value.schoolCreditApproved, 'School credit'),
    signupUrl: url(value.signupUrl, 'Signup URL'), sourceUpdatedAt: instant(value.sourceUpdatedAt, 'Source updated'), fetchedAt: instant(value.fetchedAt, 'Fetched'), confirmedAt: instant(value.confirmedAt, 'Confirmed'), validUntil: instant(value.validUntil, 'Validity'), isCancelled: boolean(value.isCancelled, 'Cancellation'), evidence,
  };
  if (value.occurrences !== undefined) {
    if (!Array.isArray(value.occurrences) || value.occurrences.length < 1 || value.occurrences.length > 12) return fail('Provide 1–12 explicit dated occurrences.');
    const occurrences = value.occurrences.map(parseOccurrence);
    if (new Set(occurrences.map(item => item.id)).size !== occurrences.length) return fail('Occurrence IDs must be unique within the opportunity.');
    const primary = occurrences.find(item => item.id === 'primary');
    if (!primary) return fail('Explicit occurrences must retain the primary occurrence.');
    record.occurrences = occurrences;
    // The parent cancellation flag is independent of the primary occurrence.
    record.startsAt = primary.startsAt; record.endsAt = primary.endsAt; record.timezone = primary.timezone; record.validUntil = primary.validUntil;
  }
  if (Date.parse(record.startsAt) >= Date.parse(record.endsAt)) return fail('Occurrence end must be after its start.');
  if (!record.occurrences && Date.parse(record.confirmedAt) >= Date.parse(record.validUntil)) return fail('Validity must extend beyond confirmation.');
  if (record.minAge !== null && record.maxAge !== null && record.minAge > record.maxAge) return fail('Minimum age cannot exceed maximum age.');
  try { new Intl.DateTimeFormat('en', { timeZone: record.timezone }); } catch { return fail('Timezone must be a recognized timezone.'); }
  return record;
}

export const RANKING_POLICY_VERSION = 'local-ranking-v3';
/** Deliberately synthetic coarse-area assumptions. Unknown pairs require confirmation. */
export function syntheticTravelMinutes(from: string, to: string): number | null {
  const a=from.trim().toLowerCase(),b=to.trim().toLowerCase();
  if (!a || !b) return null;
  const places=['example neighborhood','example riverside','example downtown'];
  const i=places.indexOf(a),j=places.indexOf(b);
  if(i<0 || j<0) return null;
  return Math.abs(i-j)*15;
}

export function parsePreferences(input: unknown): Preferences {
  const value = object(input, ['schoolProgramId', 'schoolStage', 'maxTravelMinutes', 'ageMin', 'ageMax', 'availableFrom', 'availableUntil', 'mode', 'area', 'interests', 'maxFee', 'hasTraining', 'hasGuardian', 'requiresSchoolCredit'], 'Preferences');
  const result: Preferences = {
    ageMin: number(value.ageMin, 'Minimum age', 120, true), ageMax: number(value.ageMax, 'Maximum age', 120, true), availableFrom: instant(value.availableFrom, 'Availability start'), availableUntil: instant(value.availableUntil, 'Availability end'), mode: choice(value.mode, ['ANY', 'IN_PERSON', 'REMOTE'], 'Mode'), area: text(value.area, 'Area', 80, true), interests: list(value.interests, 'Interests'), maxFee: number(value.maxFee, 'Maximum fee', 100_000), hasTraining: boolean(value.hasTraining, 'Training'), hasGuardian: boolean(value.hasGuardian, 'Guardian'), requiresSchoolCredit: boolean(value.requiresSchoolCredit, 'School credit'),
  };
  if(value.schoolProgramId!==undefined){const id=text(value.schoolProgramId,'Synthetic program reference',80);if(!/^synthetic:[a-z0-9][a-z0-9._:-]{0,69}$/.test(id))return fail('Use a synthetic: program reference without personal details.');result.schoolProgramId=id;}
  if (value.schoolStage !== undefined) result.schoolStage=choice(value.schoolStage,['HIGH_SCHOOL'] as const,'School stage');
  if (value.maxTravelMinutes !== undefined) result.maxTravelMinutes=number(value.maxTravelMinutes,'Maximum travel minutes',120,true);
  if (result.ageMin > result.ageMax) return fail('Minimum age cannot exceed maximum age.');
  if (Date.parse(result.availableFrom) >= Date.parse(result.availableUntil)) return fail('Availability end must be after its start.');
  return result;
}

type Candidate = FixtureRecord | PublicOpportunity;
export type MatchingContext = {syntheticSchoolProgramApprovals?: readonly string[]};
type RuleIssue = { code: string; reason: string };
const issue = (code: string, reason: string): RuleIssue => ({ code, reason });

/** Compatibility projection: old single-date rows have an explicit stable identity. */
export function occurrenceList(record: Candidate): OpportunityOccurrence[] {
  if (record.occurrences) return record.occurrences.map(item => ({ ...item }));
  return [{ id: 'occurrenceId' in record ? record.occurrenceId ?? 'primary' : 'primary', startsAt: record.startsAt, endsAt: record.endsAt, timezone: record.timezone, validUntil: record.validUntil, isCancelled: 'isCancelled' in record ? record.isCancelled : false }];
}
function dated<T extends Candidate>(record: T, occurrence: OpportunityOccurrence): T {
  return { ...record, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, timezone: occurrence.timezone, validUntil: occurrence.validUntil };
}
export function currentOccurrences(record: Candidate, now: Date): OpportunityOccurrence[] {
  if ('isCancelled' in record && record.isCancelled) return [];
  return occurrenceList(record).filter(item => !item.isCancelled && temporalIssues(dated(record, item), now).length === 0)
    .sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

function temporalIssues(record: Candidate, now: Date): RuleIssue[] {
  const issues: RuleIssue[] = [];
  try {
    for (const field of ['startsAt', 'endsAt', 'fetchedAt', 'confirmedAt', 'validUntil'] as const) instant(record[field], field);
  } catch { return [issue('INVALID_DATES', 'The listing dates need confirmation.')]; }
  const current = now.getTime();
  if (!Number.isFinite(current)) return [issue('INVALID_CLOCK', 'The current time could not be established.')];
  if (Date.parse(record.endsAt) <= Date.parse(record.startsAt)) issues.push(issue('INVALID_DATES', 'The occurrence end must follow its start.'));
  if (Date.parse(record.startsAt) <= current) issues.push(issue('OCCURRENCE_STARTED', 'This occurrence has already started.'));
  if (Date.parse(record.validUntil) <= current) issues.push(issue('EXPIRED', 'The listing needs a fresh confirmation.'));
  if (Date.parse(record.confirmedAt) > current || Date.parse(record.fetchedAt) > current || Date.parse(record.confirmedAt) >= Date.parse(record.validUntil)) issues.push(issue('INVALID_CONFIRMATION', 'The confirmation timestamps are inconsistent.'));
  return issues;
}

function sourceIssues(record: FixtureRecord): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (record.source.permission !== 'APPROVED' || !record.source.permissionEvidence.trim()) issues.push(issue('SOURCE_NOT_APPROVED', 'Source permission with evidence is required.'));
  if (record.isCancelled) issues.push(issue('CANCELLED', 'This occurrence is cancelled.'));
  if (!Number.isFinite(Date.parse(record.sourceUpdatedAt)) || Date.parse(record.sourceUpdatedAt) > Date.parse(record.confirmedAt)) issues.push(issue('UNCONFIRMED_CHANGE', 'Changed source facts need a fresh confirmation.'));
  return issues;
}

function unknownFacts(record: Candidate, requiresSchoolCredit: boolean): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (record.minAge === null || !Number.isInteger(record.minAge) || record.minAge < 0 || record.minAge > 120 || (record.maxAge !== null && (!Number.isInteger(record.maxAge) || record.maxAge < record.minAge || record.maxAge > 120))) issues.push(issue('AGE_UNCONFIRMED', 'The complete age requirement needs confirmation.'));
  if (record.fee === null || !Number.isFinite(record.fee) || record.fee < 0) issues.push(issue('FEE_UNCONFIRMED', 'The fee needs confirmation.'));
  if (typeof record.requiresTraining !== 'boolean') issues.push(issue('TRAINING_UNCONFIRMED', 'The training requirement needs confirmation.'));
  if (typeof record.requiresGuardian !== 'boolean') issues.push(issue('GUARDIAN_UNCONFIRMED', 'The guardian requirement needs confirmation.'));
  if (requiresSchoolCredit && typeof record.schoolCreditApproved !== 'boolean') issues.push(issue('CREDIT_UNCONFIRMED', 'School-credit approval needs confirmation.'));
  if (!['IN_PERSON', 'REMOTE'].includes(record.mode) || (record.mode === 'IN_PERSON' && !record.area.trim())) issues.push(issue('LOCATION_UNCONFIRMED', 'The attendance mode or coarse area needs confirmation.'));
  return issues;
}

export function publicationIssues(record: FixtureRecord, now: Date): string[] {
  try { parseFixture(record); } catch (error) {
    if (error instanceof DomainError) return error.issues;
    throw error;
  }
  const issues = [...sourceIssues(record), ...unknownFacts(record, true)];
  if (currentOccurrences(record, now).length === 0) {
    const dates = occurrenceList(record);
    const timing = dates.flatMap(item => item.isCancelled ? [issue('CANCELLED', 'This occurrence is cancelled.')] : temporalIssues(dated(record, item), now));
    issues.push(...(timing.length ? timing : [issue('NO_CURRENT_DATES', 'No current available occurrence remains.')]));
  }
  if (record.evidence.length === 0) issues.push(issue('MISSING_EVIDENCE', 'At least one source evidence excerpt is required.'));
  return issues.map(item => item.reason);
}

export function isCurrent(record: FixtureRecord, now: Date): boolean {
  return currentOccurrences(record, now).length > 0 && sourceIssues(record).length === 0;
}

function evaluateSingle(record: Candidate, preferences: Preferences, now: Date, occurrence: OpportunityOccurrence, context:MatchingContext={}): EligibilityResult {
  record = dated(record, occurrence);
  const prefs = parsePreferences(preferences);
  const scopedCredit=!!prefs.schoolProgramId&&record.isSynthetic&&'id' in record&&context.syntheticSchoolProgramApprovals?.includes(record.id)===true;
  const unknown = unknownFacts(record, prefs.requiresSchoolCredit&&!scopedCredit);
  if(prefs.requiresSchoolCredit&&prefs.schoolProgramId&&!scopedCredit)unknown.push(issue('PROGRAM_APPROVAL_UNCONFIRMED','A current synthetic review for this program and organizer is required. Real service credit must be confirmed with your school.'));
  if (record.mode === 'IN_PERSON' && !prefs.area) unknown.push(issue('AREA_UNCONFIRMED', 'Choose a coarse area to check an in-person opportunity.'));
  const blocked = temporalIssues(record, now);
  if (occurrence.isCancelled) blocked.push(issue('CANCELLED', 'This occurrence is cancelled.'));
  if ('permission' in record.source) blocked.push(...sourceIssues(record as FixtureRecord));
  if (record.minAge !== null && (prefs.ageMin < record.minAge || (record.maxAge !== null && prefs.ageMax > record.maxAge))) blocked.push(issue('AGE_OUTSIDE_RANGE', 'Your entire selected age band must meet the age requirement.'));
  if (Date.parse(prefs.availableFrom) > Date.parse(record.startsAt) || Date.parse(prefs.availableUntil) < Date.parse(record.endsAt)) blocked.push(issue('OUTSIDE_AVAILABILITY', 'Your availability does not cover the full occurrence.'));
  if (prefs.mode !== 'ANY' && prefs.mode !== record.mode) blocked.push(issue('MODE_MISMATCH', 'This opportunity does not use your selected attendance mode.'));
  if (record.mode === 'IN_PERSON' && prefs.area) {
    if(prefs.maxTravelMinutes !== undefined) {
      const minutes=syntheticTravelMinutes(prefs.area,record.area);
      if(minutes===null) unknown.push(issue('TRAVEL_UNCONFIRMED','Travel time is unknown for these coarse areas; confirm the route before treating this date as suitable.'));
      else if(minutes>prefs.maxTravelMinutes) blocked.push(issue('TRAVEL_OVER_LIMIT','The synthetic travel estimate exceeds your selected limit.'));
    } else if(record.area.trim().toLowerCase() !== prefs.area.toLowerCase()) blocked.push(issue('AREA_MISMATCH', 'This opportunity is outside your selected coarse area.'));
  }
  if (record.fee !== null && record.fee > prefs.maxFee) blocked.push(issue('FEE_OVER_BUDGET', 'The listed fee exceeds your selected budget.'));
  if (record.requiresTraining === true && !prefs.hasTraining) blocked.push(issue('TRAINING_REQUIRED', 'The listing requires training you have not confirmed.'));
  if (record.requiresGuardian === true && !prefs.hasGuardian) blocked.push(issue('GUARDIAN_REQUIRED', 'The listing requires a guardian you have not confirmed.'));
  if (prefs.requiresSchoolCredit && !scopedCredit && !prefs.schoolProgramId && record.schoolCreditApproved === false) blocked.push(issue('CREDIT_NOT_APPROVED', 'This opportunity is not approved for school credit in the example data.'));
  const issues = [...unknown, ...blocked];
  if (issues.length) return { status: unknown.length ? 'NEEDS_CONFIRMATION' : 'INELIGIBLE', reasonCodes: issues.map(item => item.code), reasons: issues.map(item => item.reason) };
  return { status: 'ELIGIBLE', reasonCodes: ['HARD_REQUIREMENTS_MET'], reasons: ['The example listing meets your selected age, availability and participation requirements.',...(scopedCredit?['A synthetic program review covers this organizer and listing. This does not certify real school service credit.']:[])] };
}

export function evaluateEligibility(record: Candidate, preferences: Preferences, now: Date, context:MatchingContext={}): EligibilityResult {
  const occurrences = occurrenceList(record).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const selectedId = 'occurrenceId' in record ? record.occurrenceId : undefined;
  const candidates = selectedId ? occurrences.filter(item=>item.id===selectedId) : occurrences;
  if (!candidates.length) return { status:'INELIGIBLE', reasonCodes:['OCCURRENCE_UNAVAILABLE'], reasons:['The selected date is unavailable. Choose another available date explicitly.'] };
  const results = candidates.map(item => evaluateSingle(record, preferences, now, item, context));
  return results.find(item=>item.status==='ELIGIBLE') ?? results.find(item=>item.status==='NEEDS_CONFIRMATION') ?? results[0];
}

/** Repository supplies only published/current DTOs; dates and hard rules are checked again here. */
export function rankMatches(opportunities: PublicOpportunity[], preferences: Preferences, now: Date, context:MatchingContext={}): MatchResult[] {
  const prefs = parsePreferences(preferences);
  const interests = new Set(prefs.interests);
  const matches: MatchResult[] = [];
  for (const opportunity of opportunities) {
    const dates = occurrenceList(opportunity).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
    const date = dates.find(item => evaluateSingle(opportunity, prefs, now, item, context).status === 'ELIGIBLE');
    if (!date) continue;
    const selected = { ...dated(opportunity, date), occurrenceId: date.id };
    const eligibility = evaluateSingle(selected, prefs, now, date, context);
    const overlap = [...new Set(opportunity.interests.map(value => value.trim().toLowerCase()))].filter(value => interests.has(value)).sort();
    const minutes=opportunity.mode==='REMOTE'?0:syntheticTravelMinutes(prefs.area,opportunity.area);
    const ranking={policyVersion:RANKING_POLICY_VERSION,interest:overlap.length*100,travel:minutes===null?0:Math.max(0,15-Math.floor(minutes/5)),freshness:Math.max(0,10-Math.floor((now.getTime()-Date.parse(opportunity.confirmedAt))/86400000))};
    matches.push({ opportunity: selected, eligibility, ranking, rankScore: ranking.interest+ranking.travel+ranking.freshness, reasons: [
      ...eligibility.reasons,
      `Selected date: ${date.startsAt} (${date.timezone}).`,
      overlap.length ? `Matches your selected interests: ${overlap.join(', ')}.` : 'No selected interest overlaps; it still meets the hard requirements.',
      opportunity.mode === 'REMOTE' ? 'This example can be attended remotely.' : prefs.maxTravelMinutes!==undefined&&minutes!==null ? `Synthetic coarse-area travel estimate: ${minutes} minutes. Check the actual route and supervision before acting.` : `The listed area matches ${prefs.area}; travel time has not been checked.`,
      `Ranking policy ${RANKING_POLICY_VERSION} prioritizes shared interests, then synthetic travel feasibility and recent confirmation; hard requirements always apply.`,
    ] });
  }
  return matches.sort((a, b) => b.rankScore - a.rankScore || Date.parse(a.opportunity.startsAt) - Date.parse(b.opportunity.startsAt) || (a.opportunity.id < b.opportunity.id ? -1 : a.opportunity.id > b.opportunity.id ? 1 : 0));
}
