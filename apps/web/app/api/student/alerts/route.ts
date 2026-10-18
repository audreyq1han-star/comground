import { getStudentAlerts, putStudentAlerts } from '../../../../lib/student-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getStudentAlerts;
export const PUT = putStudentAlerts;
