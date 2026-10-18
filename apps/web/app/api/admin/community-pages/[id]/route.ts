import { distributionHandlers } from '../../../../../lib/distribution-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return distributionHandlers.patchCommunity(request, (await params).id); }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) { return distributionHandlers.deleteCommunity(request, (await params).id); }
