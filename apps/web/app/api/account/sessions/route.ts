import { listAccountSessions, revokeAllAccountSessions } from '../../../../lib/account-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = listAccountSessions;
export const DELETE = revokeAllAccountSessions;
