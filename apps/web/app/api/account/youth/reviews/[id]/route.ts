import { decideYouthReview } from '../../../../../../lib/youth-handlers.ts';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return decideYouthReview(request, (await context.params).id); }
