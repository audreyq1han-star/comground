import { distributionHandlers } from '../../../../lib/distribution-handlers.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = distributionHandlers.getCommunities;
export const POST = distributionHandlers.postCommunity;
