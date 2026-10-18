import { withdrawEvidenceClaim } from '../../../../../../lib/evidence-handlers.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return withdrawEvidenceClaim(request,(await context.params).id);}
