import { patchStudentActivity } from '../../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return patchStudentActivity(request, (await context.params).id);
}
