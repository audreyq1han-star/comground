import { patchFailedFit } from '../../../../../../lib/evidence-handlers.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return patchFailedFit(request,(await context.params).id);}
