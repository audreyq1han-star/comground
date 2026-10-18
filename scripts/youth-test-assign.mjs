// Explicit offline assignment for fictional local accounts. Never exposes an HTTP grant.
import { getRuntimeConfig } from '../apps/web/lib/runtime-config.ts';
import { bindDatabaseMode } from '../apps/web/lib/database-mode.ts';
import { createAccountRepository } from '../apps/web/lib/account-repository.ts';

let store;
try {
  const config = getRuntimeConfig();
  if (config.mode !== 'test' || !config.syntheticYouth) throw new Error('Use test mode with COMGROUND_TEST_FIXTURES=1 and a separate synthetic database.');
  const [requestId, reviewerId, ...extra] = process.argv.slice(2);
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  if (extra.length || !new RegExp(`^review-${uuid}$`).test(requestId ?? '') || !new RegExp(`^account-${uuid}$`).test(reviewerId ?? '')) throw new Error('Usage: node scripts/with-local-node.mjs --experimental-strip-types scripts/youth-test-assign.mjs review-UUID account-UUID');
  bindDatabaseMode(config.dbPath, 'test');
  store = createAccountRepository(config.dbPath, { runtimeMode: 'test', syntheticYouthEnabled: true, notificationSink() { throw new Error('This command cannot send messages.'); } });
  const review = store.youth.assignReviewer(requestId, reviewerId);
  console.log(JSON.stringify({ synthetic: true, message: 'Local reviewer assigned. Reload the assigned review inbox.', request: review }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Synthetic reviewer assignment failed.');
  process.exitCode = 1;
} finally { store?.close(); }
