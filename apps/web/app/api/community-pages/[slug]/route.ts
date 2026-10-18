import { distributionHandlers } from '../../../../lib/distribution-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) { return distributionHandlers.getPublicCommunity(request, (await params).slug); }
