import { patchOperatorReport } from '../../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return patchOperatorReport(request, (await context.params).id);
}
