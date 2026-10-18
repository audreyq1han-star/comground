import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createProductionHarness, syntheticPassword, expectStatus } from './test-production-http.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const h = await createProductionHarness(3111), output = 'output/playwright/production-account';
const checks = [], pageErrors = [], cspErrors = [], externalRequests = [], requestUrls = [];
const email = 'browser.adult.synthetic@example.invalid', initialPassword = syntheticPassword(), changedPassword = syntheticPassword(), resetPassword = syntheticPassword();
let browser, context, page, otherContext, walkthroughContext, walkthroughPath, demoHarness;
function check(name) { checks.push(name); console.log('PASS', name); }
async function eventually(fn, message) { for (let i = 0; i < 70; i++) { if (await fn()) return; await delay(100); } assert.fail(message); }
async function visit(path, target = page) { const response = await target.goto(h.base + path); await target.waitForLoadState('networkidle'); return response; }
async function api(path, method = 'GET', body, target = page) {
  return target.evaluate(async ({ path, method, body }) => { const response = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, data: await response.json() }; }, { path, method, body });
}
async function okay(path, method = 'GET', body, target = page) { const result = await api(path, method, body, target); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; }
async function shot(name) { await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); }
async function fit(label) { const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth, items: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(node => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right })) })); assert(dimensions.content <= dimensions.viewport, `${label}: ${JSON.stringify(dimensions)}`); }
function observe(target) { target.on('pageerror', error => pageErrors.push(error.message)); target.on('console', item => { if (/Content Security Policy|Refused to execute|Refused to load/.test(item.text())) cspErrors.push(item.text()); }); }
async function restrictNetwork(target) { await target.route('**/*', route => { const url = new URL(route.request().url()); requestUrls.push(url.href); if (url.origin !== h.base && !['data:', 'blob:'].includes(url.protocol)) { externalRequests.push(url.origin); return route.abort(); } return route.continue(); }); }
async function login(target = page, password = initialPassword, address = email) {
  await visit('/account/login', target); await target.getByLabel('Email address', { exact: true }).fill(address); await target.getByLabel('Password', { exact: true }).fill(password); await target.getByRole('button', { name: 'Sign in', exact: true }).click(); await target.getByRole('heading', { name: 'You’re signed in.', exact: true }).waitFor();
}
async function createProfile() {
  await visit('/onboarding'); await page.getByLabel('Age band', { exact: true }).selectOption('18-24');
  const bands = await page.getByLabel('Age band', { exact: true }).locator('option').evaluateAll(nodes => nodes.map(node => node.value)); assert.deepEqual(bands, ['18-24', '25-99']);
  assert.equal(await page.getByRole('checkbox', { name: /Enable personalized matching/ }).isChecked(), false);
  assert.equal(await page.getByRole('checkbox', { name: /Allow optional AI explanations/ }).isChecked(), false);
  await page.getByRole('checkbox', { name: /I agree to store my student profile and private activity/ }).check();
  await page.getByRole('checkbox', { name: /I confirm I am at least 18 and have read/ }).check();
  await page.getByRole('button', { name: /Create student profile/ }).click();
  await eventually(async () => !!(await okay('/api/student/profile')).data, 'A profile was stored after explicit adult and storage consent.');
}
async function reauthenticate() {
  await page.getByText('Confirm your password for sensitive actions', { exact: true }).click();
  await page.getByLabel('Password', { exact: true }).fill(resetPassword); await page.getByRole('button', { name: 'Confirm password', exact: true }).click();
  await page.getByText('Password confirmed. Sensitive actions are available for a limited time.', { exact: true }).waitFor();
}
try {
  await mkdir(output, { recursive: true }); await h.start();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await restrictNetwork(context);
  page = await context.newPage(); observe(page);
  const firstDocument = await visit('/account/signup');
  const policy = firstDocument.headers()['content-security-policy']; assert(policy); assert(policy.includes("frame-ancestors 'none'")); assert(policy.includes("base-uri 'none'")); assert(!/script-src[^;]*unsafe-inline/.test(policy)); assert(!/script-src[^;]*unsafe-eval/.test(policy));
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1]; assert(nonce); assert(await page.locator('script').evaluateAll((scripts, expected) => scripts.filter(script => !script.src && script.textContent.trim()).every(script => script.nonce === expected), nonce));
  const secondDocument = await visit('/account/signup'); assert.notEqual(secondDocument.headers()['content-security-policy'].match(/'nonce-([^']+)'/)?.[1], nonce);
  check('Dynamic documents carry fresh nonce CSP and hydrate without allowing inline or eval scripts');
  await page.getByLabel('Age band', { exact: true }).selectOption('ADULT');
  await page.getByText(/Email delivery is not activated for this app/).waitFor();
  await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(initialPassword);
  await page.getByRole('checkbox', { name: /I confirm I am at least 18 years old/ }).check();
  const registered = page.waitForResponse(response => response.url().endsWith('/api/account/register') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); assert.equal((await registered).status(), 202);
  await page.getByText(/If this address can receive the requested account message/).waitFor(); assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
  await shot('01-signup-request-disabled-delivery'); check('Synthetic adult signup uses real controls, clears password input and reports disabled delivery honestly');
  const verification = h.actionLink(email, 'VERIFY_EMAIL'); await visit(verification.path); await page.getByRole('button', { name: 'Verify email', exact: true }).waitFor();
  assert(!page.url().includes('#') && !page.url().includes(verification.token)); assert(requestUrls.every(url => !url.includes(verification.token)));
  await page.getByLabel('New password', { exact: true }).fill(initialPassword); await page.getByRole('button', { name: 'Verify email', exact: true }).click(); await page.getByRole('heading', { name: 'Email verified.', exact: true }).waitFor();
  assert.equal((await okay('/api/account/session')).authenticated, false); check('Encrypted local verification link is consumed through its real screen without a URL/query leak or automatic login');
  await login(); await createProfile();
  let privacy = (await okay('/api/student/privacy')).data; assert.equal(privacy.storage, true); assert.equal(privacy.personalization, false); assert.equal(privacy.aiExplanations, false);
  assert.equal((await okay('/api/student/measurement')).data.enabled, false); assert.equal((await okay('/api/student/notifications/preferences')).data.enabled, false);
  check('Adult onboarding requires separate storage consent and leaves personalization, AI, measurement and email off');
  await visit('/account/privacy'); await page.getByRole('checkbox', { name: /Enable personalized matching/ }).check();
  await page.getByRole('button', { name: 'Save privacy choices', exact: true }).click();
  await page.getByText('Privacy choices saved. New matching and explanations use these choices.', { exact: true }).waitFor();
  privacy = (await okay('/api/student/privacy')).data; assert.equal(privacy.personalization, true); assert.equal(privacy.aiExplanations, false);
  await shot('privacy-desktop'); check('Privacy controls persist the independent personalization choice while optional AI remains disabled');
  await visit('/account'); await shot('account-desktop');
  await page.setViewportSize({ width: 390, height: 900 }); await visit('/account'); await fit('Account overview at 390');
  assert.equal(await page.getByRole('heading', { name: 'Your account, your choices.', exact: true }).count(), 1);
  await page.screenshot({ path: `${output}/account-phone.png`, fullPage: false }); await page.setViewportSize({ width: 1440, height: 1000 });
  if (process.env.COMGROUND_ACCEPTANCE_RECORD_VIDEO !== '0') {
  walkthroughContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await context.storageState(), recordVideo: { dir: output + '/walkthrough', size: { width: 1440, height: 900 } } });
  await restrictNetwork(walkthroughContext);
  const walkthrough = await walkthroughContext.newPage(); observe(walkthrough);
  for (const path of ['/account', '/account/privacy', '/account/notifications']) { await visit(path, walkthrough); await delay(1800); }
  const video = walkthrough.video(); await walkthroughContext.close(); walkthroughContext = undefined; walkthroughPath = await video.path();
  }
  await visit('/matches'); await eventually(async () => (await okay('/api/student/matches', 'POST', {})).data.length === 0, 'Unseeded account catalogue produces a real empty shortlist.');
  assert.equal(await page.locator('[data-opportunity-id]').count(), 0); await shot('03-empty-account-shortlist'); check('Account-mode matching displays an empty real catalogue without synthetic opportunity cards');
  await visit('/account/notifications'); await page.getByRole('checkbox', { name: /Enable optional email event reminders/ }).check(); await page.getByRole('button', { name: 'Save email reminder preference', exact: true }).click();
  await page.getByText('Current saved choice: on.', { exact: false }).waitFor(); assert.equal((await okay('/api/student/notifications/preferences')).data.enabled, true);
  await page.getByText(/Email delivery is not activated\. A saved choice will not send email/).waitFor(); await shot('04-notification-queue-disabled');
  await page.getByRole('checkbox', { name: /Enable optional email event reminders/ }).uncheck(); await page.getByRole('button', { name: 'Save email reminder preference', exact: true }).click(); await page.getByText('Email reminders are off. Pending reminder sends are cancelled.', { exact: true }).waitFor();
  assert.equal((await okay('/api/student/notifications/preferences')).data.enabled, false); check('Optional email reminder controls persist opt-in and opt-out while showing that nothing is delivered');
  otherContext = await browser.newContext(); await restrictNetwork(otherContext); const other = await otherContext.newPage(); observe(other); await login(other);
  await visit('/account/sessions'); const otherSession = page.getByRole('button', { name: /^Revoke session \d+$/ }).first(); await otherSession.waitFor(); await otherSession.click();
  await page.getByText('Session revoked.', { exact: true }).waitFor(); assert.equal((await okay('/api/account/session', 'GET', undefined, other)).authenticated, false); assert.equal((await okay('/api/account/session')).authenticated, true);
  await otherContext.close(); otherContext = undefined; check('Session-management UI revokes another authenticated session while preserving the current session');
  await visit('/account/password'); await page.getByLabel('Current password', { exact: true }).fill(initialPassword); await page.getByLabel('New password', { exact: true }).fill(changedPassword); await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByText('Password changed. Review your active sessions below.', { exact: true }).waitFor();
  await visit('/account'); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('heading', { name: 'Sign in to continue.', exact: true }).waitFor();
  await visit('/account/recover'); await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByRole('button', { name: 'Send recovery instructions', exact: true }).click(); await page.getByText(/If this address can receive the requested account message/).waitFor();
  const recovery = h.actionLink(email, 'RESET_PASSWORD'); await visit(recovery.path); await page.getByLabel('New password', { exact: true }).fill(resetPassword); assert(!page.url().includes('#')); await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await page.getByText('Password reset. Sign in with your new password.', { exact: true }).waitFor(); assert(requestUrls.every(url => !url.includes(recovery.token)));
  await login(page, resetPassword); check('Password change, sign-out, recovery and fragment reset complete through real controls with no token URL leak');
  await visit('/account/privacy'); await reauthenticate();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export my private data', exact: true }).click(); const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), 'utf8')); assert.equal(exported.identity.account.email, email); assert(exported.identity.sessions.length); assert(exported.student.profile); assert(exported.notifications);
  const serialized = JSON.stringify(exported); for (const secret of [initialPassword, changedPassword, resetPassword, verification.token, recovery.token]) assert(!serialized.includes(secret)); assert(!/"(?:password_hash|token_hash|envelope)"/.test(serialized));
  check('Recent-auth account export includes owned identity and private data while excluding credentials, tokens and message bodies');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [path, name] of [['/account/privacy', 'privacy'], ['/account/notifications', 'notifications'], ['/account/sessions', 'sessions'], ['/account/password', 'password']]) { await visit(path); await fit(`${name} at ${width}`); await shot(`phone-${width}-${name}`); }
  }
  check('Account privacy, email, sessions and password controls fit 390px and 320px without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 }); await visit('/account/privacy');
  await page.getByRole('checkbox', { name: /Delete my student data and withdraw storage consent/ }).check(); await page.getByRole('button', { name: 'Withdraw storage consent and delete student data', exact: true }).click();
  await page.getByRole('heading', { name: 'No student profile is stored.', exact: true }).waitFor(); assert.equal((await okay('/api/student/profile')).data, null); assert.equal((await okay('/api/account/session')).authenticated, true);
  await shot('05-storage-withdrawn-account-retained'); await createProfile(); check('Storage withdrawal deletes private student state, preserves login and permits new explicitly consented onboarding');
  await visit('/account/privacy'); await page.getByRole('checkbox', { name: /Delete my login account and all its private student data/ }).check(); await page.getByRole('button', { name: 'Delete my account', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign in to continue.', exact: true }).waitFor(); assert.equal((await okay('/api/account/session')).authenticated, false); assert.equal(h.account(email), undefined); await shot('06-account-deleted');
  check('Account deletion visibly signs out and removes the durable account after explicit confirmation');
  const operatorEmail = 'browser.operator.synthetic@example.invalid', operatorPassword = syntheticPassword();
  expectStatus(await h.request('/api/account/register', { method: 'POST', body: { email: operatorEmail, password: operatorPassword, adultConfirmed: true } }), 202);
  expectStatus(await h.request('/api/account/verification/confirm', { method: 'POST', body: { token: h.actionLink(operatorEmail, 'VERIFY_EMAIL').token, password: operatorPassword } }));
  h.bootstrap(operatorEmail); await login(page, operatorPassword, operatorEmail); await visit('/admin'); await shot('operator-desktop');
  assert.equal((await okay('/api/account/session')).account.role, 'OPERATOR');
  const summary = (await okay('/api/admin/notifications')).data; assert.equal(summary.includesRecipients, false); assert.equal(summary.includesMessageBodies, false); assert.equal(summary.deliveryEnabled, false);
  check('Offline-bootstrapped operator signs in through account UI and sees empty supply with privacy-safe notification status');
  await context.close(); context = undefined; await h.stop();
  demoHarness = await createProductionHarness(3111); await demoHarness.start('demo');
  context = await browser.newContext({ viewport: { width: 390, height: 900 } }); await restrictNetwork(context); page = await context.newPage(); observe(page);
  for (const path of ['/account/signup', '/account/login', '/account/privacy', '/account/notifications']) {
    await visit(path); await page.getByRole('heading', { name: 'This app uses shared example personas.', exact: true }).waitFor();
    assert.equal(await page.locator('input[type=email],input[type=password]').count(), 0); await fit('Demo account explanation');
  }
  check('Demo account URLs explain shared personas and never collect email or password credentials');
  assert.deepEqual(pageErrors, []); assert.deepEqual(cspErrors, []); assert.deepEqual(externalRequests, []);
  check('All account journeys complete with no page exceptions, CSP violations or external requests');
} finally {
  try { await walkthroughContext?.close(); await otherContext?.close(); await context?.close(); await browser?.close(); } finally { await demoHarness?.cleanup(); await h.cleanup(); }
}
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/production-browser.json', JSON.stringify({ verifiedAt: new Date().toISOString(), checks, screenshots: output, walkthrough: walkthroughPath ?? null, externalProviderCalls: 0, mode: 'test', syntheticAccountsOnly: true, limits: ['Verification/reset tokens were independently decrypted from this run’s disposable encrypted outbox; no mailbox or external provider was contacted.', 'No actual email delivery, external AI, public TLS, deployment or verified age is claimed.'] }, null, 2) + '\n');
