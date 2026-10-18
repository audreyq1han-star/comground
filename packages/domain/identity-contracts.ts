import type { SafetyExport } from './safety-contracts.ts';
export type AccountId = `account-${string}`;
export type AccountRole = 'STUDENT' | 'OPERATOR';
export type Account = { id: AccountId; email: string; role: AccountRole; emailVerified: boolean; adultConfirmed: boolean; ageBand: AccountAgeBand; admission: AccountAdmission; synthetic: boolean; createdAt: string };
export type AccountSession = { authenticated: boolean; account: Account | null; expiresAt: string | null; recentAuthUntil: string | null };
export type AccountSessionSummary = { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
export type AccountAuthAction = 'login' | 'VERIFY_EMAIL' | 'RESET_PASSWORD' | 'confirm-verification' | 'reset-password' | 'reauthenticate' | 'change-password';
export type AccountIdentityExport = { account: Account; verification: { emailVerifiedAt: string | null; adultAttestedAt: string | null; ageAttestedAt: string | null }; youth: YouthExport; sessions: AccountSessionSummary[]; securityEvents: { kind: string; at: string }[]; authenticationLimits: { action: AccountAuthAction; count: number; resetsAt: string }[] };
export type AccountExport = { schemaVersion: 1; exportedAt: string; identity: AccountIdentityExport; student: StudentExport | null; notifications: NotificationExport; safety:SafetyExport; aiUsage: { day: string; count: number; lastAt: string } | null };
export type AccountRetentionPolicy = { unverifiedDays: number; securityEventDays: number };
/** Proposed maintenance policy: must be approved before a live service enables scheduled cleanup. */
export const DEFAULT_ACCOUNT_RETENTION_POLICY: AccountRetentionPolicy = { unverifiedDays: 30, securityEventDays: 90 };
export type RegisterAccountInput = { email: string; password: string; adultConfirmed: true; ageBand?: 'ADULT' } | { email: string; password: string; ageBand: 'TEEN_13_17'; synthetic: true };
export type LoginAccountInput = { email: string; password: string };
export type GenericAccountResponse = { accepted: true; message: string };
export type AccountNotificationPurpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
/** Server-only transactional handoff. Never return this payload from an API. */
export type IdentityNotification = { purpose: AccountNotificationPurpose; accountId: AccountId; email: string; token: string; expiresAt: string };
export const ACCOUNT_GENERIC_MESSAGE = 'If this address can receive the requested account message, instructions will be sent. Check your inbox.';
export const EMPTY_ACCOUNT_SESSION: AccountSession = { authenticated: false, account: null, expiresAt: null, recentAuthUntil: null };
import type { StudentExport } from './app-contracts.ts';
import type { NotificationExport } from './notification-contracts.ts';
import type { AccountAgeBand, AccountAdmission, YouthExport } from './youth-contracts.ts';
