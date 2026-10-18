import { actOnStudentReminder } from '../../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return actOnStudentReminder(request, (await context.params).id);
}
