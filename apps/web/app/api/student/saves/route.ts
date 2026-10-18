import { getStudentSaves, addStudentSave } from '../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getStudentSaves;
export const POST = addStudentSave;
