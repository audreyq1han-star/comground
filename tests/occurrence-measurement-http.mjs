import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Independent acceptance against an existing production build and a disposable database.
const directory = await mkdtemp(join(tmpdir(), 'comground-occurrence-http-'));
const filename = join(directory, 'acceptance.sqlite');
const base = 'http://127.0.0.1:3108';
const checks = [], logs = [];
const actors = { anon: '', operator: '', alex: '', sam: '' };
let child, reviewerToken = randomBytes(24).toString('base64url');

async function start() {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '3108', '--keepAliveTimeout', '1000'], {
    env: { ...process.env, COMGROUND_MODE: 'demo', LOCAL_REVIEW_TOKEN: reviewerToken, COMGROUND_DB_PATH: filename, NEXT_TELEMETRY_DISABLED: '1', COMGROUND_SKIP_DEMO_SEED: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', value => logs.push(value.toString()));
  child.stderr.on('data', value => logs.push(value.toString()));
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Isolated production server exited');
    try { if ((await fetch(base + '/api/opportunities')).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Isolated production server did not become ready');
}
async function stop(signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  child.kill(signal);
  await Promise.race([ended, delay(15000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
}
async function req(path, { actor = 'anon', method = 'GET', body, origin = base, raw, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method, headers: { ...(actors[actor] ? { cookie: actors[actor] } : {}), ...(method !== 'GET' && origin ? { origin } : {}), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const bodyText = await response.text();
  let data; try { data = JSON.parse(bodyText); } catch { data = { raw: bodyText.slice(0, 200) }; }
  return { status: response.status, data, response };
}
function okay(response, expected = 200) { assert.equal(response.status, expected, JSON.stringify(response.data)); return response.data.data; }
function rejected(response, statuses = [400, 403, 404, 409, 422]) { assert(statuses.includes(response.status), `Expected rejection: ${JSON.stringify(response)}`); assert(response.data.error?.code); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS', name); }
const student = (actor, path, method = 'GET', body) => req('/api/student/' + path, { actor, method, body });
const admin = (path, method = 'GET', body) => req('/api/admin/' + path, { actor: 'operator', method, body });
async function login(actor) {
  const response = await req(actor === 'operator' ? '/api/admin/session' : '/api/student/session', { method: 'POST', body: actor === 'operator' ? { token: reviewerToken } : { personaId: `demo-${actor}` } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  actors[actor] = response.response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  assert(actors[actor]);
}
async function publish(record) {
  return okay(await admin('reviews', 'POST', { id: record.id, expectedVersion: record.version, decision: 'PUBLISH', reason: 'Independent synthetic occurrence acceptance: inspect the explicit dates and requirements.' }));
}
async function editDates(record, occurrences) {
  return okay(await admin(`opportunities/${record.id}`, 'PATCH', { expectedVersion: record.version, reason: 'Independent synthetic occurrence change.', changes: { occurrences } }));
}
function noPrivateFields(value) {
  const prohibited = new Set(['personaId', 'ownerId', 'owner', 'preferences', 'ageMin', 'ageMax', 'availableFrom', 'availableUntil', 'interests', 'exposures', 'presentationToken', 'requestId', 'profileVersion']);
  function inspect(node) { if (!node || typeof node !== 'object') return; for (const [key, childValue] of Object.entries(node)) { assert(!prohibited.has(key), `Operator projection leaked ${key}`); inspect(childValue); } }
  inspect(value);
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('demo-alex') && !serialized.includes('demo-sam'));
}

let series, profile, samProfile, primaryActivity, secondActivity, secondDate, initialDates;
let measuredExposure, firstCampaign, campaigns;
try {
  await start();
  await login('operator'); await login('alex'); await login('sam');
  await check('A manually imported recurring fixture has three stable dates and requires publication review', async () => {
    const imported = await admin('imports', 'POST', { fixtureId: 'garden-series' });
    assert([200, 201].includes(imported.status), JSON.stringify(imported.data));
    series = imported.data.opportunity;
    assert.equal(series.status, 'DRAFT');
    assert.equal(series.record.occurrences.length, 3);
    assert.deepEqual(series.record.occurrences.map(item => item.id), ['primary', 'week-2', 'week-3']);
    initialDates = structuredClone(series.record.occurrences);
    rejected(await req(`/api/opportunities/${series.id}?occurrence=week-2`), [404]);
    series = await publish(series);
    const current = okay(await req(`/api/opportunities/${series.id}?occurrence=week-2`));
    assert.equal(current.occurrenceId, 'week-2'); assert.equal(current.occurrences.length, 3);
    assert.equal(current.startsAt, initialDates[1].startsAt);
    secondDate = initialDates[1];
  });
  await check('Date selection is exact and date filters choose an occurrence before parent pagination', async () => {
    rejected(await req(`/api/opportunities/${series.id}?occurrence=missing-date`), [404]);
    for (const query of ['occurrence=', 'occurrence=primary&occurrence=week-2', 'occurrence=week-2&occurrence=week-2']) rejected(await req(`/api/opportunities/${series.id}?${query}`));
    const other = okay(await req('/api/opportunities?limit=50')).find(item => item.id !== series.id);
    rejected(await req(`/api/opportunities/${other.id}?occurrence=week-2`), [404]);
    const result = await req(`/api/opportunities?q=Weekly%20garden&from=${encodeURIComponent(secondDate.startsAt)}&until=${encodeURIComponent(secondDate.endsAt)}&limit=1`);
    const found = okay(result); assert.equal(result.data.total, 1); assert.equal(found.length, 1);
    assert.equal(found[0].id, series.id); assert.equal(found[0].occurrenceId, 'week-2');
  });
  await check('Persisted date IDs cannot be removed or renamed and invalid transitions leave the reviewed record unchanged', async () => {
    const removed = series.record.occurrences.filter(item => item.id !== 'week-2');
    const renamed = series.record.occurrences.map(item => item.id === 'week-2' ? { ...item, id: 'replacement-week-2' } : item);
    for (const occurrences of [removed, renamed]) {
      rejected(await admin(`opportunities/${series.id}`, 'PATCH', { expectedVersion: series.version, reason: 'Exercise stable dated identity rejection.', changes: { occurrences } }), [422]);
      const unchanged = okay(await admin(`opportunities/${series.id}`));
      assert.equal(unchanged.version, series.version); assert.equal(unchanged.status, 'PUBLISHED');
      assert.deepEqual(unchanged.record.occurrences, series.record.occurrences);
    }
  });
  const broadPreferences = { ageMin: 16, ageMax: 17, availableFrom: new Date(Date.now() - 86400000).toISOString(), availableUntil: new Date(Date.parse(initialDates[2].endsAt) + 86400000).toISOString(), mode: 'ANY', area: 'Example neighborhood', interests: ['outdoors'], maxFee: 0, hasTraining: false, hasGuardian: false, requiresSchoolCredit: false };
  await check('Consented profiles retain default-off measurement and signed role boundaries', async () => {
    profile = okay(await student('alex', 'profile', 'PUT', { expectedVersion: 0, preferences: broadPreferences, goal: 'EXPLORE', storageConsent: true }));
    samProfile = okay(await student('sam', 'profile', 'PUT', { expectedVersion: 0, preferences: broadPreferences, goal: 'EXPLORE', storageConsent: true }));
    assert.equal(okay(await student('alex', 'export')).measurement.consent.enabled, false);
    assert.equal(okay(await student('alex', 'export')).measurement.exposures.length, 0);
  });
  await check('Saves and handoffs are independently idempotent for two dates and reject forged references', async () => {
    for (const occurrenceId of ['primary', 'week-2']) {
      const body = { opportunityId: series.id, occurrenceId };
      await Promise.all([student('alex', 'saves', 'POST', body), student('alex', 'saves', 'POST', body)]).then(results => results.forEach(response => okay(response)));
      const opened = okay(await student('alex', 'handoffs', 'POST', body));
      const duplicate = okay(await student('alex', 'handoffs', 'POST', body));
      assert.equal(opened.id, duplicate.id); assert.equal(opened.status, 'OPENED'); assert.equal(opened.occurrenceId, occurrenceId);
      if (occurrenceId === 'primary') primaryActivity = opened; else secondActivity = opened;
    }
    assert.notEqual(primaryActivity.id, secondActivity.id);
    const saves = okay(await student('alex', 'saves')).filter(item => item.opportunityId === series.id);
    assert.deepEqual(saves.map(item => item.occurrenceId).sort(), ['primary', 'week-2']);
    assert.equal(okay(await student('sam', 'saves')).length, 0);
    rejected(await student('sam', `activity/${secondActivity.id}`, 'PATCH', { expectedVersion: secondActivity.version, status: 'APPLIED' }), [404]);
    rejected(await student('alex', 'saves', 'POST', { opportunityId: series.id, occurrenceId: 'unknown' }));
    rejected(await student('alex', 'handoffs', 'POST', { opportunityId: series.id, occurrenceId: 'unknown' }));
    rejected(await student('alex', 'saves', 'POST', { opportunityId: series.id, occurrenceId: 'week-2', ownerId: 'demo-sam' }));
    rejected(await student('alex', `activity/${secondActivity.id}`, 'PATCH', { expectedVersion: secondActivity.version, status: 'ATTENDED' }), [422]);
  });
  await check('Reminders and factual reports retain exact dates and one dismissal cannot suppress its sibling', async () => {
    okay(await student('alex', 'alerts', 'PUT', { inApp: true, eventReminders: true, catalogueUpdates: true }));
    const reminders = okay(await student('alex', 'reminders')).filter(item => item.opportunityId === series.id && item.kind === 'UPCOMING');
    assert.equal(reminders.length, 2);
    assert.equal(new Set(reminders.map(item => item.id)).size, 2);
    const second = reminders.find(item => item.occurrenceId === 'week-2'); assert(second);
    assert(new URL(second.href, base).searchParams.get('occurrence') === 'week-2');
    okay(await student('alex', `reminders/${encodeURIComponent(second.id)}`, 'POST', { action: 'DISMISS' }));
    okay(await student('alex', `reminders/${encodeURIComponent(second.id)}`, 'POST', { action: 'DISMISS' }));
    const remaining = okay(await student('alex', 'reminders')).filter(item => item.opportunityId === series.id && item.kind === 'UPCOMING');
    assert.deepEqual(remaining.map(item => item.occurrenceId), ['primary']);
    for (const occurrenceId of ['primary', 'week-2']) okay(await student('alex', 'feedback', 'POST', { opportunityId: series.id, occurrenceId, kind: 'WRONG_DETAILS' }));
    const reports = okay(await admin('reports')).filter(item => item.opportunityId === series.id);
    assert.deepEqual(reports.map(item => item.occurrenceId).sort(), ['primary', 'week-2']);
    noPrivateFields(reports);
  });
  await check('Reviewed rescheduling updates only its pending occurrence and stale edits conflict', async () => {
    const prior = series.version;
    const occurrences = structuredClone(series.record.occurrences);
    occurrences[1].startsAt = new Date(Date.parse(occurrences[1].startsAt) + 3600000).toISOString();
    occurrences[1].endsAt = new Date(Date.parse(occurrences[1].endsAt) + 3600000).toISOString();
    series = await editDates(series, occurrences); assert.equal(series.status, 'DRAFT');
    assert.equal(okay(await student('alex', 'activity')).find(item => item.id === secondActivity.id).startsAt, initialDates[1].startsAt);
    rejected(await admin(`opportunities/${series.id}`, 'PATCH', { expectedVersion: prior, reason: 'Stale synthetic edit', changes: { occurrences } }), [409]);
    rejected(await student('alex', 'handoffs', 'POST', { opportunityId: series.id, occurrenceId: 'week-2' }));
    series = await publish(series); secondDate = occurrences[1];
    const activity = okay(await student('alex', 'activity'));
    assert.equal(activity.find(item => item.id === secondActivity.id).startsAt, secondDate.startsAt);
    assert.equal(activity.find(item => item.id === primaryActivity.id).startsAt, initialDates[0].startsAt);
    assert(series.revisions.some(revision => revision.before?.occurrences?.[1].startsAt === initialDates[1].startsAt && revision.after.occurrences?.[1].startsAt === secondDate.startsAt));
  });
  await check('Cancelling the primary date preserves reviewed active siblings and exact unavailable saves', async () => {
    const occurrences = structuredClone(series.record.occurrences); occurrences[0].isCancelled = true;
    series = await editDates(series, occurrences);
    const retained = okay(await student('alex', 'saves')).find(item => item.opportunityId === series.id && item.occurrenceId === 'week-2');
    assert.equal(retained.available, false); assert.equal(retained.opportunity, null); assert.equal(retained.startsAt, secondDate.startsAt);
    series = await publish(series);
    rejected(await req(`/api/opportunities/${series.id}?occurrence=primary`), [404]);
    const sibling = okay(await req(`/api/opportunities/${series.id}?occurrence=week-2`)); assert.equal(sibling.occurrenceId, 'week-2');
    const parent = okay(await req(`/api/opportunities/${series.id}`)); assert.equal(parent.occurrenceId, 'week-2');
    const saved = okay(await student('alex', 'saves')).filter(item => item.opportunityId === series.id);
    assert.equal(saved.find(item => item.occurrenceId === 'primary').available, false);
    assert.equal(saved.find(item => item.occurrenceId === 'week-2').available, true);
    assert(okay(await student('alex', 'reminders')).some(item => item.opportunityId === series.id && item.occurrenceId === 'primary' && item.kind === 'UNAVAILABLE'));
    okay(await student('alex', `saves/${series.id}/primary`, 'DELETE'));
    assert.equal(okay(await student('alex', 'saves')).filter(item => item.opportunityId === series.id).length, 1);
  });
  await check('Full-interval matching selects the second date once and source pause suppresses the series', async () => {
    profile = okay(await student('alex', 'profile', 'PUT', { expectedVersion: profile.version, preferences: { ...broadPreferences, availableFrom: secondDate.startsAt, availableUntil: secondDate.endsAt }, goal: 'EXPLORE', storageConsent: true }));
    const matches = await student('alex', 'matches', 'POST', {}); assert.equal(matches.status, 200);
    assert.equal(new Set(matches.data.data.map(item => item.opportunity.id)).size, matches.data.data.length);
    assert.equal(matches.data.data.find(item => item.opportunity.id === series.id).opportunity.occurrenceId, 'week-2');
    let source = okay(await admin('sources')).find(item => item.id === series.record.source.id);
    source = okay(await admin(`sources/${source.id}`, 'PATCH', { expectedVersion: source.version, paused: true, reason: 'Independent synthetic series pause' }));
    rejected(await req(`/api/opportunities/${series.id}?occurrence=week-2`), [404]);
    assert(!okay(await student('alex', 'reminders')).some(item => item.opportunityId === series.id && item.kind === 'UPCOMING'));
    rejected(await student('alex', 'handoffs', 'POST', { opportunityId: series.id, occurrenceId: 'week-2' }));
    okay(await admin(`sources/${source.id}`, 'PATCH', { expectedVersion: source.version, paused: false, reason: 'Independent synthetic series resumed' }));
    okay(await req(`/api/opportunities/${series.id}?occurrence=week-2`));
  });

  await check('Measurement, attribution and campaign APIs enforce the signed role and mutation boundaries', async () => {
    for (const path of ['/api/student/measurement', '/api/student/attribution']) {
      rejected(await req(path), [401, 403]); rejected(await req(path, { actor: 'operator' }), [401, 403]);
    }
    for (const path of ['/api/admin/campaigns', '/api/admin/measurement']) {
      rejected(await req(path), [401, 403]); rejected(await req(path, { actor: 'alex' }), [401, 403]);
    }
    rejected(await req('/api/student/measurement', { actor: 'alex', method: 'PUT', body: { expectedVersion: 0, expectedProfileVersion: profile.version, enabled: true }, origin: 'https://example.invalid' }), [403]);
    rejected(await student('alex', 'recommendations', 'POST', { requestId: randomUUID(), ownerId: 'demo-sam' }));
    const publicCampaigns = okay(await req('/api/campaigns')); noPrivateFields(publicCampaigns);
    assert(publicCampaigns.some(item => item.id === 'demo-school-club'));
    assert(publicCampaigns.some(item => item.id === 'demo-community'));
    for (const campaign of publicCampaigns) { assert.equal(campaign.isSynthetic, true); assert.equal(campaign.paused, false); assert(new URL(campaign.path, base).origin === base); }
  });
  await check('Default-off measurement does not track reads, unconsented recommendations or campaign visits', async () => {
    const consent = okay(await student('alex', 'measurement')); assert.equal(consent.enabled, false);
    const response = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() });
    assert.equal(response.status, 200); assert.equal(response.data.measurementEnabled, false); assert.equal(response.data.presentationToken, null);
    assert(response.data.data.some(item => item.opportunity.id === series.id));
    okay(await student('alex', 'dashboard')); await student('alex', 'matches', 'POST', {});
    rejected(await student('alex', 'attribution', 'POST', { campaignId: 'demo-school-club' }), [403]);
    const measurement = okay(await student('alex', 'export')).measurement;
    assert.equal(measurement.attribution, null); assert.equal(measurement.exposures.length, 0); assert.equal(measurement.feedback.length, 0);
    rejected(await student('alex', 'measurement', 'PUT', { expectedVersion: consent.version, expectedProfileVersion: profile.version - 1, enabled: true }), [409]);
  });
  await check('Explicit measurement consent and valid first touch persist without accepting arbitrary campaigns', async () => {
    let consent = okay(await student('alex', 'measurement'));
    consent = okay(await student('alex', 'measurement', 'PUT', { expectedVersion: consent.version, expectedProfileVersion: profile.version, enabled: true }));
    assert.equal(consent.enabled, true); assert.equal(consent.retentionDays, 90); assert(consent.consentedAt);
    rejected(await student('alex', 'attribution', 'POST', { campaignId: 'https://example.invalid/arbitrary?email=forbidden' }));
    rejected(await student('alex', 'attribution', 'POST', { campaignId: 'demo-school-club', ownerId: 'demo-sam' }));
    firstCampaign = okay(await student('alex', 'attribution', 'POST', { campaignId: 'demo-school-club' }));
    assert.equal(firstCampaign.campaignId, 'demo-school-club');
    const later = okay(await student('alex', 'attribution', 'POST', { campaignId: 'demo-community' }));
    assert.deepEqual(later, firstCampaign);
    campaigns = okay(await admin('campaigns')); noPrivateFields(campaigns);
  });
  await check('A presentation request is uncounted until acknowledgement; forged, foreign and stale tokens fail', async () => {
    const response = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() });
    assert.equal(response.status, 200); assert(response.data.presentationToken); assert(response.data.rulesVersion);
    assert.equal(okay(await student('alex', 'export')).measurement.exposures.length, 0);
    rejected(await student('sam', 'recommendations/exposures', 'POST', { presentationToken: response.data.presentationToken }));
    rejected(await student('alex', 'recommendations/exposures', 'POST', { presentationToken: response.data.presentationToken + 'tampered' }));
    profile = okay(await student('alex', 'profile', 'PUT', { expectedVersion: profile.version, preferences: profile.preferences, goal: 'EXPERIENCE', storageConsent: true }));
    rejected(await student('alex', 'recommendations/exposures', 'POST', { presentationToken: response.data.presentationToken }), [409]);
    assert.equal(okay(await student('alex', 'export')).measurement.exposures.length, 0);
  });
  await check('Acknowledged exposure preserves exact occurrence references and repeated acknowledgements are idempotent', async () => {
    const response = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() }); assert.equal(response.status, 200);
    const tokenBody = { presentationToken: response.data.presentationToken };
    const acknowledgements = await Promise.all([student('alex', 'recommendations/exposures', 'POST', tokenBody), student('alex', 'recommendations/exposures', 'POST', tokenBody)]);
    measuredExposure = okay(acknowledgements[0]); assert.equal(okay(acknowledgements[1]).id, measuredExposure.id);
    assert.equal(measuredExposure.campaignId, 'demo-school-club'); assert.equal(measuredExposure.profileVersion, profile.version);
    assert(measuredExposure.items.some(item => item.opportunityId === series.id && item.occurrenceId === 'week-2'));
    assert.equal(Date.parse(measuredExposure.observationEndsAt) - Date.parse(measuredExposure.presentedAt), 7 * 86400000);
    okay(await student('alex', 'dashboard')); await student('alex', 'matches', 'POST', {}); await student('alex', 'session');
    const exported = okay(await student('alex', 'export')).measurement;
    assert.equal(exported.exposures.length, 1); assert.equal(exported.feedback.length, 0);
    assert(!JSON.stringify(exported.exposures).includes('ageMin')); assert(!JSON.stringify(exported.exposures).includes('interests'));
  });
  await check('Relevance is private, exact, owner-bound, retry-safe and independent of application state', async () => {
    const input = { exposureId: measuredExposure.id, opportunityId: series.id, occurrenceId: 'week-2', verdict: 'RELEVANT' };
    const before = okay(await student('alex', 'activity'));
    rejected(await student('sam', 'recommendations/feedback', 'POST', input));
    rejected(await student('alex', 'recommendations/feedback', 'POST', { ...input, occurrenceId: 'week-3' }));
    const feedback = okay(await student('alex', 'recommendations/feedback', 'POST', input));
    assert.deepEqual(okay(await student('alex', 'recommendations/feedback', 'POST', input)), feedback);
    rejected(await student('alex', 'recommendations/feedback', 'POST', { ...input, verdict: 'NOT_RELEVANT' }), [409]);
    assert.deepEqual(okay(await student('alex', 'activity')), before);
    assert.equal(okay(await student('alex', 'export')).measurement.feedback.length, 1);
    noPrivateFields(okay(await admin('reports')));
  });
  await check('Self-reported application after exposure stays measured after later withdrawal', async () => {
    const applied = okay(await student('alex', `activity/${secondActivity.id}`, 'PATCH', { expectedVersion: secondActivity.version, status: 'APPLIED' }));
    okay(await student('alex', `activity/${applied.id}`, 'PATCH', { expectedVersion: applied.version, status: 'WITHDRAWN' }));
    const measurement = okay(await student('alex', 'export')).measurement;
    const outcomes = measurement.outcomes.filter(item => item.kind === 'APPLIED');
    assert.equal(outcomes.length, 1); assert.equal(outcomes[0].occurrenceId, 'week-2'); assert.equal(outcomes[0].exposureId, measuredExposure.id);
    assert.equal(outcomes[0].evidenceKind, 'SELF_REPORTED');
    assert(Date.parse(outcomes[0].at) >= Date.parse(measuredExposure.presentedAt));
    assert(Date.parse(outcomes[0].at) <= Date.parse(measuredExposure.observationEndsAt));
    assert.equal(okay(await student('alex', 'activity')).find(item => item.id === secondActivity.id).status, 'WITHDRAWN');
  });
  await check('Historical shown choices accept negative feedback after withdrawal but reject stale positive confirmation', async () => {
    const unanswered = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() }); assert.equal(unanswered.status, 200);
    const exposure = okay(await student('alex', 'recommendations/exposures', 'POST', { presentationToken: unanswered.data.presentationToken }));
    const input = { exposureId: exposure.id, opportunityId: series.id, occurrenceId: 'week-2' };
    let source = okay(await admin('sources')).find(item => item.id === series.record.source.id);
    source = okay(await admin(`sources/${source.id}`, 'PATCH', { expectedVersion: source.version, paused: true, reason: 'Withdraw the shown synthetic choice before relevance feedback' }));
    rejected(await student('alex', 'recommendations/feedback', 'POST', { ...input, verdict: 'RELEVANT' }), [409]);
    const negative = okay(await student('alex', 'recommendations/feedback', 'POST', { ...input, verdict: 'NOT_RELEVANT' }));
    assert.equal(negative.verdict, 'NOT_RELEVANT');
    assert.deepEqual(okay(await student('alex', 'recommendations/feedback', 'POST', { ...input, verdict: 'NOT_RELEVANT' })), negative);
    okay(await admin(`sources/${source.id}`, 'PATCH', { expectedVersion: source.version, paused: false, reason: 'Resume the synthetic choice after historical feedback checks' }));
  });
  await check('Empty presentations are acknowledged as seekers without inventing a recipient or relevance response', async () => {
    samProfile = okay(await student('sam', 'profile', 'PUT', { expectedVersion: samProfile.version, preferences: { ...broadPreferences, requiresSchoolCredit: true }, goal: 'EXPLORE', storageConsent: true }));
    const consent = okay(await student('sam', 'measurement'));
    okay(await student('sam', 'measurement', 'PUT', { expectedVersion: consent.version, expectedProfileVersion: samProfile.version, enabled: true }));
    const empty = await student('sam', 'recommendations', 'POST', { requestId: randomUUID() }); assert.equal(empty.status, 200); assert.equal(empty.data.data.length, 0);
    const exposure = okay(await student('sam', 'recommendations/exposures', 'POST', { presentationToken: empty.data.presentationToken }));
    assert.equal(exposure.items.length, 0); assert.equal(okay(await student('sam', 'export')).measurement.exposures.length, 1);
  });
  await check('Live measurement suppresses both small cohorts and complementary cells without leaking private rows', async () => {
    const summary = okay(await admin('measurement'));
    assert.equal(summary.windowDays, 30); assert.equal(summary.outcomeWindowDays, 7); assert.equal(summary.cohortThreshold, 3); assert.equal(summary.studentIdentitiesIncluded, false);
    assert.equal(summary.live.suppressed, true); assert.equal(summary.live.metrics, null); assert(summary.live.suppressionReason);
    for (const group of [...summary.channels, ...summary.rulesVersions]) { assert.equal(group.suppressed, true); assert.equal(group.metrics, null); }
    noPrivateFields(summary);
    const example = summary.calculationExample; assert.equal(example.label, 'Separate synthetic calculation example — not live activity');
    assert.equal(example.metrics.seekers, 8); assert.equal(example.metrics.recipients, 6); assert.equal(example.metrics.relevantRecipients, 3);
    assert.equal(example.metrics.respondents, 4); assert.equal(example.metrics.noMatchOnlySeekers, 2);
    assert.equal(example.metrics.usefulRate, 0.5); assert.equal(example.metrics.applicationRate, 1 / 3); assert.equal(example.metrics.coverageRate, 0.75);
    assert.equal(example.metrics.completedObservationRecipients, 4); assert.equal(example.metrics.partialObservationRecipients, 2);
  });
  await check('Campaign pause is versioned, blocks new attribution and preserves earlier first touch', async () => {
    const campaign = campaigns.find(item => item.id === 'demo-community'); assert(campaign);
    const paused = okay(await admin(`campaigns/${campaign.id}`, 'PATCH', { expectedVersion: campaign.version, paused: true }));
    assert.equal(paused.paused, true);
    rejected(await admin(`campaigns/${campaign.id}`, 'PATCH', { expectedVersion: campaign.version, paused: false }), [409]);
    rejected(await student('sam', 'attribution', 'POST', { campaignId: campaign.id }));
    assert(!okay(await req('/api/campaigns')).some(item => item.id === campaign.id));
    assert.deepEqual(okay(await student('alex', 'attribution')), firstCampaign);
    assert.equal(okay(await student('sam', 'attribution')), null);
  });
  await check('Process restart preserves occurrence IDs, measurement consent, exposures and first-touch attribution', async () => {
    const before = { alex: okay(await student('alex', 'export')), sam: okay(await student('sam', 'export')), catalogue: okay(await admin(`opportunities/${series.id}`)), campaigns: okay(await admin('campaigns')) };
    await stop(); reviewerToken = randomBytes(24).toString('base64url'); await start();
    rejected(await student('alex', 'export'), [401, 403]); rejected(await admin('campaigns'), [401, 403]);
    await login('operator'); await login('alex'); await login('sam');
    for (const actor of ['alex', 'sam']) {
      const current = okay(await student(actor, 'export'));
      assert.deepEqual(current.measurement, before[actor].measurement); assert.deepEqual(current.saved, before[actor].saved); assert.deepEqual(current.activity, before[actor].activity);
    }
    assert.deepEqual(okay(await admin(`opportunities/${series.id}`)).record.occurrences, before.catalogue.record.occurrences);
    assert.deepEqual(okay(await admin('campaigns')), before.campaigns);
    assert.deepEqual(okay(await student('alex', 'attribution')), firstCampaign);
  });
  await check('Measurement opt-out purges its records, stops collection and preserves ordinary student state', async () => {
    const before = okay(await student('alex', 'export'));
    const response = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() }); assert.equal(response.status, 200);
    const consent = okay(await student('alex', 'measurement'));
    okay(await student('alex', 'measurement', 'PUT', { expectedVersion: consent.version, expectedProfileVersion: profile.version, enabled: false }));
    const after = okay(await student('alex', 'export'));
    assert.equal(after.measurement.consent.enabled, false); assert.equal(after.measurement.attribution, null);
    for (const key of ['exposures', 'feedback', 'outcomes']) assert.equal(after.measurement[key].length, 0);
    assert.deepEqual(after.saved, before.saved); assert.deepEqual(after.activity, before.activity); assert.deepEqual(after.profile, before.profile);
    rejected(await student('alex', 'recommendations/exposures', 'POST', { presentationToken: response.data.presentationToken }));
    assert.equal(okay(await student('sam', 'export')).measurement.exposures.length, 1);
  });
  await check('Profile deletion purges occurrence and measurement state for only its signed owner', async () => {
    const samBefore = okay(await student('sam', 'export'));
    const consent = okay(await student('alex', 'measurement'));
    okay(await student('alex', 'measurement', 'PUT', { expectedVersion: consent.version, expectedProfileVersion: profile.version, enabled: true }));
    okay(await student('alex', 'attribution', 'POST', { campaignId: 'demo-school-club' }));
    const presentation = await student('alex', 'recommendations', 'POST', { requestId: randomUUID() }); assert.equal(presentation.status, 200);
    okay(await student('alex', 'recommendations/exposures', 'POST', { presentationToken: presentation.data.presentationToken }));
    okay(await student('alex', 'profile', 'DELETE', { confirmation: 'DELETE' }));
    const exported = okay(await student('alex', 'export')); assert.equal(exported.profile, null);
    assert.equal(exported.saved.length, 0); assert.equal(exported.activity.length, 0); assert.equal(exported.feedback.length, 0);
    assert.equal(exported.measurement.consent.enabled, false); assert.equal(exported.measurement.attribution, null);
    for (const key of ['exposures', 'feedback', 'outcomes']) assert.equal(exported.measurement[key].length, 0);
    const samAfter = okay(await student('sam', 'export')); assert.deepEqual(samAfter.measurement, samBefore.measurement); assert.deepEqual(samAfter.profile, samBefore.profile);
    assert(!okay(await admin('reports')).some(item => item.opportunityId === series.id));
  });

  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/occurrence-measurement-http.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'Independent occurrence and measurement HTTP acceptance against an isolated production process', checks, externalRequests: [], limitations: ['Legacy migration is exercised by repository tests; no power-loss or backup recovery claim.'] }, null, 2) + '\n');
} catch (error) { console.error(logs.join('').slice(-5000)); throw error; }
finally { await stop(); await rm(directory, { recursive: true, force: true }); }
