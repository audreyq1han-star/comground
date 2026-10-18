import { removeStudentSave } from '../../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return removeStudentSave(request, (await context.params).id);
}
