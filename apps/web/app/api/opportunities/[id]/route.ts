import { getOpportunity } from '../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return getOpportunity(request, (await context.params).id);
}
