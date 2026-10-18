import { patchOperatorSafetyReport } from '../../../../../../lib/safety-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return patchOperatorSafetyReport(request, (await context.params).id);
}
