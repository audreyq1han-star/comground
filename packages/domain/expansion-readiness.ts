export const EXPANSION_GATES = {
  admission: 'High-school admission and consent',
  safeguarding: 'Safeguarding and escalation capacity',
  supply: 'Permissioned supply and listing quality',
  pilotEvidence: 'Cohort outcomes and evidence quality',
  operations: 'Operator workload and support capacity',
  security: 'Security, edge limits and current dependency review',
  recovery: 'Backup custody and witnessed restore drill',
  ownerApproval: 'Accountable owner and policy approval',
} as const;
export type ExpansionGate = keyof typeof EXPANSION_GATES;
type GateReview = { status: 'UNKNOWN' | 'BLOCKED' | 'PASSED'; evidence: string[]; reviewedBy: string | null; reviewedAt: string | null };
export type ExpansionReview = {
  format: 'comground-expansion-review-v1'; version: number; previousReview: string | null;
  recordedAt: string | null; validUntil: string | null;
  scope: { stage: 'HIGH_SCHOOL'; geography: string | null; cohort: string | null; ageBands: ('TEEN_13_17' | 'ADULT_HIGH_SCHOOL')[] };
  release: { commit: string | null; imageDigest: string | null };
  gates: Record<ExpansionGate, GateReview>;
  decision: { requested: 'NO_GO' | 'GO'; reference: string | null };
};
export type ExpansionEvaluation = { decision: 'NO_GO' | 'GO'; blockers: string[]; record: ExpansionReview | null; evaluatedAt: string; productionTeenAdmission: false };

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f<>]/.test(value); }
const optionalText = (value: unknown) => value === null || text(value);
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
const optionalInstant = (value: unknown) => value === null || instant(value);
function validRecord(value: unknown): value is ExpansionReview {
  if (!object(value, ['format', 'version', 'previousReview', 'recordedAt', 'validUntil', 'scope', 'release', 'gates', 'decision']) || value.format !== 'comground-expansion-review-v1' || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !optionalText(value.previousReview) || !optionalInstant(value.recordedAt) || !optionalInstant(value.validUntil)) return false;
  const { scope, release, gates, decision } = value;
  if (!object(scope, ['stage', 'geography', 'cohort', 'ageBands']) || scope.stage !== 'HIGH_SCHOOL' || !optionalText(scope.geography) || !optionalText(scope.cohort) || !Array.isArray(scope.ageBands) || !scope.ageBands.length || scope.ageBands.length > 2 || new Set(scope.ageBands).size !== scope.ageBands.length || scope.ageBands.some(band => !['TEEN_13_17', 'ADULT_HIGH_SCHOOL'].includes(band))) return false;
  if (!object(release, ['commit', 'imageDigest']) || !(release.commit === null || (typeof release.commit === 'string' && /^[a-f0-9]{40}$/.test(release.commit))) || !(release.imageDigest === null || (typeof release.imageDigest === 'string' && /^sha256:[a-f0-9]{64}$/.test(release.imageDigest)))) return false;
  if (!object(decision, ['requested', 'reference']) || !['NO_GO', 'GO'].includes(String(decision.requested)) || !optionalText(decision.reference) || !object(gates, Object.keys(EXPANSION_GATES))) return false;
  return Object.values(gates).every(gate => object(gate, ['status', 'evidence', 'reviewedBy', 'reviewedAt']) && ['UNKNOWN', 'BLOCKED', 'PASSED'].includes(String(gate.status)) && Array.isArray(gate.evidence) && gate.evidence.length <= 10 && gate.evidence.every(text) && optionalText(gate.reviewedBy) && optionalInstant(gate.reviewedAt));
}

/** Checks a declared review record, never verifies external evidence or authorizes deployment. */
export function evaluateExpansionReview(input: unknown, now = new Date()): ExpansionEvaluation {
  const base = { evaluatedAt: now.toISOString(), productionTeenAdmission: false as const };
  if (!validRecord(input)) return { ...base, decision: 'NO_GO', record: null, blockers: ['The expansion review record is malformed or unsupported.'] };
  const record = input, blockers: string[] = [];
  if (record.version > 1 && !record.previousReview) blockers.push('Link the previous version of this review.');
  if (!record.scope.geography || !record.scope.cohort) blockers.push('Name the high-school geography and cohort.');
  if (record.scope.ageBands.includes('TEEN_13_17')) blockers.push('Production teen admission remains unavailable in this release.');
  if (!record.release.commit || !record.release.imageDigest) blockers.push('Identify the reviewed commit and immutable image digest.');
  if (!record.recordedAt || Date.parse(record.recordedAt) > now.getTime()) blockers.push('Record a valid review time at or before this check.');
  if (!record.validUntil || Date.parse(record.validUntil) <= now.getTime() || (record.recordedAt && Date.parse(record.validUntil) <= Date.parse(record.recordedAt))) blockers.push('The review needs a future expiry after its recorded time.');
  for (const [key, label] of Object.entries(EXPANSION_GATES)) {
    const gate = record.gates[key as ExpansionGate];
    if (gate.status !== 'PASSED') blockers.push(`${label}: ${gate.status.toLowerCase()}.`);
    else if (!gate.evidence.length || !gate.reviewedBy || !gate.reviewedAt || !record.recordedAt || Date.parse(gate.reviewedAt) > Date.parse(record.recordedAt)) blockers.push(`${label}: evidence, reviewer reference and prior review time are required.`);
  }
  if (record.decision.requested !== 'GO') blockers.push('The recorded decision is no go.');
  if (!record.decision.reference) blockers.push('An accountable decision reference is required.');
  return { ...base, record, blockers, decision: blockers.length ? 'NO_GO' : 'GO' };
}
