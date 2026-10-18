import { deleteSafetyReport } from '../../../../../../lib/safety-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return deleteSafetyReport(request, (await context.params).id);
}
