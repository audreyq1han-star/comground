import { getSession, login, logout } from '../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = getSession;
export const POST = login;
export const DELETE = logout;
