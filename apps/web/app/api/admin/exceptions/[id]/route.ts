import { updateException } from '../../../../../lib/handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return updateException(request, (await context.params).id);
}
