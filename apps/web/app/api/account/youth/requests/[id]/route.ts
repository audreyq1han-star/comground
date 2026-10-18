import { withdrawYouthReview } from '../../../../../../lib/youth-handlers.ts';
export const runtime = 'nodejs';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return withdrawYouthReview(request, (await context.params).id); }
