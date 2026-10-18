import { requireReviewer } from './auth.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, readJson } from './http.ts';
import { notifications } from './notification-runtime.ts';
import { requireStudent } from './student-auth.ts';
import { studentResourceId } from './student-repository.ts';
type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action { return async request => { try { assertLoopback(request); if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Notification resources do not accept query parameters.'); return await action(request); } catch (error) { return apiError(error); } }; }
export const getNotificationPreferences = guarded(request => { const owner = requireStudent(request); return jsonResponse({ data: notifications().preferences(owner) }); });
export const putNotificationPreferences = guarded(async request => { assertSameOrigin(request); const input = await readJson(request); const owner = requireStudent(request); return jsonResponse({ data: notifications().setPreferences(owner, input) }); });
export const getOwnedNotifications = guarded(request => { const owner = requireStudent(request); return jsonResponse({ data: notifications().exportData(owner) }); });
export const getNotificationSummary = guarded(request => { requireReviewer(request); return jsonResponse({ data: notifications().summary() }); });
export function patchNotification(request: Request, id: string): Response | Promise<Response> { return guarded(async req => { assertSameOrigin(req); const input = await readJson(req); requireReviewer(req); notifications().cancel(studentResourceId(id), input); return jsonResponse({ data: null }); })(request); }
