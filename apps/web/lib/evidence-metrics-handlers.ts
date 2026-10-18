import { DatabaseSync } from 'node:sqlite';
import { requireReviewer } from './auth.ts';
import { apiError,assertLoopback,jsonResponse } from './http.ts';
import { RepositoryError } from './errors.ts';
import { evidence } from './evidence-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { readEvidenceMetrics } from './evidence-metrics-repository.ts';
export function getEvidenceMetrics(request:Request):Response {
 try{assertLoopback(request);if(new URL(request.url).search)throw new RepositoryError('INVALID_QUERY',400,'Evidence metrics do not accept query parameters.');requireReviewer(request);evidence();const config=getRuntimeConfig(),db=new DatabaseSync(config.dbPath,{readOnly:true});try{return jsonResponse({data:readEvidenceMetrics(db,new Date(),{allowDemo:config.mode==='demo'})});}finally{db.close();}}
 catch(error){return apiError(error);}
}
