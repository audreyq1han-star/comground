import { bindDatabaseMode } from './database-mode.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { createMatchingEvaluationRepository, type MatchingEvaluationRepository } from './matching-evaluation-repository.ts';
const local=globalThis as typeof globalThis & {comgroundMatchingEvaluations?:MatchingEvaluationRepository};
export function matchingEvaluations():MatchingEvaluationRepository {
 if(!local.comgroundMatchingEvaluations){const config=getRuntimeConfig();bindDatabaseMode(config.dbPath,config.mode);local.comgroundMatchingEvaluations=createMatchingEvaluationRepository(config.dbPath);}
 return local.comgroundMatchingEvaluations;
}
