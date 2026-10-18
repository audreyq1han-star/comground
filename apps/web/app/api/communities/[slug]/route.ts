import { getCommunity } from '../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return getCommunity(request, (await context.params).slug);
}
