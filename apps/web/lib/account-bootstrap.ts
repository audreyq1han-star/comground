import { pathToFileURL } from 'node:url';
import { bindDatabaseMode } from './database-mode.ts';
import { createAccountRepository } from './account-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';

/** Explicit operator operation only. Does not create accounts or deliver messages. */
export function bootstrapFirstOperator(accountId: string): void {
  const config=getRuntimeConfig();
  if(config.mode==='demo')throw new Error('Operator account bootstrap is unavailable in demo mode.');
  if(!/^account-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(accountId))throw new Error('Supply the existing verified adult account ID.');
  bindDatabaseMode(config.dbPath,config.mode);
  const store=createAccountRepository(config.dbPath,{notificationSink:()=>{throw new Error('Bootstrap cannot send account notifications.');}});
  try{store.bootstrapOperator(accountId);}finally{store.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const args=process.argv.slice(2);
    if(args.length!==4 || args[0]!=='--account-id' || args[2]!=='--confirm' || args[3]!=='PROMOTE_FIRST_OPERATOR')throw new Error('Usage: account-bootstrap.ts --account-id account-UUID --confirm PROMOTE_FIRST_OPERATOR');
    bootstrapFirstOperator(args[1]);
    process.stdout.write('First operator role granted. Prior sessions were revoked; sign in again.\n');
  }catch(error){process.stderr.write(`${error instanceof Error?error.message:'Operator bootstrap failed.'}\n`);process.exitCode=1;}
}
