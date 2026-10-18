import { patchCampaign } from '../../../../../lib/measurement-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return patchCampaign(request, (await params).id); }
