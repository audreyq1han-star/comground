import { getAdminOpportunity, editAdminOpportunity } from '../../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return getAdminOpportunity(request, (await context.params).id);
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return editAdminOpportunity(request, (await context.params).id);
}
