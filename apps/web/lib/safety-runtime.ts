import { getRuntimeConfig } from './runtime-config.ts';
import { accounts } from './account-runtime.ts';
import { repository } from './runtime.ts';
import { createSafetyRepository, type SafetyRepository } from './safety-repository.ts';
import { RepositoryError } from './errors.ts';

const retained = globalThis as typeof globalThis & { comgroundSafetyRepository?: { path: string; mode: string; repository: SafetyRepository } };
export function safety(): SafetyRepository {
  const config = getRuntimeConfig();
  if (config.mode === 'demo') throw new RepositoryError('ACCOUNT_REQUIRED', 403, 'Private safety reporting requires a verified account. Shared demo personas cannot create private safety reports.');
  accounts();
  if (retained.comgroundSafetyRepository && (retained.comgroundSafetyRepository.path !== config.dbPath || retained.comgroundSafetyRepository.mode !== config.mode)) throw new RepositoryError('SAFETY_UNAVAILABLE', 503, 'Restart after changing private report storage.');
  return (retained.comgroundSafetyRepository ??= { path: config.dbPath, mode: config.mode, repository: createSafetyRepository(config.dbPath, repository()) }).repository;
}
