import { getSafetyReports, postSafetyReport } from '../../../../../lib/safety-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getSafetyReports;
export const POST = postSafetyReport;
