import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Uses a production build and an isolated database. No public network requests.
const directory = await mkdtemp(join(tmpdir(), 'comground-full-http-'));
const filename = join(directory, 'persistent.sqlite');
const base = 'http://127.0.0.1:3104';
const checks = [], logs = [];
let child, reviewerToken = randomBytes(24).toString('base64url');
const actors = { anon: '', operator: '', alex: '', sam: '' };
async function start() {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '3104', '--keepAliveTimeout', '1000'], {
    env: { ...process.env, COMGROUND_MODE: 'demo', LOCAL_REVIEW_TOKEN: reviewerToken, COMGROUND_DB_PATH: filename, NEXT_TELEMETRY_DISABLED: '1', COMGROUND_SKIP_DEMO_SEED: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => logs.push(d.toString())); child.stderr.on('data', d => logs.push(d.toString()));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Production server exited');
    try { if ((await fetch(base + '/api/opportunities')).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Production server readiness timed out');
}
async function stop(signal = 'SIGTERM') {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(signal);
    await Promise.race([ended, delay(15000)]);
    assert(child.exitCode !== null || child.signalCode !== null, 'Server stopped');
  }
}
async function req(path, { actor = 'anon', method = 'GET', body, origin = base, headers = {}, raw } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(actors[actor] ? { cookie: actors[actor] } : {}), ...(method !== 'GET' && origin ? { origin } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: response.status, response, data };
}
function okay(r, expected = 200) { assert.equal(r.status, expected, JSON.stringify(r.data)); return r.data.data; }
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS', name); }
async function login(actor) {
  const isOperator = actor === 'operator';
  const r = await req(isOperator ? '/api/admin/session' : '/api/student/session', { method: 'POST', body: isOperator ? { token: reviewerToken } : { personaId: `demo-${actor}` } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookies = r.response.headers.getSetCookie(); assert(cookies.some(c => /HttpOnly/.test(c) && /SameSite=Strict/.test(c)));
  actors[actor] = cookies.map(c => c.split(';')[0]).join('; '); assert(actors[actor]);
  return r.data;
}
async function admin(path, method = 'GET', body) { return req('/api/admin/' + path, { actor: 'operator', method, body }); }
async function student(actor, path, method = 'GET', body) { return req('/api/student/' + path, { actor, method, body }); }
let garden, profile, pastActivity, currentActivity, source;
try {
  await start();
  await check('Fresh runtime seeds a diverse published synthetic catalogue once', async () => {
    const r = await req('/api/opportunities?limit=50'); okay(r); assert(r.data.total >= 6); garden = r.data.data.find(x => x.title.includes('Community garden')); assert(garden);
    for (const row of r.data.data) { assert.equal(row.isSynthetic, true); assert.equal(row.schoolCreditApproved, false); assert(new URL(row.signupUrl).hostname === 'example.invalid'); }
    const serialized = JSON.stringify(r.data); for (const key of ['permissionEvidence', 'reviewEvents', 'auditEvents', 'externalId']) assert(!serialized.includes(key));
  });
  await check('Unknown demo personas and caller-provided owner identities are rejected', async () => {
    assert.equal((await req('/api/student/session', { method: 'POST', body: { personaId: 'anyone' } })).status, 422);
    assert.equal((await req('/api/student/session', { method: 'POST', body: { personaId: 'demo-alex', ownerId: 'demo-sam' } })).status, 422);
    const options = okay(await req('/api/student/personas')); assert.equal(options.length, 2);
  });
  await check('Private API routes require student sessions and operator routes require reviewer sessions', async () => {
    for (const path of ['profile', 'saves', 'activity', 'export', 'dashboard', 'alerts', 'reminders', 'feedback', 'measurement', 'attribution']) assert.equal((await student('anon', path)).status, 401, path);
    for (const path of ['overview', 'opportunities', 'sources', 'import-runs', 'organizations', 'matching-qa', 'exceptions', 'communities', 'outcomes', 'reports', 'measurement', 'campaigns']) assert.equal((await admin(path)).status, 401, path);
  });
  await check('Cross-origin, missing-origin, malformed JSON and oversized mutations fail closed', async () => {
    const body = { personaId: 'demo-alex' };
    assert.equal((await req('/api/student/session', { method: 'POST', body, origin: 'https://invalid.example' })).status, 403);
    assert.equal((await req('/api/student/session', { method: 'POST', body, origin: '' })).status, 403);
    assert.equal((await req('/api/student/session', { method: 'POST', raw: '{' })).status, 400);
    assert.equal((await req('/api/student/session', { method: 'POST', raw: JSON.stringify({ padding: 'x'.repeat(34000) }) })).status, 413);
  });
  await check('Separate protected cookies establish fixed demo sessions without granting other roles', async () => {
    await login('alex'); await login('sam'); await login('operator');
    assert.notEqual(actors.alex, actors.sam); assert.notEqual(actors.operator, actors.alex);
    assert.equal((await req('/api/admin/outcomes', { actor: 'alex' })).status, 401);
    assert.equal((await student('operator', 'profile')).status, 401);
    assert.equal((await student('alex', 'session')).data.persona.id, 'demo-alex');
    assert.equal(okay(await student('alex', 'profile')), null);
  });
  const prefs = { ageMin: 16, ageMax: 17, availableFrom: new Date(Date.now() - 86400000).toISOString(), availableUntil: new Date(Date.now() + 30 * 86400000).toISOString(), mode: 'ANY', area: garden.area, interests: garden.interests, maxFee: 100, hasTraining: true, hasGuardian: true, requiresSchoolCredit: false };
  await check('Consent and valid minimal preferences are required before persistent onboarding', async () => {
    const body = { expectedVersion: 0, preferences: prefs, goal: 'EXPLORE', storageConsent: true };
    assert.equal((await student('alex', 'profile', 'PUT', { ...body, storageConsent: false })).status, 422);
    assert.equal((await student('alex', 'profile', 'PUT', { ...body, preferences: { ...prefs, availableUntil: prefs.availableFrom } })).status, 422);
    assert.equal((await student('alex', 'profile', 'PUT', { ...body, email: 'should-not-be-stored@example.invalid' })).status, 422);
    profile = okay(await student('alex', 'profile', 'PUT', body)); assert.equal(profile.version, 1); assert.equal(profile.consentVersion, 'local-demo-v1');
    assert.equal(okay(await student('sam', 'profile')), null);
  });
  await check('Profile changes persist with optimistic concurrency and reject stale updates', async () => {
    const body = { expectedVersion: profile.version, preferences: prefs, goal: 'REGULAR', storageConsent: true };
    profile = okay(await student('alex', 'profile', 'PUT', body)); assert.equal(profile.version, 2);
    assert.equal((await student('alex', 'profile', 'PUT', body)).status, 409);
    assert.equal(okay(await student('alex', 'profile')).goal, 'REGULAR');
    assert.equal((await student('alex', 'profile')).response.headers.get('cache-control'), 'no-store');
  });
  await check('Stored matching returns eligible explained opportunities without confidence claims', async () => {
    const r = await student('alex', 'matches', 'POST', {}); okay(r); assert.equal(r.data.engine, 'DETERMINISTIC_RULES'); assert.equal(r.data.profileVersion, profile.version); assert(r.data.data.some(m => m.opportunity.id === garden.id));
    for (const m of r.data.data) { assert.equal(m.eligibility.status, 'ELIGIBLE'); assert(m.reasons.length > 0); }
    assert.equal((await student('alex', 'matches', 'POST', { ownerId: 'demo-sam' })).status, 422);
  });
  await check('An unmet school-credit requirement returns no matches rather than invented approval', async () => {
    const changed = okay(await student('alex', 'profile', 'PUT', { expectedVersion: profile.version, preferences: { ...prefs, requiresSchoolCredit: true }, goal: profile.goal, storageConsent: true }));
    assert.equal((await student('alex', 'matches', 'POST', {})).data.data.length, 0);
    profile = okay(await student('alex', 'profile', 'PUT', { expectedVersion: changed.version, preferences: prefs, goal: changed.goal, storageConsent: true }));
  });
  await check('Public search and combined filters run before pagination and reject invalid ranges', async () => {
    const all = (await req('/api/opportunities?limit=50')).data;
    const filtered = (await req('/api/opportunities?q=garden&limit=1&offset=0')).data; assert.equal(filtered.total, 1); assert.equal(filtered.data[0].id, garden.id);
    const emptyPage = (await req('/api/opportunities?q=garden&limit=1&offset=1')).data; assert.equal(emptyPage.total, 1); assert.equal(emptyPage.data.length, 0);
    const remote = (await req('/api/opportunities?mode=REMOTE&maxFee=0')).data.data; assert(remote.length); assert(remote.every(x => x.mode === 'REMOTE' && x.fee === 0));
    assert(all.total > remote.length);
    for (const query of ['mode=INVALID', 'maxFee=-1', 'from=not-a-date', 'limit=0', 'offset=-1', 'from=2030-02-02&until=2030-02-01']) assert.equal((await req('/api/opportunities?' + query)).status, 400, query);
  });
  await check('Repeated save and removal actions are idempotent and cannot cross personas', async () => {
    okay(await student('alex', 'saves', 'POST', { opportunityId: garden.id })); okay(await student('alex', 'saves', 'POST', { opportunityId: garden.id }));
    assert.equal(okay(await student('alex', 'saves')).length, 1);
    okay(await student('sam', 'profile', 'PUT', { expectedVersion: 0, preferences: prefs, goal: 'EXPLORE', storageConsent: true }));
    assert.equal(okay(await student('sam', 'saves')).length, 0);
    okay(await student('sam', 'saves/' + garden.id, 'DELETE')); assert.equal(okay(await student('alex', 'saves')).length, 1);
    assert.equal((await student('alex', 'saves', 'POST', { opportunityId: garden.id, ownerId: 'demo-sam' })).status, 422);
  });
  await check('Repeated destination previews create one OPENED demo event, never an application', async () => {
    currentActivity = okay(await student('alex', 'handoffs', 'POST', { opportunityId: garden.id }));
    const again = okay(await student('alex', 'handoffs', 'POST', { opportunityId: garden.id }));
    assert.equal(again.id, currentActivity.id); assert.equal(currentActivity.status, 'OPENED'); assert.equal(currentActivity.evidenceKind, 'DEMO_HANDOFF');
    assert.equal(currentActivity.events.length, 1); assert.equal(okay(await student('alex', 'activity')).filter(x => x.opportunityId === garden.id).length, 1);
  });
  await check('Future attendance, forged owners and foreign activity IDs are rejected', async () => {
    assert.equal((await student('alex', 'activity/' + currentActivity.id, 'PATCH', { expectedVersion: currentActivity.version, status: 'ATTENDED' })).status, 422);
    assert.equal((await student('sam', 'activity/' + currentActivity.id, 'PATCH', { expectedVersion: currentActivity.version, status: 'APPLIED' })).status, 404);
    assert.equal((await student('alex', 'activity/' + currentActivity.id, 'PATCH', { expectedVersion: currentActivity.version, status: 'APPLIED', ownerId: 'demo-sam' })).status, 422);
  });
  await check('Application self-reports have append-only versioned history and safe stale conflicts', async () => {
    const oldVersion = currentActivity.version;
    currentActivity = okay(await student('alex', 'activity/' + currentActivity.id, 'PATCH', { expectedVersion: oldVersion, status: 'APPLIED' }));
    assert.equal(currentActivity.evidenceKind, 'SELF_REPORTED'); assert.equal(currentActivity.events.length, 2);
    assert.equal((await student('alex', 'activity/' + currentActivity.id, 'PATCH', { expectedVersion: oldVersion, status: 'WITHDRAWN' })).status, 409);
    assert.equal(okay(await student('sam', 'activity')).filter(x => x.opportunityId === garden.id).length, 0);
  });
  await check('The labeled historical sample supports truthful self-reported attendance after its end', async () => {
    pastActivity = okay(await student('alex', 'activity')).find(x => Date.parse(x.endsAt) < Date.now()); assert(pastActivity); assert.equal(pastActivity.status, 'OPENED');
    pastActivity = okay(await student('alex', 'activity/' + pastActivity.id, 'PATCH', { expectedVersion: pastActivity.version, status: 'ATTENDED' }));
    assert.equal(pastActivity.status, 'ATTENDED'); assert.equal(pastActivity.evidenceKind, 'SELF_REPORTED'); assert.equal(pastActivity.available, false);
  });
  await check('In-app alerts default off and opt-in/read/dismiss/opt-out persist', async () => {
    assert.deepEqual(okay(await student('alex', 'alerts')), { inApp: false, eventReminders: false, catalogueUpdates: false });
    assert.equal(okay(await student('alex', 'reminders')).length, 0);
    okay(await student('alex', 'alerts', 'PUT', { inApp: true, eventReminders: true, catalogueUpdates: true }));
    const reminders = okay(await student('alex', 'reminders')); assert(reminders.length > 0);
    okay(await student('alex', 'reminders/' + reminders[0].id, 'POST', { action: 'READ' }));
    assert.equal(okay(await student('alex', 'reminders')).find(x => x.id === reminders[0].id).read, true);
    okay(await student('alex', 'reminders/' + reminders[0].id, 'POST', { action: 'DISMISS' }));
    okay(await student('alex', 'reminders/' + reminders[0].id, 'POST', { action: 'DISMISS' }));
    assert(!okay(await student('alex', 'reminders')).some(x => x.id === reminders[0].id));
    okay(await student('alex', 'alerts', 'PUT', { inApp: false, eventReminders: true, catalogueUpdates: true })); assert.equal(okay(await student('alex', 'reminders')).length, 0);
  });
  await check('Dashboard and export contain only the signed persona’s current local data', async () => {
    const dashboard = okay(await student('alex', 'dashboard')); assert.equal(dashboard.profile.personaId, 'demo-alex'); assert.equal(dashboard.counts.saved, 1); assert.equal(dashboard.counts.attended, 1);
    const exported = okay(await student('alex', 'export')); assert.equal(exported.schemaVersion, 1); assert.equal(exported.profile.personaId, 'demo-alex'); assert.equal(exported.saved.length, 1);
    assert.equal(okay(await student('sam', 'export')).saved.length, 0);
  });
  await check('Operator outcomes expose aggregates without identities, private preferences or confirmation claims', async () => {
    const outcomes = okay(await admin('outcomes')); assert.equal(outcomes.evidenceLabel, 'Synthetic local self-reports'); assert.equal(outcomes.organizerConfirmed, 0); assert.equal(outcomes.studentIdentitiesIncluded, false); assert(outcomes.applied >= 1); assert(outcomes.attended >= 1);
    const serialized = JSON.stringify(outcomes); for (const secret of ['demo-alex', 'demo-sam', 'ageMin', 'availableFrom', 'preferences']) assert(!serialized.includes(secret));
  });
  await check('Organizations, integrations and matching QA report the actual synthetic local state', async () => {
    const orgs = okay(await admin('organizations')); assert(orgs.length > 1); assert(orgs.every(x => x.verification === 'SYNTHETIC_NOT_VERIFIED'));
    const overview = okay(await admin('overview')); assert.equal(overview.integrations.feeds, 'DEFERRED'); assert.equal(overview.integrations.authentication, 'LOCAL_DEMO'); assert.equal(overview.integrations.ai, 'DETERMINISTIC_RULES'); assert.equal(overview.integrations.emailSms, 'NOT_CONNECTED');
    const qa = okay(await admin('matching-qa')); assert(qa.length >= 4); assert(qa.every(x => x.passed), JSON.stringify(qa));
  });
  await check('Source pause suppresses public discovery, matches, signup actions and imports immediately', async () => {
    const record = okay(await admin('opportunities/' + garden.id)); source = okay(await admin('sources')).find(x => x.id === record.record.source.id); assert(source);
    source = okay(await admin('sources/' + source.id, 'PATCH', { expectedVersion: source.version, paused: true, reason: 'Synthetic acceptance pause' }));
    assert.equal((await req('/api/opportunities/' + garden.id)).status, 404);
    assert(!(await student('alex', 'matches', 'POST', {})).data.data.some(x => x.opportunity.id === garden.id));
    assert([404, 409, 422].includes((await student('alex', 'handoffs', 'POST', { opportunityId: garden.id })).status));
    const pausedImport = await admin('imports', 'POST', { fixtureId: 'garden' }); assert.equal(pausedImport.status, 409); assert.equal(pausedImport.data.error.code, 'SOURCE_PAUSED');
    const saved = okay(await student('alex', 'saves')).find(x => x.opportunityId === garden.id); assert.equal(saved.available, false); assert.equal(saved.opportunity, null);
  });
  await check('Paused sources produce unavailable reminders and cannot be falsely resolved', async () => {
    okay(await student('alex', 'alerts', 'PUT', { inApp: true, eventReminders: true, catalogueUpdates: true }));
    const reminders = okay(await student('alex', 'reminders')); assert(reminders.some(x => x.opportunityId === garden.id && x.kind === 'UNAVAILABLE')); assert(!reminders.some(x => x.opportunityId === garden.id && x.kind === 'UPCOMING'));
    const issue = okay(await admin('exceptions')).find(x => x.kind === 'SOURCE_PAUSED' && x.sourceId === source.id); assert(issue);
    okay(await admin('exceptions/' + encodeURIComponent(issue.id), 'POST', { action: 'ACKNOWLEDGE', reason: 'Synthetic operator investigating' }));
    assert([409, 422].includes((await admin('exceptions/' + encodeURIComponent(issue.id), 'POST', { action: 'RESOLVE', reason: 'Cannot resolve while paused' })).status));
    source = okay(await admin('sources/' + source.id, 'PATCH', { expectedVersion: source.version, paused: false, reason: 'Synthetic test resumed' }));
    okay(await req('/api/opportunities/' + garden.id));
  });
  await check('Invalid catalogue edits fail, material edits return to draft, and stale writes conflict', async () => {
    let record = okay(await admin('opportunities/' + garden.id)); const oldVersion = record.version;
    assert.equal((await admin('opportunities/' + garden.id, 'PATCH', { expectedVersion: record.version, reason: 'Invalid date', changes: { endsAt: '2000-01-01T00:00:00Z' } })).status, 422);
    record = okay(await admin('opportunities/' + garden.id, 'PATCH', { expectedVersion: record.version, reason: 'Synthetic title refinement', changes: { title: 'Community garden morning — revised synthetic example' } }));
    assert.equal(record.status, 'DRAFT'); assert.equal((await req('/api/opportunities/' + garden.id)).status, 404);
    assert.equal((await admin('opportunities/' + garden.id, 'PATCH', { expectedVersion: oldVersion, reason: 'Stale edit', changes: { title: 'Stale' } })).status, 409);
    assert(record.auditEvents.some(x => x.action === 'EDIT' && x.changes.includes('title')));
    record = okay(await admin('reviews', 'POST', { id: record.id, expectedVersion: record.version, decision: 'PUBLISH', reason: 'Reviewed synthetic changed facts' }));
    assert.equal(record.status, 'PUBLISHED');
  });
  await check('Withdrawal removes availability and restoration requires a fresh review', async () => {
    let record = okay(await admin('opportunities/' + garden.id));
    record = okay(await admin('opportunities/' + garden.id + '/actions', 'POST', { expectedVersion: record.version, action: 'WITHDRAW', reason: 'Synthetic withdrawal' }));
    assert.equal(record.effectiveStatus, 'WITHDRAWN'); assert.equal((await req('/api/opportunities/' + garden.id)).status, 404);
    record = okay(await admin('opportunities/' + garden.id + '/actions', 'POST', { expectedVersion: record.version, action: 'RESTORE', reason: 'Restore for synthetic re-review' })); assert.equal(record.status, 'DRAFT'); assert.equal((await req('/api/opportunities/' + garden.id)).status, 404);
    okay(await admin('reviews', 'POST', { id: record.id, expectedVersion: record.version, decision: 'PUBLISH', reason: 'Restored listing reviewed again' }));
  });
  await check('Unknown-age and expired/cancelled records stay blocked, rejection remains private', async () => {
    const rows = okay(await admin('opportunities'));
    for (const external of ['synthetic-missing-age-001', 'synthetic-expired-001', 'synthetic-cancelled-001']) {
      const record = rows.find(x => x.record.externalId === external); assert(record, external);
      assert.equal((await admin('reviews', 'POST', { id: record.id, expectedVersion: record.version, decision: 'PUBLISH', reason: 'This test must remain blocked' })).status, 422);
      assert.equal((await req('/api/opportunities/' + record.id)).status, 404);
    }
    const missing = rows.find(x => x.record.minAge === null); const rejected = okay(await admin('reviews', 'POST', { id: missing.id, expectedVersion: missing.version, decision: 'REJECT', reason: 'Synthetic age evidence is missing' })); assert.equal(rejected.status, 'REJECTED');
  });
  await check('Fixture replay writes immutable import history and preserves record identity', async () => {
    const runs = okay(await admin('import-runs')); const first = await admin('imports', 'POST', { fixtureId: 'remote' }); assert.equal(first.status, 200);
    const second = await admin('imports', 'POST', { fixtureId: 'remote' }); assert.equal(second.status, 200); assert.equal(second.data.created, false); assert.equal(first.data.opportunity.id, second.data.opportunity.id);
    const after = okay(await admin('import-runs')); assert.equal(after.length, runs.length + 2); assert(after.some(x => x.result === 'UNCHANGED')); assert(after.every(x => x.method === 'FIXTURE'));
  });
  await check('Community publication controls affect the public front door without claiming a partner', async () => {
    let community = okay(await admin('communities'))[0]; assert.equal(community.partnerVerified, false); assert.equal(community.isSynthetic, true);
    community = okay(await admin('communities/' + community.slug, 'PATCH', { expectedVersion: community.version, published: false, reason: 'Synthetic front door pause' }));
    assert.equal((await req('/api/communities/' + community.slug)).status, 404);
    community = okay(await admin('communities/' + community.slug, 'PATCH', { expectedVersion: community.version, published: true, reason: 'Synthetic front door resume' }));
    const publicPage = okay(await req('/api/communities/' + community.slug)); assert(publicPage.opportunities.length); assert.equal(publicPage.partnerVerified, false);
  });
  await check('Structured feedback is owned, idempotent and separate from self-reported activity', async () => {
    const before = okay(await student('alex', 'activity'));
    const privateFeedback = okay(await student('alex', 'feedback', 'POST', { opportunityId: garden.id, kind: 'NOT_RELEVANT' }));
    const report = okay(await student('alex', 'feedback', 'POST', { opportunityId: garden.id, kind: 'WRONG_DETAILS' }));
    assert.equal(okay(await student('alex', 'feedback', 'POST', { opportunityId: garden.id, kind: 'WRONG_DETAILS' })).id, report.id);
    assert.equal(okay(await student('alex', 'feedback')).length, 2);
    assert.equal(okay(await student('sam', 'feedback')).length, 0);
    assert.deepEqual(okay(await student('alex', 'activity')), before);
    assert.equal((await student('alex', 'feedback', 'POST', { opportunityId: garden.id, kind: 'WRONG_DETAILS', ownerId: 'demo-sam' })).status, 422);
    assert.equal((await req('/api/admin/reports', { actor: 'alex' })).status, 401);
    const reports = okay(await admin('reports')); assert.equal(reports.length, 1); assert.equal(reports[0].id, report.id);
    const serialized = JSON.stringify(reports); for (const key of ['demo-alex', 'demo-sam', 'personaId', 'preferences', 'NOT_RELEVANT']) assert(!serialized.includes(key));
    assert.equal((await admin('reports/' + privateFeedback.id, 'PATCH', { expectedVersion: privateFeedback.version, reason: 'Cannot resolve private fit feedback' })).status, 404);
    const resolved = okay(await admin('reports/' + report.id, 'PATCH', { expectedVersion: report.version, reason: 'Synthetic source facts inspected and report addressed.' }));
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal((await admin('reports/' + report.id, 'PATCH', { expectedVersion: report.version, reason: 'Stale decision' })).status, 409);
    assert.equal(okay(await student('alex', 'feedback')).find(x => x.id === report.id).resolution, resolved.resolution);
    assert.equal(okay(await student('alex', 'export')).feedback.length, 2);
  });
  let supplyBefore, privateBefore;
  await check('Graceful restart preserves edited supply, audit and private state while invalidating old sessions', async () => {
    supplyBefore = okay(await admin('opportunities')); privateBefore = okay(await student('alex', 'export'));
    await stop(); reviewerToken = randomBytes(24).toString('base64url'); await start();
    assert.equal((await req('/api/admin/opportunities', { actor: 'operator' })).status, 403);
    assert.equal((await student('alex', 'profile')).status, 403);
    await login('operator'); await login('alex');
    assert.deepEqual(okay(await admin('opportunities')), supplyBefore);
    const after = okay(await student('alex', 'export')); assert.deepEqual(after.profile, privateBefore.profile); assert.deepEqual(after.saved, privateBefore.saved); assert.deepEqual(after.activity, privateBefore.activity); assert.deepEqual(after.alerts, privateBefore.alerts); assert.deepEqual(after.reminderStates, privateBefore.reminderStates); assert.deepEqual(after.feedback, privateBefore.feedback);
  });
  await check('Abrupt restart preserves acknowledged writes and does not replay or overwrite the seed', async () => {
    const before = okay(await admin('import-runs')); await stop('SIGKILL'); reviewerToken = randomBytes(24).toString('base64url'); await start(); await login('operator'); await login('alex');
    assert.deepEqual(okay(await admin('opportunities')), supplyBefore); assert.deepEqual(okay(await admin('import-runs')), before);
    assert.deepEqual(okay(await student('alex', 'export')).activity, privateBefore.activity); assert.deepEqual(okay(await student('alex', 'export')).feedback, privateBefore.feedback);
  });
  await check('Confirmed profile deletion removes all owned private data and leaves the other persona intact', async () => {
    await login('sam'); const samBefore = okay(await student('sam', 'export'));
    assert.equal((await student('alex', 'profile', 'DELETE', { confirmation: 'no' })).status, 422);
    okay(await student('alex', 'profile', 'DELETE', { confirmation: 'DELETE' }));
    const after = okay(await student('alex', 'export')); assert.equal(after.profile, null); assert.deepEqual(after.reminderStates, []); assert.deepEqual(after.feedback, []); assert.deepEqual(okay(await admin('reports')), []); assert.equal(after.saved.length, 0); assert.equal(after.activity.length, 0); assert.deepEqual(after.alerts, { inApp: false, eventReminders: false, catalogueUpdates: false });
    assert.deepEqual(okay(await student('sam', 'export')).profile, samBefore.profile); assert.deepEqual(okay(await student('sam', 'export')).activity, samBefore.activity);
    await login('alex'); assert.equal((await student('alex', 'session')).data.profile, null);
  });
  await check('Deleting and recreating a profile cannot revive an old version', async () => {
    const before = okay(await student('sam', 'profile'));
    okay(await student('sam', 'profile', 'DELETE', { confirmation: 'DELETE' }));
    const recreated = okay(await student('sam', 'profile', 'PUT', { expectedVersion: 0, preferences: prefs, goal: 'EXPERIENCE', storageConsent: true }));
    assert(recreated.version > before.version);
    assert.equal((await student('sam', 'profile', 'PUT', { expectedVersion: before.version, preferences: prefs, goal: 'EXPLORE', storageConsent: true })).status, 409);
  });
  await check('Session logout removes access while leaving saved synthetic state available on reselection', async () => {
    okay(await student('sam', 'session', 'DELETE')); actors.sam = ''; assert.equal((await student('sam', 'profile')).status, 401);
    await login('sam'); assert(okay(await student('sam', 'profile')));
    okay(await admin('session', 'DELETE')); actors.operator = ''; assert.equal((await admin('overview')).status, 401);
  });
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/full-app-http.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'Production build; loopback HTTP; isolated database; graceful and abrupt process restarts', checks, limitations: 'Fixed selectable personas are a local demonstration, not production authentication. Process recovery is not a power-loss, backup, or deployment proof.' }, null, 2) + '\n');
  console.log(`Completed ${checks.length} full-app HTTP acceptance groups.`);
} catch (error) { console.error(logs.join('').slice(-5000)); throw error; }
finally { await stop(); await rm(directory, { recursive: true, force: true }); }
