import { patchNotification } from '../../../../../lib/notification-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return patchNotification(request, (await params).id); }
