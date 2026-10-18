import { updateCommunity } from '../../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  return updateCommunity(request, (await context.params).slug);
}
