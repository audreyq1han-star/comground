import { DatabaseSync } from 'node:sqlite';
import { createEvidenceStore, type EvidenceStore } from './evidence-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { repository } from './runtime.ts';
import { students } from './student-runtime.ts';
import { RepositoryError } from './errors.ts';
const retained=globalThis as typeof globalThis&{comgroundEvidence?:{path:string;db:DatabaseSync;store:EvidenceStore}};
export function evidence():EvidenceStore {
  const config=getRuntimeConfig();
  if(retained.comgroundEvidence&&retained.comgroundEvidence.path!==config.dbPath)throw new RepositoryError('EVIDENCE_CONFIGURATION_CHANGED',503,'Restart after changing evidence storage configuration.');
  if(!retained.comgroundEvidence){const supply=repository();students();const db=new DatabaseSync(config.dbPath);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');try{retained.comgroundEvidence={path:config.dbPath,db,store:createEvidenceStore(db,supply,{allowDemo:config.mode==='demo',syntheticEnabled:config.mode==='demo'||config.mode==='test'&&process.env.COMGROUND_TEST_FIXTURES==='1'})};}catch(error){db.close();throw error;}}
  return retained.comgroundEvidence.store;
}
