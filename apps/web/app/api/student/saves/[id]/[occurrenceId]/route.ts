import { removeStudentSave } from '../../../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string; occurrenceId: string }> }) {
  const { id, occurrenceId } = await context.params;
  return removeStudentSave(request, id, occurrenceId);
}
