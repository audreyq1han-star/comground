import { getRuntimeConfig } from './runtime-config.ts';
import { accounts } from './account-runtime.ts';
import { repository } from './runtime.ts';
import { createSourceControlRepository, type SourceControlRepository } from './source-control-repository.ts';
import { RepositoryError } from './errors.ts';
const retained=globalThis as typeof globalThis&{comgroundSourceControl?:{path:string;mode:string;repository:SourceControlRepository}};
export function sourceControl():SourceControlRepository {const config=getRuntimeConfig();if(config.mode==='demo')throw new RepositoryError('ACCOUNT_REQUIRED',403,'Source operations require a verified operator account.');accounts();repository();if(retained.comgroundSourceControl&&(retained.comgroundSourceControl.path!==config.dbPath||retained.comgroundSourceControl.mode!==config.mode))throw new RepositoryError('SOURCE_CONTROL_UNAVAILABLE',503,'Restart after changing source control storage.');return(retained.comgroundSourceControl??={path:config.dbPath,mode:config.mode,repository:createSourceControlRepository(config.dbPath)}).repository;}
