import { getMatchingEvaluation, patchMatchingEvaluation } from '../../../../../lib/matching-evaluation-handlers.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return getMatchingEvaluation(request,(await context.params).id);}
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return patchMatchingEvaluation(request,(await context.params).id);}
