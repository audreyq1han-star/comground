import { actOnOpportunity } from '../../../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return actOnOpportunity(request, (await context.params).id);
}
