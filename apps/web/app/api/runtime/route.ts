import { apiError, assertLoopback, jsonResponse } from '../../../lib/http.ts';
import { publicRuntime } from '../../../lib/runtime-config.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request): Response { try { assertLoopback(request); return jsonResponse(publicRuntime()); } catch (error) { return apiError(error); } }
