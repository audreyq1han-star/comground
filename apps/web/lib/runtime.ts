import { getRuntimeConfig } from './runtime-config.ts';
import { bindDatabaseMode } from './database-mode.ts';
import { createRepository, type Repository } from './repository.ts';
import { fixtureList } from '../../../packages/domain/fixtures.ts';

const globalRepository = globalThis as typeof globalThis & { comgroundRepository?: Repository; comgroundFixtureEpoch?: Date };
export function repository(): Repository {
  // The launcher supplies an absolute location. Global retention prevents dev hot reload from opening new handles.
  if (!globalRepository.comgroundRepository) {
    const config = getRuntimeConfig();
    bindDatabaseMode(config.dbPath, config.mode);
    const instance = createRepository(config.dbPath, { seedExamples: config.mode !== 'production', requireSourcePermission:config.mode==='production' });
    try { if (config.mode !== 'production' && process.env.COMGROUND_SKIP_DEMO_SEED !== '1' && (config.mode === 'demo' || process.env.COMGROUND_TEST_FIXTURES === '1')) instance.seedDemo(fixtureList(fixtureEpoch()), fixtureEpoch()); }
    catch (error) { instance.close(); throw error; }
    globalRepository.comgroundRepository = instance;
  }
  return globalRepository.comgroundRepository;
}
export function fixtureEpoch(): Date {
  // Fixed within one process: importing a fixture twice must not alter its fetchedAt timestamps.
  return globalRepository.comgroundFixtureEpoch ??= new Date();
}
