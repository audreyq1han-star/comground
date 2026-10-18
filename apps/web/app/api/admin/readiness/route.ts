import record from '../../../../../../deploy/expansion-readiness.json' with { type: 'json' };
import { evaluateExpansionReview } from '../../../../../../packages/domain/expansion-readiness.ts';
import { requireReviewer } from '../../../../lib/auth.ts';
import { apiError, jsonResponse } from '../../../../lib/http.ts';
import { RepositoryError } from '../../../../lib/errors.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request): Response {
  try {
    requireReviewer(request);
    if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Expansion review does not accept query parameters.');
    return jsonResponse({ data: evaluateExpansionReview(record) });
  } catch (error) { return apiError(error); }
}
