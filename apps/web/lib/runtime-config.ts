import { isAbsolute, resolve } from 'node:path';
import type { RuntimeCapabilities, RuntimeMode } from '../../../packages/domain/runtime-contracts.ts';
import { RepositoryError } from './errors.ts';

export type RuntimeConfiguration = {
  mode: RuntimeMode; origin: string | null; dbPath: string; adultPolicyVersion: 'adult-account-v1' | null; syntheticYouth: boolean;
  notification: { enabled: boolean; key: string | null; from: string | null; outboxKey: string | null; webhookKey: string | null };
  ai: { enabled: boolean; key: string | null; model: string | null };
};
type Environment = Record<string, string | undefined>;
function missing(): never { throw new RepositoryError('CONFIGURATION_MISSING', 503, 'The service is not configured for this operation.'); }
export function isLoopbackHost(host: string): boolean { return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::[1-9][0-9]{0,4})?$/.test(host); }
export function getRuntimeConfig(env: Environment = process.env): RuntimeConfiguration {
  const mode = env.COMGROUND_MODE ?? (env.NODE_ENV === 'production' ? 'production' : 'demo');
  if (mode !== 'demo' && mode !== 'test' && mode !== 'production') return missing();
  let origin: string | null = null;
  if (env.COMGROUND_ORIGIN) {
    try {
      const parsed = new URL(env.COMGROUND_ORIGIN);
      if (parsed.origin !== env.COMGROUND_ORIGIN || parsed.username || parsed.password || !['https:', 'http:'].includes(parsed.protocol)) return missing();
      if (mode === 'production' ? parsed.protocol !== 'https:' || isLoopbackHost(parsed.host) : !isLoopbackHost(parsed.host)) return missing();
      origin = parsed.origin;
    } catch { return missing(); }
  }
  const dbPath = env.COMGROUND_DB_PATH ?? resolve(process.cwd(), '.data/comground.sqlite');
  const outboxKey = env.COMGROUND_OUTBOX_KEY || null;
  if (mode !== 'demo') {
    if (!origin || !env.COMGROUND_DB_PATH || !isAbsolute(dbPath) || !outboxKey || !/^[A-Za-z0-9+/]{43}=$/.test(outboxKey) || Buffer.from(outboxKey, 'base64').length !== 32) return missing();
    if (mode === 'production' && env.COMGROUND_ADULT_POLICY_ACK !== 'adult-account-v1') return missing();
  }
  for (const flag of ['COMGROUND_EMAIL_ENABLED', 'COMGROUND_AI_ENABLED', 'COMGROUND_TEST_FIXTURES']) if (env[flag] && !['0', '1'].includes(env[flag]!)) return missing();
  const emailEnabled = env.COMGROUND_EMAIL_ENABLED === '1';
  const aiEnabled = env.COMGROUND_AI_ENABLED === '1';
  if (mode !== 'production' && (emailEnabled || aiEnabled)) return missing();
  if (mode === 'production' && (env.COMGROUND_TEST_FIXTURES === '1' || env.LOCAL_REVIEW_TOKEN)) return missing();
  const emailKey = emailEnabled ? env.RESEND_API_KEY || null : null;
  const emailFrom = env.COMGROUND_EMAIL_FROM || null;
  if (emailEnabled && (!emailKey || !emailFrom || !/^[^\r\n<>]+@[^\r\n<>]+\.[^\r\n<>]+$/.test(emailFrom))) return missing();
  const aiKey = aiEnabled ? env.OPENAI_API_KEY || null : null;
  const aiModel = aiEnabled ? env.COMGROUND_AI_MODEL || null : null;
  if (aiEnabled && (!aiKey || !aiModel || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(aiModel) || env.COMGROUND_AI_POLICY_ACK !== 'grounded-reasons-v1')) return missing();
  return { mode, origin, dbPath, adultPolicyVersion: mode === 'demo' ? null : 'adult-account-v1', syntheticYouth: mode === 'test' && env.COMGROUND_TEST_FIXTURES === '1', notification: { enabled: emailEnabled, key: emailKey, from: emailFrom, outboxKey, webhookKey: env.COMGROUND_RESEND_WEBHOOK_SECRET || null }, ai: { enabled: aiEnabled, key: aiKey, model: aiModel } };
}
export function publicRuntime(config = getRuntimeConfig()): RuntimeCapabilities {
  return { mode: config.mode, capabilities: { demoPersonas: config.mode === 'demo', accounts: config.mode !== 'demo', emailDelivery: config.notification.enabled, aiExplanations: config.ai.enabled, realFeeds: false, syntheticYouth: config.syntheticYouth, teenEnrollment: false }, admissionPolicy: 'TEEN_AND_ADULT_LOCAL_REVIEW_PENDING_POLICY', catalogue: config.mode === 'production' ? 'EMPTY_PENDING_FEEDS' : 'SYNTHETIC_DEMO' };
}
