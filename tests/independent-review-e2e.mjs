import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const folder = await mkdtemp(join(tmpdir(), 'comground-independent-browser-'));
const base = 'http://127.0.0.1:3107', token = randomBytes(24).toString('base64url');
const output = 'output/playwright/independent-review';
await mkdir(output, { recursive: true });
const checks = [], errors = [], external = [], logs = [];
let child, browser, context, page, expectedError = false;
const check = label => { checks.push(label); console.log('PASS', label); };
async function visit(path, target = page) { await target.goto(base + path); await target.waitForLoadState('networkidle'); }
async function fit(label) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label); }
async function api(path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  }, { path, method, body });
}
async function focusCheck(target = page) {
  const response = target.waitForResponse(r => new URL(r.url()).pathname === '/api/student/session');
  await target.evaluate(() => window.dispatchEvent(new Event('focus'))); await response;
}
try {
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '3107', '--keepAliveTimeout', '1000'], { env: { ...process.env, COMGROUND_MODE: 'demo', LOCAL_REVIEW_TOKEN: token, COMGROUND_DB_PATH: join(folder, 'review.sqlite'), NEXT_TELEMETRY_DISABLED: '1', COMGROUND_SKIP_DEMO_SEED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => logs.push(d.toString())); child.stderr.on('data', d => logs.push(d.toString()));
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/opportunities')).ok) { ready = true; break; } } catch {} await delay(200); }
  assert(ready, 'Isolated production server ready');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: 'reduce' });
  await context.route('**/*', r => { if (new URL(r.request().url()).origin === base) return r.continue(); external.push(r.request().url()); return r.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !expectedError) errors.push(m.text()); });
  await visit('/onboarding'); await page.getByRole('button', { name: /Alex · demo/ }).click();
  await page.getByRole('checkbox', { name: /I agree to store this synthetic demo profile/ }).check();
  await page.getByRole('button', { name: 'Create demo profile', exact: true }).click();
  await page.getByRole('heading', { name: /A good next step/ }).waitFor();
  check('Fresh desktop onboarding requires consent and reaches a real persistent dashboard');

  await visit('/matches'); await page.locator('article.opportunity-card').first().waitFor();
  const editor = await context.newPage(); await visit('/profile', editor);
  await editor.getByRole('checkbox', { name: /School credit is a requirement/ }).check();
  await editor.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await editor.getByText('Preferences saved. Your next matches use this version.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh matches', exact: true }).click();
  await page.getByRole('heading', { name: 'No current examples meet all your requirements.', exact: true }).waitFor();
  assert(await page.getByText('School credit required', { exact: true }).isVisible());
  const profile = (await api('/api/student/profile')).body.data;
  assert(await page.getByText(`Stored profile v${profile.version}`, { exact: true }).isVisible());
  await editor.getByRole('checkbox', { name: /School credit is a requirement/ }).uncheck();
  await editor.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await editor.getByText('Preferences saved. Your next matches use this version.', { exact: true }).waitFor();
  await focusCheck(); await page.locator('article.opportunity-card').first().waitFor();
  assert(await page.getByText('School credit not required', { exact: true }).isVisible());
  await editor.close(); check('Cross-tab profile changes update match facts and results atomically on manual and focus refresh');

  await visit('/alerts');
  await page.getByRole('checkbox', { name: 'Enable in-app reminders', exact: true }).check();
  await page.getByRole('checkbox', { name: /Event reminders and post-event follow-up/ }).check();
  await focusCheck(); await page.waitForLoadState('networkidle');
  assert(await page.getByRole('checkbox', { name: 'Enable in-app reminders', exact: true }).isChecked());
  assert(await page.getByRole('checkbox', { name: /Event reminders and post-event follow-up/ }).isChecked());
  expectedError = true;
  await page.route('**/api/student/alerts', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVIEW_INTERRUPTION', message: 'Synthetic preference refresh interruption.' } }) }));
  await focusCheck(); await page.getByText(/Synthetic preference refresh interruption/).waitFor();
  assert(await page.getByRole('checkbox', { name: 'Enable in-app reminders', exact: true }).isChecked());
  await page.unroute('**/api/student/alerts'); await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.waitForLoadState('networkidle'); expectedError = false;
  assert(await page.getByRole('checkbox', { name: /Event reminders and post-event follow-up/ }).isChecked());
  await page.getByRole('button', { name: 'Save reminder preferences', exact: true }).click();
  await page.getByText('In-app preferences saved.', { exact: true }).waitFor();
  check('Unsaved reminder choices survive focus revalidation, failed refresh and retry');
  await page.getByRole('button', { name: 'Preview shortlist', exact: true }).click();
  await page.getByText(/Preview ready: 2 examples/).waitFor();
  assert(await page.getByText('Preview only. Nothing is scheduled or sent.', { exact: true }).isVisible());
  await page.screenshot({ path: output + '/digest-desktop.png', fullPage: true });
  check('Manual digest preview shows current explained choices and never claims scheduled delivery');

  const garden = (await api('/api/opportunities?limit=50')).body.data.find(o => o.title.includes('Community garden'));
  const detail = '/opportunities/' + garden.id;
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/student/saves', async route => { if (route.request().method() === 'GET') { await held; return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }); } return route.continue(); });
  await page.goto(base + detail, { waitUntil: 'domcontentloaded' });
  const checking = page.getByRole('button', { name: 'Checking saved status…', exact: true });
  await checking.waitFor(); assert(await checking.isDisabled());
  release(); await page.getByRole('button', { name: 'Save opportunity', exact: true }).waitFor();
  await page.unroute('**/api/student/saves');
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).click();
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).waitFor();
  assert.equal((await api('/api/student/saves')).body.data.length, 0);
  check('Save status must load before toggling; save/remove remains consistent after delayed reads');

  const beforeActivity = (await api('/api/student/activity')).body.data.length;
  await page.getByRole('button', { name: 'Record feedback', exact: true }).click();
  await page.getByText('Fit feedback saved privately.', { exact: false }).waitFor();
  await page.getByLabel('Feedback about this date', { exact: true }).selectOption('WRONG_DETAILS');
  await page.getByRole('button', { name: 'Record feedback', exact: true }).click();
  await page.getByText('Listing report recorded for the local reviewer.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Record feedback', exact: true }).click();
  await page.getByText('Listing report recorded for the local reviewer.', { exact: false }).waitFor();
  assert.equal((await api('/api/student/feedback')).body.data.length, 2);
  assert.equal((await api('/api/student/activity')).body.data.length, beforeActivity);
  await page.screenshot({ path: output + '/feedback-desktop.png', fullPage: true });
  check('Private fit feedback and idempotent factual reports are distinct from application activity');

  await page.getByRole('button', { name: /Preview demo signup/ }).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await visit('/activity'); const current = page.locator('article.activity-card').filter({ hasText: 'Community garden morning' });
  await current.getByLabel('Report a demo outcome', { exact: true }).selectOption('WITHDRAWN');
  await focusCheck(); await page.waitForLoadState('networkidle');
  assert.equal(await current.getByLabel('Report a demo outcome', { exact: true }).inputValue(), 'WITHDRAWN');
  await current.getByLabel('Report a demo outcome', { exact: true }).selectOption('APPLIED');
  await current.getByRole('button', { name: 'Save self-report', exact: true }).click();
  await current.getByText('Applied · self-reported', { exact: true }).first().waitFor();
  await visit('/alerts'); const upcoming = page.locator('article.reminder-card').filter({ hasText: 'Community garden morning' });
  await upcoming.getByText('Upcoming', { exact: true }).waitFor();
  await upcoming.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByText('Reminder dismissed.', { exact: true }).waitFor();
  assert((await api('/api/student/export')).body.data.reminderStates.some(r => r.id === 'upcoming:' + garden.id && r.dismissed));
  check('Unsaved activity edits survive focus, applied unsaved events get reminders, and dismissal appears in export');

  await visit('/admin'); await page.getByLabel('Temporary reviewer token', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Open reviewer session', exact: true }).click();
  await page.getByRole('link', { name: 'Listing reports', exact: true }).click();
  const reports = (await api('/api/admin/reports')).body.data;
  assert.equal(reports.length, 1); assert.equal(reports[0].kind, 'WRONG_DETAILS');
  assert(!JSON.stringify(reports).match(/demo-alex|demo-sam|preferences|personaId/));
  await page.getByLabel('Reason for this action', { exact: true }).fill('Synthetic review: inspected the source facts and recorded the issue for the fixture owner.');
  await page.getByRole('button', { name: 'Mark report addressed', exact: true }).click();
  await page.getByLabel('Report status', { exact: true }).selectOption('RESOLVED');
  await page.getByRole('heading', { name: 'Recorded resolution', exact: true }).waitFor();
  await page.screenshot({ path: output + '/reports-desktop.png', fullPage: true });
  await visit('/activity'); await page.getByText('Addressed by reviewer', { exact: true }).waitFor();
  check('Reviewer sees factual reports only and resolution returns to the reporting persona');

  await visit('/admin/opportunities/' + garden.id);
  await page.getByText('Edit opportunity facts', { exact: true }).click();
  const revisedTitle = 'Community garden morning — independently reviewed';
  await page.getByLabel('Title', { exact: true }).fill(revisedTitle);
  await page.getByLabel('Edit reason', { exact: true }).fill('Synthetic independent review: preserve exact prior facts.');
  expectedError = true;
  await page.route('**/api/admin/opportunities/' + garden.id, route => route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'REVIEW_INTERRUPTION', message: 'Synthetic operator refresh interruption.' } }) }) : route.continue());
  await page.getByRole('button', { name: 'Save changes for review', exact: true }).click();
  await page.getByText('New version saved for review.', { exact: true }).waitFor();
  await page.getByText('Synthetic operator refresh interruption.', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: 'Save changes for review', exact: true }).isDisabled());
  await page.unroute('**/api/admin/opportunities/' + garden.id);
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await page.locator('.op-record-meta').getByText('DRAFT', { exact: true }).waitFor();
  expectedError = false;
  const history = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Compare recorded facts', exact: true }) }).locator('details').first();
  assert(await history.getByText(garden.title, { exact: true }).isVisible());
  assert(await history.getByText(revisedTitle, { exact: true }).isVisible());
  await page.screenshot({ path: output + '/history-desktop.png', fullPage: true });
  check('Committed edits retain success after refresh failure, block stale controls, and expose exact before/after facts on retry');

  await page.setViewportSize({ width: 390, height: 844 });
  await visit('/profile'); await page.getByRole('link', { name: 'Switch persona', exact: true }).click();
  await page.getByRole('button', { name: /Sam · demo/ }).click();
  await page.getByLabel('Example age band', { exact: true }).selectOption('18-24');
  await page.getByRole('checkbox', { name: /I agree to store this synthetic demo profile/ }).check();
  await page.getByRole('button', { name: 'Create demo profile', exact: true }).click();
  await page.getByRole('heading', { name: /A good next step, Sam/ }).waitFor(); await fit('Phone dashboard');
  await visit('/matches'); await page.locator('article.opportunity-card').first().waitFor();
  await page.locator('article.opportunity-card').first().getByRole('link', { name: /Read requirements/ }).click();
  await page.getByRole('button', { name: 'Save opportunity', exact: true }).click();
  await page.getByRole('button', { name: 'Saved ✓ · remove', exact: true }).waitFor();
  await page.getByRole('button', { name: /Preview demo signup/ }).click();
  await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: 'Keep exploring', exact: true }).click();
  await visit('/saved'); await page.locator('article').first().waitFor(); await fit('Phone saved');
  await visit('/activity'); assert.equal((await api('/api/student/feedback')).body.data.length, 0); await fit('Phone activity');
  await page.screenshot({ path: output + '/activity-phone.png', fullPage: true });
  await visit('/settings/alerts'); await page.getByRole('button', { name: 'Preview shortlist', exact: true }).click();
  await page.getByText(/Preview ready:/).waitFor(); await fit('Phone digest');
  await page.screenshot({ path: output + '/digest-phone.png', fullPage: true });
  check('Phone journey completes second-persona onboarding, matching, save, signup preview, activity and digest with isolated feedback');
  await visit('/admin/reports'); await page.getByLabel('Report status', { exact: true }).selectOption('ALL'); await fit('Phone reports');
  await page.screenshot({ path: output + '/reports-phone.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 812 });
  for (const path of ['/activity', '/alerts', '/admin/reports']) { await visit(path); await fit('320px ' + path); }
  check('New student/operator controls fit at 390px and 320px');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile('docs/evidence/independent-browser.json', JSON.stringify({ verifiedAt: new Date().toISOString(), runtime: process.version, scope: 'Independent production-build journeys in installed Mac Chrome; isolated synthetic database', checks, errors, externalRequests: external }, null, 2) + '\n');
} catch (error) {
  await page?.screenshot({ path: output + '/failure.png', fullPage: true }).catch(() => {});
  console.error('Completed checks:', checks); throw error;
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) { const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await Promise.race([ended, delay(10000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  await rm(folder, { recursive: true, force: true });
}
