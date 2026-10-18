import { requireReviewer } from './auth.ts';
import { RepositoryError } from './errors.ts';
import { apiError, assertLoopback, assertSameOrigin, jsonResponse, objectInput, readJson } from './http.ts';
import { clearStudentCookie, createStudentCookie, DEMO_PERSONAS, persona, requireStudent, studentIdentity } from './student-auth.ts';
import { studentOccurrenceId, studentResourceId } from './student-repository.ts';
import { students } from './student-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { accountSession, accountSessionToken, clearAccountCookie, requireAccount } from './account-auth.ts';
import { accounts } from './account-runtime.ts';

type Action = (request: Request) => Response | Promise<Response>;
function guarded(action: Action): Action {
  return async request => {
    try {
      assertLoopback(request);
      if (new URL(request.url).search) throw new RepositoryError('INVALID_QUERY', 400, 'Student resources do not accept query parameters.');
      return await action(request);
    } catch (error) { return apiError(error); }
  };
}
function requireDemo(): void {
  if (getRuntimeConfig().mode !== 'demo') throw new RepositoryError('DEMO_DISABLED', 404, 'Fictional personas are unavailable in account mode.');
}
export const listStudentPersonas = guarded(() => { requireDemo(); return jsonResponse({ data: DEMO_PERSONAS }); });
export const getStudentSession = guarded(request => {
  if (getRuntimeConfig().mode !== 'demo') {
    const state = accountSession(request), account = state.account;
    return jsonResponse({ authenticated: state.authenticated, account, persona: null, profile: account?.role === 'STUDENT' && account.emailVerified && account.admission==='ADMITTED' ? students().getProfile(account.id) : null }, 200, state.authenticated ? undefined : { 'set-cookie': clearAccountCookie() });
  }
  const id = studentIdentity(request);
  return jsonResponse({ authenticated: !!id, account: null, persona: id ? persona(id) : null, profile: id ? students().getProfile(id) : null }, 200, id ? undefined : { 'set-cookie': clearStudentCookie(request) });
});
export const selectStudentPersona = guarded(async request => {
  assertSameOrigin(request);
  requireDemo();
  const input = objectInput(await readJson(request), ['personaId']);
  const selected = persona(input.personaId);
  return jsonResponse({ authenticated: true, account: null, persona: selected, profile: students().getProfile(selected.id) }, 200, { 'set-cookie': createStudentCookie(request, selected.id) });
});
export const endStudentSession = guarded(request => {
  assertSameOrigin(request);
  if (getRuntimeConfig().mode !== 'demo') {
    accounts().logout(accountSessionToken(request));
    return jsonResponse({ authenticated: false, account: null, persona: null, profile: null }, 200, { 'set-cookie': clearAccountCookie() });
  }
  return jsonResponse({ authenticated: false, account: null, persona: null, profile: null }, 200, { 'set-cookie': clearStudentCookie(request) });
});
export const getStudentProfile = guarded(request => jsonResponse({ data: students().getProfile(requireStudent(request)) }));
export const putStudentProfile = guarded(async request => {
  assertSameOrigin(request);
  const input = await readJson(request), owner = requireStudent(request);
  return jsonResponse({ data: students().saveProfile(owner, input) });
});
export const deleteStudentProfile = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['confirmation', 'expectedProfileVersion']);
  const owner = getRuntimeConfig().mode==='demo' ? requireStudent(request) : requireAccount(request,{role:'STUDENT',verified:true,recent:true,allowPendingYouth:true}).id;
  if (input.confirmation !== 'DELETE') throw new RepositoryError('CONFIRMATION_REQUIRED', 422, 'Confirm DELETE to withdraw storage consent and remove this profile and its private records.');
  if (input.expectedProfileVersion !== undefined && (typeof input.expectedProfileVersion !== 'number' || !Number.isSafeInteger(input.expectedProfileVersion))) throw new RepositoryError('INVALID_INPUT', 422, 'Provide the current profile version.');
  students().deleteProfile(owner, input.expectedProfileVersion as number | undefined);
  return jsonResponse({ data: null });
});
export const exportStudentData = guarded(request => {
  const owner = requireStudent(request);
  if (getRuntimeConfig().mode !== 'demo') requireAccount(request, { role: 'STUDENT', verified: true, recent: true });
  return jsonResponse({ data: students().exportData(owner) });
});
export const getStudentPrivacy = guarded(request => jsonResponse({ data: students().getPrivacy(getRuntimeConfig().mode==='demo'?requireStudent(request):requireAccount(request,{role:'STUDENT',verified:true,allowPendingYouth:true}).id) }));
export const putStudentPrivacy = guarded(async request => {
  assertSameOrigin(request); const input = await readJson(request), owner = requireStudent(request);
  return jsonResponse({ data: students().updatePrivacy(owner, input) });
});
export const getStudentDashboard = guarded(request => jsonResponse({ data: students().dashboard(requireStudent(request)) }));
export const getStudentMatches = guarded(async request => {
  assertSameOrigin(request);
  objectInput(await readJson(request), []);
  const owner = requireStudent(request);
  return jsonResponse(students().matches(owner));
});
export const getStudentSaves = guarded(request => jsonResponse({ data: students().listSaves(requireStudent(request)) }));
export const addStudentSave = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['opportunityId', 'occurrenceId']), owner = requireStudent(request);
  return jsonResponse({ data: students().saveOpportunity(owner, studentResourceId(input.opportunityId), new Date(), studentOccurrenceId(input.occurrenceId)) });
});
export function removeStudentSave(request: Request, id: string, occurrenceId = 'primary'): Promise<Response> | Response {
  return guarded(req => { assertSameOrigin(req); students().removeSave(requireStudent(req), studentResourceId(id), studentOccurrenceId(occurrenceId)); return jsonResponse({ data: null }); })(request);
}
export const getStudentActivity = guarded(request => jsonResponse({ data: students().listActivity(requireStudent(request)) }));
export const createStudentHandoff = guarded(async request => {
  assertSameOrigin(request);
  const input = objectInput(await readJson(request), ['opportunityId', 'occurrenceId']), owner = requireStudent(request);
  return jsonResponse({ data: students().handoff(owner, studentResourceId(input.opportunityId), new Date(), studentOccurrenceId(input.occurrenceId)) });
});
export function patchStudentActivity(request: Request, id: string): Promise<Response> | Response {
  return guarded(async req => { assertSameOrigin(req); const input = await readJson(req), owner = requireStudent(req); return jsonResponse({ data: students().updateActivity(owner, studentResourceId(id), input) }); })(request);
}
export const getStudentAlerts = guarded(request => jsonResponse({ data: students().getAlerts(requireStudent(request)) }));
export const putStudentAlerts = guarded(async request => {
  assertSameOrigin(request); const input = await readJson(request), owner = requireStudent(request);
  return jsonResponse({ data: students().setAlerts(owner, input) });
});
export const getStudentReminders = guarded(request => jsonResponse({ data: students().listReminders(requireStudent(request)) }));
export function actOnStudentReminder(request: Request, id: string): Promise<Response> | Response {
  return guarded(async req => {
    assertSameOrigin(req); const input = objectInput(await readJson(req), ['action']), owner = requireStudent(req);
    return jsonResponse({ data: students().updateReminder(owner, studentResourceId(id), input.action) });
  })(request);
}
export const getStudentOutcomes = guarded(request => { requireReviewer(request); return jsonResponse({ data: students().outcomes() }); });

export const getStudentFeedback = guarded(request => jsonResponse({ data: students().listFeedback(requireStudent(request)) }));
export const postStudentFeedback = guarded(async request => {
  assertSameOrigin(request);
  const input = await readJson(request), owner = requireStudent(request);
  return jsonResponse({ data: students().submitFeedback(owner, input) });
});
export const getOperatorReports = guarded(request => {
  requireReviewer(request);
  return jsonResponse({ data: students().listReports() });
});
export function patchOperatorReport(request: Request, id: string): Promise<Response> | Response {
  return guarded(async req => {
    assertSameOrigin(req); const input = await readJson(req); requireReviewer(req);
    return jsonResponse({ data: students().resolveReport(studentResourceId(id), input) });
  })(request);
}
