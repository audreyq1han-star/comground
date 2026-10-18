import { distributionHandlers } from '../../../../../lib/distribution-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { return distributionHandlers.getBatch(request, (await params).id); }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) { return distributionHandlers.patchBatch(request, (await params).id); }
