import { createAccountRepository, type AccountRepository } from './account-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { enqueueAccountNotification } from './notification-runtime.ts';
import { deleteAccountStudentData, exportAccountStudentData } from './student-repository.ts';
import { exportOwnerNotifications } from './notification-repository.ts';
import { repository } from './runtime.ts';
import { RepositoryError } from './errors.ts';
import { bindDatabaseMode } from './database-mode.ts';

const retained = globalThis as typeof globalThis & { comgroundAccountRepository?: { path: string; mode: string; syntheticYouth: boolean; repository: AccountRepository } };
export function accounts(): AccountRepository {
  const config = getRuntimeConfig();
  if (config.mode === 'demo') throw new RepositoryError('ACCOUNT_UNAVAILABLE',503,'Durable accounts are unavailable in demo mode.');
  if (!config.origin || !config.notification.outboxKey) throw new RepositoryError('ACCOUNT_UNAVAILABLE',503,'Account access is not configured.');
  if (retained.comgroundAccountRepository && (retained.comgroundAccountRepository.path !== config.dbPath || retained.comgroundAccountRepository.mode !== config.mode || retained.comgroundAccountRepository.syntheticYouth !== config.syntheticYouth)) throw new RepositoryError('ACCOUNT_UNAVAILABLE',503,'Restart after changing account storage configuration.');
  if (!retained.comgroundAccountRepository) {
    bindDatabaseMode(config.dbPath,config.mode);
    // Public schema initialization must precede the private export transaction.
    const supply=repository();
    retained.comgroundAccountRepository = { path:config.dbPath,mode:config.mode,syntheticYouth:config.syntheticYouth,repository:createAccountRepository(config.dbPath,{
    runtimeMode:config.mode,syntheticYouthEnabled:config.syntheticYouth,
    notificationSink:enqueueAccountNotification,
    beforeDelete:(db,id)=>deleteAccountStudentData(db,id),
    exportPrivateData:(db,id,now)=>({student:exportAccountStudentData(db,id,supply,now),notifications:exportOwnerNotifications(db,id,now)}),
    }) };
  }
  return retained.comgroundAccountRepository.repository;
}
