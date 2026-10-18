import { getAccountSession, loginAccount, logoutAccount } from '../../../../lib/account-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getAccountSession;
export const POST = loginAccount;
export const DELETE = logoutAccount;
