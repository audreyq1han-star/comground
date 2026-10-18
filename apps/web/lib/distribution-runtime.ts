import { DatabaseSync } from 'node:sqlite';
import { createCommunityStore, type CommunityStore } from './community-repository.ts';
import { createDistributionStore, type DistributionStore } from './distribution-repository.ts';
import { RepositoryError } from './errors.ts';
import { notificationOwner } from './notification-repository.ts';
import { notifications } from './notification-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { repository } from './runtime.ts';
import { students } from './student-runtime.ts';

const retained = globalThis as typeof globalThis & { comgroundDistribution?: { path: string; db: DatabaseSync; store: DistributionStore; community: CommunityStore } };
function runtimeStores() {
  const config = getRuntimeConfig();
  if (retained.comgroundDistribution && retained.comgroundDistribution.path !== config.dbPath) throw new RepositoryError('DISTRIBUTION_CONFIGURATION_CHANGED', 503, 'Restart after changing distribution storage configuration.');
  if (!retained.comgroundDistribution) {
    const studentStore = students(), supply = repository();
    const db = new DatabaseSync(config.dbPath); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    try {
      const store = createDistributionStore(db, {
        owner: id => { const account = notificationOwner(db, id); return { exists: account.exists, profileVersion: account.profileVersion, externalEligible: account.exists && account.verified && account.adult && account.student && !account.demo && account.optionalConsentCurrent }; },
        matches: (id, now) => { const result = studentStore.matches(id as Parameters<typeof studentStore.matches>[0], now); return config.mode === 'production' ? { ...result, data: result.data.filter(item => !item.opportunity.isSynthetic) } : result; },
        enqueue: (owner, reference, now) => notifications().enqueueDigest(owner, reference, now),
      });
      retained.comgroundDistribution = { path: config.dbPath, db, store, community: createCommunityStore(db, { opportunities: now => supply.listPublic({ limit: 50 }, now).data, mutationsEnabled: config.mode !== 'production' }) };
    } catch (error) { db.close(); throw error; }
  }
  return retained.comgroundDistribution;
}
export function distribution(): DistributionStore { return runtimeStores().store; }
export function communities(): CommunityStore { return runtimeStores().community; }
