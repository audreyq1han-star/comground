import { getStudentSession, selectStudentPersona, endStudentSession } from '../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getStudentSession;
export const POST = selectStudentPersona;
export const DELETE = endStudentSession;
