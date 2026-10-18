import { getStudentFeedback, postStudentFeedback } from '../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getStudentFeedback;
export const POST = postStudentFeedback;
