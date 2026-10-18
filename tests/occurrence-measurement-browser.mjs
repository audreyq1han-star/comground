import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(join(tmpdir(), 'comground-occurrence-browser-'));
const base = 'http://127.0.0.1:3109', reviewerToken = randomBytes(24).toString('base64url');
const output = 'output/playwright/occurrence-measurement';
const checks = [], pageErrors = [], consoleErrors = [], externalRequests = [], logs = [];
let child, browser, context, page, expectedFailure = false;
const seriesTitle = 'Weekly garden mornings — synthetic example';
function check(name) { checks.push(name); console.log('PASS', name); }
async function visit(path, target = page) { await target.goto(base + path); await target.waitForLoadState('networkidle'); }
async function fit(label) {
  const sizes = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth, overflowing: Array.from(document.querySelectorAll('body *')).map(node => ({ tag: node.tagName, className: node.className, id: node.id, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, right: node.getBoundingClientRect().right, text: node.textContent?.slice(0, 80) })).filter(node => node.right > innerWidth + 1 || node.scrollWidth > node.width + 32).slice(0, 18) }));
  if (sizes.content > sizes.viewport) await page.screenshot({ path: `${output}/layout-failure.png`, fullPage: true });
  assert(sizes.content <= sizes.viewport, `${label}: ${JSON.stringify(sizes)}`);
}
async function shot(name) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); }
async function api(path, method = 'GET', body, target = page) {
  return target.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}
function okay(result) { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.data; }
async function eventually(checkValue, label) {
  for (let attempt = 0; attempt < 50; attempt++) { if (await checkValue()) return; await delay(100); }
  assert.fail(label);
}
async function publish() {
  await page.getByLabel('Review reason', { exact: true }).fill('Independent browser review of the explicit synthetic dates and source facts.');
  await page.getByRole('button', { name: 'Publish example', exact: true }).click();
  await page.locator('.op-record-meta').getByText('PUBLISHED', { exact: true }).waitFor();
}
function observePage(target) {
  target.on('pageerror', error => pageErrors.push(error.message));
  target.on('console', message => { if (message.type() === 'error' && !expectedFailure) consoleErrors.push(message.text()); });
}
async function previewSignup() {
  await page.getByRole('button', { name: /Preview demo signup/ }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByText('Status: demo destination preview. This is not an application.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
}
async function holdRealResponse(path, method = 'GET') {
  let capture, release, finish, held = false;
  const captured = new Promise(resolve => { capture = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  const finished = new Promise(resolve => { finish = resolve; });
  const pattern = `**${path}`;
  const handler = async route => {
    if (held || route.request().method() !== method) return route.continue();
    held = true;
    const response = await route.fetch();
    capture({ status: response.status(), body: await response.json() });
    await released;
    try { await route.fulfill({ response }); } finally { finish(); }
  };
  await page.route(pattern, handler);
  return { captured, release: async () => { release(); await finished; await page.unroute(pattern, handler); } };
}

let series, recordPath, secondDate, primaryDate, campaign;
try {
  await mkdir(output, { recursive: true });
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '3109', '--keepAliveTimeout', '1000'], {
    env: { ...process.env, COMGROUND_MODE: 'demo', LOCAL_REVIEW_TOKEN: reviewerToken, COMGROUND_DB_PATH: join(directory, 'browser.sqlite'), NEXT_TELEMETRY_DISABLED: '1', COMGROUND_SKIP_DEMO_SEED: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', value => logs.push(value.toString())); child.stderr.on('data', value => logs.push(value.toString()));
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { if (child.exitCode !== null) throw new Error('Isolated production server exited'); try { if ((await fetch(base + '/api/opportunities')).ok) { ready = true; break; } } catch {} await delay(200); }
  assert(ready, 'Isolated production build is ready');
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === base) return route.continue(); externalRequests.push(route.request().url()); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(15000); observePage(page);

  await visit('/admin');
  await page.getByLabel('Temporary reviewer token', { exact: true }).fill(reviewerToken);
  await page.getByRole('button', { name: 'Open reviewer session', exact: true }).click();
  await page.getByRole('link', { name: 'Catalogue', exact: true }).waitFor();
  await visit('/admin/import-runs');
  await page.getByLabel('Synthetic fixture', { exact: true }).selectOption('garden-series');
  await page.getByRole('button', { name: 'Import fixture', exact: true }).click();
  await page.getByRole('link', { name: 'Inspect the latest imported record →', exact: true }).click();
  await page.locator('.op-record-meta').getByText('DRAFT', { exact: true }).waitFor();
  recordPath = new URL(page.url()).pathname;
  series = okay(await api('/api/admin/opportunities/' + recordPath.split('/').pop()));
  assert.equal(series.record.title, seriesTitle); assert.equal(series.record.occurrences.length, 3);
  primaryDate = series.record.occurrences.find(item => item.id === 'primary'); secondDate = series.record.occurrences.find(item => item.id === 'week-2');
  check('Operator imports the real recurring fixture through its UI; it starts as an unpublished draft');

  const editor = page.getByTestId('occurrence-editor');
  await editor.locator('summary').first().click();
  await editor.getByLabel('Copy from date', { exact: true }).selectOption('week-3');
  await editor.getByLabel('UTC interval in days', { exact: true }).fill('7');
  await editor.getByLabel('Additional dates', { exact: true }).fill('1');
  await editor.getByRole('button', { name: 'Generate explicit repeat dates', exact: true }).click();
  await editor.getByText('4 of 12 dates in this draft', { exact: true }).waitFor();
  const added = await editor.locator('[data-occurrence-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-id')).filter(id => !['primary', 'week-2', 'week-3'].includes(id)));
  assert.equal(added.length, 1);
  await editor.getByLabel(`Cancel date ${added[0]}`, { exact: true }).check();
  await editor.getByRole('button', { name: 'Add one date for editing', exact: true }).click();
  await editor.getByText('5 of 12 dates in this draft', { exact: true }).waitFor();
  const unsavedIds = await editor.locator('[data-occurrence-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-occurrence-id')).filter(id => !['primary', 'week-2', 'week-3'].includes(id)));
  const extra = unsavedIds.find(id => id !== added[0]); assert(extra);
  await editor.getByRole('button', { name: `Discard unsaved date ${extra}`, exact: true }).click();
  await editor.getByText('4 of 12 dates in this draft', { exact: true }).waitFor();
  await editor.locator('[data-occurrence-id="week-2"] > summary').click();
  const changedStart = new Date(Date.parse(secondDate.startsAt) + 3600000).toISOString();
  const changedEnd = new Date(Date.parse(secondDate.endsAt) + 3600000).toISOString();
  await editor.getByLabel('Starts at (UTC) · week-2', { exact: true }).fill(changedStart.slice(0, 16));
  await editor.getByLabel('Ends at (UTC) · week-2', { exact: true }).fill(changedEnd.slice(0, 16));
  await editor.getByLabel('Reason for date changes', { exact: true }).fill('Independent browser: add a bounded explicit repeat, cancel that new date and reschedule week two.');
  await editor.getByRole('button', { name: 'Save dated occurrences for review', exact: true }).click();
  await page.getByText('Dated occurrences saved. The opportunity requires a new publication review.', { exact: true }).waitFor();
  await publish();
  series = okay(await api(`/api/admin/opportunities/${series.id}`));
  assert.equal(series.record.occurrences.length, 4); assert(series.record.occurrences.find(item => item.id === added[0]).isCancelled);
  assert.equal(Date.parse(series.record.occurrences.find(item => item.id === 'week-2').startsAt), Date.parse(changedStart));
  secondDate = series.record.occurrences.find(item => item.id === 'week-2');
  await shot('operator-explicit-dates-desktop'); await fit('Operator dates desktop');
  check('Operator adds and discards unsaved dates, generates a bounded UTC repeat, cancels one date and edits another before a fresh review');

  campaign = okay(await api('/api/campaigns')).find(item => item.id === 'demo-school-club'); assert(campaign);
  await visit(campaign.path);
  await page.getByRole('heading', { name: campaign.name, exact: true }).waitFor();
  const frontDoor = page.getByRole('link', { name: 'Find your fit', exact: true });
  assert.equal(new URL(await frontDoor.getAttribute('href'), base).searchParams.get('campaign'), campaign.id);
  await shot('campaign-community-desktop');
  await frontDoor.click();
  await page.getByRole('button', { name: /Alex · demo/ }).click();
  await page.getByRole('checkbox', { name: /I agree to store this synthetic demo profile/ }).check();
  await page.getByRole('button', { name: /Create demo profile/ }).click();
  await page.getByRole('heading', { name: 'A shortlist with a reason.', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('campaign'), campaign.id);
  await page.getByText('Optional local measurement settings', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).isChecked(), false);
  let exported = okay(await api('/api/student/export'));
  assert.equal(exported.measurement.consent.enabled, false); assert.equal(exported.measurement.attribution, null); assert.equal(exported.measurement.exposures.length, 0);
  check('The synthetic campaign travels through the community and onboarding URL while optional measurement remains off');

  await page.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).check();
  await page.getByRole('button', { name: 'Save measurement choice', exact: true }).click();
  await page.getByText('Stored attribution: demo-school-club.', { exact: true }).waitFor();
  const acknowledged = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/recommendations/exposures' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click();
  await page.locator('.dashboard-matches').scrollIntoViewIfNeeded();
  assert.equal((await acknowledged).status(), 200);
  await eventually(async () => okay(await api('/api/student/export')).measurement.exposures.length > 0, 'Rendered matches acknowledge a real exposure');
  exported = okay(await api('/api/student/export'));
  assert.equal(exported.measurement.attribution.campaignId, campaign.id);
  assert(exported.measurement.exposures.some(exposure => exposure.items.some(item => item.opportunityId === series.id)));
  // The occurrence owner supplies semantic wrapper attributes for recommendation controls.
  const recommendation = page.locator('[data-opportunity-id]').filter({ has: page.getByRole('link', { name: seriesTitle, exact: true }) }).first();
  await recommendation.getByRole('button', { name: 'Relevant', exact: true }).click();
  await eventually(async () => okay(await api('/api/student/export')).measurement.feedback.some(item => item.opportunityId === series.id && item.verdict === 'RELEVANT'), 'Structured relevance is retained for the displayed occurrence');
  assert.equal(okay(await api('/api/student/activity')).filter(item => item.opportunityId === series.id).length, 0);
  await shot('measured-shortlist-desktop');
  check('Actual rendered shortlists acknowledge consented exposures; Relevant feedback refers to that choice and creates no application');

  await page.getByRole('link', { name: seriesTitle, exact: true }).click();
  await page.getByLabel('Current available date', { exact: true }).waitFor();
  await page.getByLabel('Current available date', { exact: true }).selectOption('week-2');
  await page.waitForURL(url => url.searchParams.get('occurrence') === 'week-2');
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).waitFor(); await previewSignup();
  await page.getByLabel('Current available date', { exact: true }).selectOption('primary');
  await page.waitForURL(url => url.searchParams.get('occurrence') === 'primary');
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).waitFor(); await previewSignup();
  await page.goBack(); await page.waitForURL(url => url.searchParams.get('occurrence') === 'week-2');
  await page.getByLabel('Current available date', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Current available date', { exact: true }).inputValue(), 'week-2');
  await page.goForward(); await page.waitForURL(url => url.searchParams.get('occurrence') === 'primary');
  const saves = okay(await api('/api/student/saves')).filter(item => item.opportunityId === series.id);
  const activities = okay(await api('/api/student/activity')).filter(item => item.opportunityId === series.id);
  assert.deepEqual(saves.map(item => item.occurrenceId).sort(), ['primary', 'week-2']);
  assert.deepEqual(activities.map(item => item.occurrenceId).sort(), ['primary', 'week-2']); assert(activities.every(item => item.status === 'OPENED'));
  await shot('occurrence-selection-desktop');
  check('Selecting dates updates the URL/back-forward state and independent saves and previews retain both exact occurrences');

  expectedFailure = true;
  for (const query of ['occurrence=', 'occurrence=primary&occurrence=week-2']) {
    await visit(`/opportunities/${series.id}?${query}`);
    await page.locator('section.empty-state[role="alert"]').waitFor();
    assert.equal(await page.getByLabel('Current available date', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Save opportunity', exact: true }).count(), 0);
  }
  expectedFailure = false;
  check('Empty and repeated occurrence deep links show a failure without silently substituting a date');

  await visit('/saved');
  assert.equal(await page.locator('.saved-item[data-occurrence-id="primary"]').filter({ hasText: seriesTitle }).count(), 1);
  assert.equal(await page.locator('.saved-item[data-occurrence-id="week-2"]').filter({ hasText: seriesTitle }).count(), 1);
  await visit('/activity');
  const secondActivity = page.locator('.activity-card[data-occurrence-id="week-2"]').filter({ hasText: seriesTitle });
  const primaryActivity = page.locator('.activity-card[data-occurrence-id="primary"]').filter({ hasText: seriesTitle });
  assert(await secondActivity.locator('option[value="ATTENDED"]').isDisabled());
  await secondActivity.getByLabel('Report a demo outcome', { exact: true }).selectOption('APPLIED');
  await secondActivity.getByRole('button', { name: 'Save self-report', exact: true }).click();
  await secondActivity.getByText('Applied · self-reported', { exact: true }).first().waitFor();
  assert(await primaryActivity.getByText('Demo destination preview', { exact: true }).first().isVisible());
  check('Saved and activity cards identify each date; applying to week two does not update primary and future attendance remains blocked');

  await visit('/alerts');
  await page.getByRole('checkbox', { name: 'Enable in-app reminders', exact: true }).check();
  await page.getByRole('checkbox', { name: /Event reminders and post-event follow-up/ }).check();
  await page.getByRole('checkbox', { name: /Unavailable saved opportunities/ }).check();
  await page.getByRole('button', { name: 'Save reminder preferences', exact: true }).click();
  await eventually(async () => okay(await api('/api/student/reminders')).filter(item => item.opportunityId === series.id && item.kind === 'UPCOMING').length === 2, 'Both upcoming dates have reminders');
  const secondReminder = page.locator('article.reminder-card').filter({ has: page.locator(`a[href*="${series.id}"][href*="occurrence=week-2"]`) });
  await secondReminder.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByText('Reminder dismissed.', { exact: true }).waitFor();
  assert.deepEqual(okay(await api('/api/student/reminders')).filter(item => item.opportunityId === series.id && item.kind === 'UPCOMING').map(item => item.occurrenceId), ['primary']);
  const beforePreview = okay(await api('/api/student/export')).measurement.exposures.length;
  await page.getByRole('button', { name: 'Preview shortlist', exact: true }).click(); await page.getByText(/Preview ready:/).waitFor();
  assert.equal(okay(await api('/api/student/export')).measurement.exposures.length, beforePreview);
  await shot('occurrence-reminders-desktop');
  check('Dismissing one dated reminder leaves its sibling; manual digest preview does not count a measured exposure');

  await visit('/admin/measurement');
  const live = page.getByTestId('measurement-live'), example = page.getByTestId('measurement-example');
  await live.getByText('Below the reporting threshold', { exact: true }).waitFor();
  assert.equal(await live.locator('.op-metric').count(), 0);
  await example.getByRole('heading', { name: 'Separate synthetic calculation example', exact: true }).waitFor();
  await example.getByText('Useful within 7 days · 3 / 6 recipients', { exact: true }).waitFor();
  await example.getByText('Applied within 7 days · 2 / 6 recipients', { exact: true }).waitFor();
  assert(await example.getByText('50%', { exact: true }).first().isVisible());
  await shot('measurement-suppression-and-example-desktop');
  check('Operator measurement separates suppressed live cohorts from the labeled synthetic calculation with all-recipient denominators');

  expectedFailure = true;
  await page.route('**/api/admin/measurement', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_INTERRUPTION', message: 'Synthetic measurement read interruption.' } }) }));
  await visit('/admin/measurement');
  await page.getByText('Synthetic measurement read interruption.', { exact: true }).waitFor();
  await page.unroute('**/api/admin/measurement');
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await page.getByTestId('measurement-live').getByText('Below the reporting threshold', { exact: true }).waitFor();
  expectedFailure = false;
  check('An interrupted measurement read exposes a real retry control and recovers without fabricated totals');

  await visit('/admin/acquisition');
  const campaignCard = page.locator(`article[data-campaign-id="${campaign.id}"]`);
  await campaignCard.getByRole('button', { name: 'Pause synthetic campaign', exact: true }).click();
  await campaignCard.getByRole('button', { name: 'Resume synthetic campaign', exact: true }).waitFor();
  assert.equal(okay(await api('/api/student/attribution')).campaignId, campaign.id);
  assert(!okay(await api('/api/campaigns')).some(item => item.id === campaign.id));
  await shot('campaign-paused-desktop');
  check('Operator pauses the allowlisted campaign while the earlier consented first touch remains intact');

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await secondContext.route('**/*', route => { if (new URL(route.request().url()).origin === base) return route.continue(); externalRequests.push(route.request().url()); return route.abort(); });
  const samPage = await secondContext.newPage(); samPage.setDefaultTimeout(15000); observePage(samPage);
  expectedFailure = true;
  await visit(campaign.path, samPage);
  await samPage.getByRole('heading', { name: 'This community page is unavailable.', exact: true }).waitFor();
  assert.equal(await samPage.getByRole('link', { name: 'Find your fit', exact: true }).count(), 0);
  expectedFailure = false;
  await visit(`/onboarding?campaign=${encodeURIComponent(campaign.id)}`, samPage);
  await samPage.getByRole('button', { name: /Sam · demo/ }).click();
  await samPage.getByRole('checkbox', { name: /I agree to store this synthetic demo profile/ }).check();
  await samPage.getByRole('button', { name: /Create demo profile/ }).click();
  await samPage.getByRole('heading', { name: /A good next step, Sam/ }).waitFor();
  await visit('/profile', samPage);
  await samPage.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).check();
  await samPage.getByRole('button', { name: 'Save measurement choice', exact: true }).click();
  await samPage.getByText('Stored attribution: Direct / unattributed.', { exact: true }).waitFor();
  assert.equal(okay(await api('/api/student/export', 'GET', undefined, samPage)).measurement.attribution, null);
  await samPage.screenshot({ path: `${output}/paused-campaign-onboarding-phone.png`, fullPage: true });
  await secondContext.close();
  check('A paused community has no enrollment CTA; a separate phone persona using its stale campaign code consents independently and remains unattributed');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await visit(`/opportunities/${series.id}?occurrence=week-2`);
    await page.getByLabel('Current available date', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Current available date', { exact: true }).inputValue(), 'week-2');
    await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).click();
    await page.getByRole('button', { name: 'Save opportunity', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
    await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).waitFor();
    await page.getByLabel('Current available date', { exact: true }).selectOption('primary');
    await page.waitForURL(url => url.searchParams.get('occurrence') === 'primary');
    await previewSignup(); await fit(`${width}px real date-selection and save flow`); await shot(`occurrence-detail-${width}`);
    await visit('/matches');
    await page.locator('.dashboard-matches').scrollIntoViewIfNeeded();
    await eventually(async () => await page.getByRole('button', { name: 'Not relevant', exact: true }).count() > 0, 'Measured phone shortlist offers structured feedback');
    await page.getByRole('button', { name: 'Not relevant', exact: true }).first().click();
    await page.getByText('Relevance recorded: not relevant.', { exact: true }).waitFor(); await fit(`${width}px measured matches`); await shot(`measured-shortlist-${width}`);
    await visit('/admin/acquisition');
    const phoneCampaign = page.locator(`article[data-campaign-id="${campaign.id}"]`);
    await phoneCampaign.getByRole('button', { name: 'Resume synthetic campaign', exact: true }).click();
    await phoneCampaign.getByRole('button', { name: 'Pause synthetic campaign', exact: true }).waitFor();
    await phoneCampaign.getByRole('button', { name: 'Pause synthetic campaign', exact: true }).click();
    await phoneCampaign.getByRole('button', { name: 'Resume synthetic campaign', exact: true }).waitFor();
    await fit(`${width}px campaign controls`); await shot(`campaign-controls-${width}`);
    for (const path of ['/saved', '/activity', '/alerts', '/profile', '/admin/measurement', recordPath]) { await visit(path); await fit(`${width}px ${path}`); }
    check(`At ${width}px, actual date selection, independent save toggles, relevance feedback and campaign pause/resume work; supporting routes fit`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Hold actual server replies, never substitute invented profile or shortlist data.
  await visit('/admin/acquisition');
  await page.locator(`article[data-campaign-id="${campaign.id}"]`).getByRole('button', { name: 'Resume synthetic campaign', exact: true }).click();
  await page.locator(`article[data-campaign-id="${campaign.id}"]`).getByRole('button', { name: 'Pause synthetic campaign', exact: true }).waitFor();
  await visit(`/matches?campaign=${campaign.id}`);
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).waitFor();
  const heldConsent = await holdRealResponse('/api/student/measurement');
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click();
  assert.equal((await heldConsent.captured).status, 200);
  const attributionPosts = [];
  const observeAttribution = request => { if (new URL(request.url()).pathname === '/api/student/attribution' && request.method() === 'POST') attributionPosts.push(request.postData()); };
  page.on('request', observeAttribution);
  await page.locator('a.persona-link').click();
  await page.getByRole('link', { name: 'Switch persona', exact: true }).click();
  await page.getByRole('button', { name: /Sam · demo/ }).click();
  await page.getByRole('button', { name: /Sam · demo/ }).and(page.locator('[aria-pressed="true"]')).waitFor();
  await heldConsent.release();
  await page.waitForTimeout(350);
  assert.equal(okay(await api('/api/student/export')).profile.personaId, 'demo-sam');
  assert.equal(okay(await api('/api/student/attribution')), null);
  assert.deepEqual(attributionPosts, []);
  check('A held Matches consent read cannot continue campaign attribution after switching to an already opted-in persona');

  await page.getByRole('button', { name: /Alex · demo/ }).click();
  await page.getByRole('button', { name: /Alex · demo/ }).and(page.locator('[aria-pressed="true"]')).waitFor();
  await page.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).waitFor();
  const heldSave = await holdRealResponse('/api/student/measurement', 'PUT');
  await page.getByRole('button', { name: 'Save measurement choice', exact: true }).click();
  assert.equal((await heldSave.captured).status, 200);
  attributionPosts.length = 0;
  await page.getByRole('button', { name: /Sam · demo/ }).click();
  await page.getByRole('button', { name: /Sam · demo/ }).and(page.locator('[aria-pressed="true"]')).waitFor();
  await heldSave.release();
  await page.waitForTimeout(350);
  assert.equal(okay(await api('/api/student/attribution')), null); assert.deepEqual(attributionPosts, []);
  page.off('request', observeAttribution);
  check('A held consent-save response cannot write its previous persona campaign into the newly selected persona');
  await page.getByRole('button', { name: /Alex · demo/ }).click();
  await page.getByRole('button', { name: /Alex · demo/ }).and(page.locator('[aria-pressed="true"]')).waitFor();
  await page.getByRole('link', { name: 'Continue to matches →', exact: true }).click();
  await page.locator('.dashboard-matches').scrollIntoViewIfNeeded();
  await eventually(async () => await page.getByRole('button', { name: 'Relevant', exact: true }).count() > 0, 'Alex measured shortlist is ready before delayed response checks');

  const baselineExposureCount = okay(await api('/api/student/export')).measurement.exposures.length;
  const heldMatches = await holdRealResponse('/api/student/recommendations', 'POST');
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click();
  const oldMatches = await heldMatches.captured; assert.equal(oldMatches.status, 200);
  const preferencePage = await context.newPage(); preferencePage.setDefaultTimeout(15000); observePage(preferencePage);
  await visit('/profile', preferencePage);
  await preferencePage.getByRole('checkbox', { name: /School credit is a requirement/ }).check();
  await preferencePage.getByRole('button', { name: /Save preferences/ }).click();
  await preferencePage.getByText('Preferences saved. Your next matches use this version.', { exact: true }).waitFor();
  const changedProfile = okay(await api('/api/student/export', 'GET', undefined, preferencePage)).profile;
  assert(changedProfile.version > oldMatches.body.profileVersion);
  const focusSession = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/session');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await focusSession;
  await page.waitForTimeout(150);
  const latestRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/matches' && response.request().method() === 'POST');
  await heldMatches.release();
  const latest = await (await latestRead).json(); assert.equal(latest.profileVersion, changedProfile.version); assert.equal(latest.data.length, 0);
  await page.getByRole('heading', { name: 'No current examples meet all your requirements.', exact: true }).waitFor();
  assert.equal(await page.locator('[data-opportunity-id]').count(), 0);
  assert.equal(okay(await api('/api/student/export')).measurement.exposures.length, baselineExposureCount);
  check('A focus refresh queued during a held shortlist discards stale cards, reads the latest preferences and adds no exposure');
  await preferencePage.getByRole('checkbox', { name: /School credit is a requirement/ }).uncheck();
  await preferencePage.getByRole('button', { name: /Save preferences/ }).click();
  await preferencePage.getByText('Preferences saved. Your next matches use this version.', { exact: true }).waitFor();
  const restoredProfile = okay(await api('/api/student/export', 'GET', undefined, preferencePage)).profile;
  const restoredRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/matches' && response.request().method() === 'POST');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await restoredRead;
  await page.getByText(`Stored profile v${restoredProfile.version}`, { exact: true }).waitFor();
  await page.locator('.dashboard-matches').waitFor(); await preferencePage.close();

  const beforeHeldAck = okay(await api('/api/student/export')).measurement.exposures.length;
  const heldAck = await holdRealResponse('/api/student/recommendations/exposures', 'POST');
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click();
  await page.locator('.dashboard-matches').scrollIntoViewIfNeeded();
  assert.equal((await heldAck.captured).status, 200);
  const focusRead = page.waitForResponse(response => new URL(response.url()).pathname === '/api/student/matches' && response.request().method() === 'POST');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await focusRead;
  await heldAck.release();
  await eventually(async () => await page.getByRole('button', { name: 'Relevant', exact: true }).count() > 0, 'A committed acknowledgement survives an unchanged focus refresh');
  await page.getByRole('button', { name: 'Relevant', exact: true }).first().click();
  await page.getByText('Relevance recorded: relevant.', { exact: true }).waitFor();
  assert.equal(okay(await api('/api/student/export')).measurement.exposures.length, beforeHeldAck + 1);
  check('A delayed committed acknowledgement survives an unchanged focus refresh and exposes usable feedback for exactly one batch');

  const videoContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState: await context.storageState(), recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 900 } } });
  await videoContext.route('**/*', route => { if (new URL(route.request().url()).origin === base) return route.continue(); externalRequests.push(route.request().url()); return route.abort(); });
  const videoPage = await videoContext.newPage(); observePage(videoPage);
  await visit(`/opportunities/${series.id}?occurrence=week-2`, videoPage);
  await videoPage.getByLabel('Current available date', { exact: true }).scrollIntoViewIfNeeded(); await videoPage.waitForTimeout(1500);
  await visit('/saved', videoPage); await videoPage.waitForTimeout(1200);
  await visit('/matches', videoPage); await videoPage.locator('.dashboard-matches').scrollIntoViewIfNeeded(); await videoPage.waitForTimeout(1800);
  await visit('/admin/measurement', videoPage); await videoPage.getByTestId('measurement-live').scrollIntoViewIfNeeded(); await videoPage.waitForTimeout(1400);
  await videoPage.getByTestId('measurement-example').scrollIntoViewIfNeeded(); await videoPage.waitForTimeout(1800);
  const video = videoPage.video(); await videoContext.close(); await video.saveAs(`${output}/occurrence-measurement-walkthrough.webm`);
  check('Captured a short real Chrome walkthrough of selected dates, separate saves, measured shortlist and truthful operator measurement');

  await visit('/profile');
  await page.getByRole('checkbox', { name: 'Enable optional local measurement', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save measurement choice', exact: true }).click();
  await page.getByText('Optional measurement is off. New measurement has stopped and prior measurement records have been deleted.', { exact: true }).waitFor();
  const optedOut = okay(await api('/api/student/export'));
  assert.equal(optedOut.measurement.consent.enabled, false); assert.equal(optedOut.measurement.exposures.length, 0); assert.equal(optedOut.measurement.attribution, null);
  assert.equal(optedOut.saved.filter(item => item.opportunityId === series.id).length, 2);
  check('The visible opt-out control deletes measurement and attribution while keeping ordinary dated saves intact');

  assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(externalRequests, []);
  await rm(`${output}/layout-failure.png`, { force: true });
  check('Independent Chrome journeys have no runtime exceptions, unexpected console errors or external requests');
  await mkdir('docs/evidence', { recursive: true });
  await writeFile('docs/evidence/occurrence-measurement-browser.json', JSON.stringify({ verifiedAt: new Date().toISOString(), scope: 'Independent real Chrome occurrence and measurement UI acceptance against an isolated production build', checks, pageErrors, consoleErrors, externalRequests, viewports: ['1440×1000', '390×844', '320×844'] }, null, 2) + '\n');
} catch (error) { console.error(logs.join('').slice(-5000)); throw error; }
finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([ended, delay(15000)]); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; } }
  await rm(directory, { recursive: true, force: true });
}
