import { revokeAccountSession } from '../../../../../lib/account-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { return revokeAccountSession(request, (await context.params).id); }
