import type { DatabaseSync } from 'node:sqlite';
import type { StudentOwnerId, StudentProfile } from '../../../packages/domain/app-contracts.ts';
import type { AccountPrivacyConsentInput, StudentPrivacyState } from '../../../packages/domain/privacy-contracts.ts';
import { RepositoryError } from './errors.ts';
import { objectInput } from './http.ts';
import { YOUTH_POLICY_VERSION, type AccountAgeBand } from '../../../packages/domain/youth-contracts.ts';
import { readAccountAge, readYouthAccess } from './youth-repository.ts';

export const ACCOUNT_PRIVACY_VERSION = 'adult-account-v1';
export function isAccountOwner(owner: string): owner is `account-${string}` { return owner.startsWith('account-'); }
export function validateStudentOwner(value: unknown): StudentOwnerId {
  if (value === 'demo-alex' || value === 'demo-sam') return value;
  if (typeof value === 'string' && /^account-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) return value as StudentOwnerId;
  throw new RepositoryError('INVALID_OWNER', 422, 'A valid authenticated student identity is required.');
}
export function accountPrivacyInput(input: unknown, ageBand: AccountAgeBand = 'ADULT'): AccountPrivacyConsentInput {
  const value = objectInput(input, ['policyVersion', 'adultConfirmed', 'personalization', 'aiExplanations']);
  const teen = ageBand === 'TEEN_13_17', policyVersion = teen ? YOUTH_POLICY_VERSION : ACCOUNT_PRIVACY_VERSION;
  if (value.policyVersion !== policyVersion) throw new RepositoryError('PRIVACY_POLICY_REQUIRED', 422, 'Review the current privacy notice for your account age band.');
  if (value.adultConfirmed !== !teen) throw new RepositoryError(teen ? 'INVALID_INPUT' : 'ADULT_COHORT_ONLY', 403, 'The privacy choice must match the account age band.');
  if (typeof value.personalization !== 'boolean') throw new RepositoryError('INVALID_INPUT', 422, 'Choose whether to enable optional personalized matches.');
  if (value.aiExplanations !== undefined && typeof value.aiExplanations !== 'boolean') throw new RepositoryError('INVALID_INPUT', 422, 'Choose whether to enable optional AI explanations.');
  if (teen) {
    if (value.aiExplanations === true) throw new RepositoryError('TEEN_AI_DISABLED', 403, 'External AI explanations are disabled for teen accounts.');
    return { policyVersion: YOUTH_POLICY_VERSION, adultConfirmed: false, personalization: value.personalization, aiExplanations: false };
  }
  return { policyVersion: ACCOUNT_PRIVACY_VERSION, adultConfirmed: true, personalization: value.personalization, aiExplanations: value.aiExplanations === true };
}

export function readPrivacyState(db: DatabaseSync, owner: StudentOwnerId, profile: StudentProfile | null): StudentPrivacyState {
  if (!profile) return { version: 0, profileVersion: null, policyVersion: null, storage: false, adultConfirmed: false, personalization: false, aiExplanations: false, updatedAt: null };
  if (!isAccountOwner(owner)) return { version: profile.version, profileVersion: profile.version, policyVersion: 'local-demo-v1', storage: true, adultConfirmed: false, personalization: true, aiExplanations: false, updatedAt: profile.updatedAt };
  const row = db.prepare('SELECT version,policy_version,adult_confirmed,personalization,ai_explanations,updated_at FROM student_privacy WHERE owner=?').get(owner) as { version: number; policy_version: string; adult_confirmed: number; personalization: number; ai_explanations: number; updated_at: string } | undefined;
  const teen = readAccountAge(db, owner).ageBand === 'TEEN_13_17', policyVersion = teen ? YOUTH_POLICY_VERSION : ACCOUNT_PRIVACY_VERSION;
  const { ageMin, ageMax } = profile.preferences;
  const ageMatches = teen ? Number.isSafeInteger(ageMin) && Number.isSafeInteger(ageMax) && ageMin >= 13 && ageMax <= 17 && ageMin <= ageMax : ageMin >= 18;
  const admitted = !!row && row.policy_version === policyVersion && !!row.adult_confirmed === !teen && profile.consentVersion === policyVersion && ageMatches && (!teen || readYouthAccess(db, owner).admission === 'ADMITTED');
  return { version: row?.version ?? 0, profileVersion: profile.version, policyVersion: row?.policy_version === policyVersion ? policyVersion : null, storage: admitted, adultConfirmed: !!row?.adult_confirmed, personalization: admitted && !!row?.personalization, aiExplanations: !teen && admitted && !!row?.ai_explanations, updatedAt: row?.updated_at ?? null };
}

/** Uses the caller's transaction so profile creation/consent changes are atomic. */
export function createPrivacyStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS student_privacy (
    owner TEXT PRIMARY KEY REFERENCES student_profiles(persona_id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0), policy_version TEXT NOT NULL,
    adult_confirmed INTEGER NOT NULL CHECK(adult_confirmed IN(0,1)),
    personalization INTEGER NOT NULL CHECK(personalization IN(0,1)), ai_explanations INTEGER NOT NULL DEFAULT 0 CHECK(ai_explanations IN(0,1)), updated_at TEXT NOT NULL
  );`);
  function state(owner: StudentOwnerId, profile: StudentProfile | null): StudentPrivacyState { return readPrivacyState(db, owner, profile); }
  function save(owner: StudentOwnerId, consent: AccountPrivacyConsentInput, now: Date): void {
    const checked = accountPrivacyInput(consent, readAccountAge(db, owner).ageBand);
    if (checked.policyVersion === YOUTH_POLICY_VERSION && readYouthAccess(db, owner).admission !== 'ADMITTED') throw new RepositoryError('YOUTH_REVIEW_REQUIRED', 403, 'Current guardian or school review is required before storing teen profile choices.');
    db.prepare(`INSERT INTO student_privacy(owner,version,policy_version,adult_confirmed,personalization,ai_explanations,updated_at) VALUES(?,1,?,?,?,?,?)
      ON CONFLICT(owner) DO UPDATE SET version=version+1,policy_version=excluded.policy_version,adult_confirmed=excluded.adult_confirmed,personalization=excluded.personalization,ai_explanations=excluded.ai_explanations,updated_at=excluded.updated_at`).run(owner, checked.policyVersion, Number(checked.adultConfirmed), Number(checked.personalization), Number(checked.aiExplanations === true), now.toISOString());
  }
  function requireStorage(owner: StudentOwnerId, profile: StudentProfile): void {
    if (!state(owner, profile).storage) throw new RepositoryError('PRIVACY_CONSENT_REQUIRED', 403, 'Review the current privacy notice and account admission before using a private profile.');
  }
  return { state, save, requireStorage };
}
