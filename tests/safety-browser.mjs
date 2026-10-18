import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createProductionHarness, syntheticPassword, expectStatus } from '../scripts/test-production-http.mjs';

// Run after the shared build: PLAYWRIGHT_MODULE=<installed playwright> node --experimental-strip-types tests/safety-browser.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const h = await createProductionHarness(3114), output = 'output/playwright/safety';
const teenEmail = 'safety.teen.synthetic@example.invalid', operatorEmail = 'safety.operator.synthetic@example.invalid';
const teenPassword = syntheticPassword(), operatorPassword = syntheticPassword();
const errors = [], external = [], checks = [];
let browser;
const check = name => { checks.push(name); console.log('PASS', name); };
async function visit(page, path) { await page.goto(h.base + path); await page.waitForLoadState('networkidle'); }
async function fit(page, name) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits viewport`); }
async function login(page, email, password) {
  await visit(page, '/account/login'); await page.getByLabel('Email address', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'You’re signed in.', exact: true }).waitFor();
}
async function context(viewport) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await ctx.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== h.base && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin); return route.abort(); } return route.continue(); });
  const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || /Content Security Policy/.test(message.text())) errors.push(message.text()); });
  return page;
}
try {
  await mkdir(output, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
  await h.start('test', { COMGROUND_TEST_FIXTURES: '1', COMGROUND_SKIP_DEMO_SEED: '0' });
  expectStatus(await h.request('/api/account/register', { method: 'POST', body: { email: teenEmail, password: teenPassword, ageBand: 'TEEN_13_17', synthetic: true } }), 202);
  expectStatus(await h.request('/api/account/register', { method: 'POST', body: { email: operatorEmail, password: operatorPassword, adultConfirmed: true } }), 202);
  expectStatus(await h.request('/api/account/verification/confirm', { method: 'POST', body: { token: h.actionLink(operatorEmail, 'VERIFY_EMAIL').token, password: operatorPassword } }));
  h.bootstrap(operatorEmail);
  const listing = expectStatus(await h.request('/api/opportunities')).data[0]; assert(listing);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const student = await context({ width: 390, height: 900 }), operator = await context({ width: 1440, height: 1000 });
  await login(student, teenEmail, teenPassword);
  await visit(student, `/safety?opportunityId=${encodeURIComponent(listing.id)}&occurrenceId=${encodeURIComponent(listing.occurrenceId ?? 'primary')}`);
  await student.getByRole('heading', { name: 'Record a private concern', exact: true }).waitFor();
  assert.equal(await student.getByRole('button', { name: 'Record private concern', exact: true }).isEnabled(), false);
  await student.getByLabel('How urgent is this concern?', { exact: true }).selectOption('TIME_SENSITIVE');
  await student.getByLabel('Optional example details', { exact: true }).fill('Synthetic example: the activity conditions need review.');
  await student.getByRole('checkbox', { name: /Store this example report and its review history/ }).check();
  await student.getByRole('button', { name: 'Record private concern', exact: true }).click();
  await student.getByText('Your example report was recorded.', { exact: false }).waitFor();
  await student.getByRole('heading', { name: listing.title, exact: true }).waitFor();
  await fit(student, 'Pending teen safety at 390px'); await student.screenshot({ path: `${output}/safety-phone.png`, fullPage: true });
  await student.setViewportSize({ width: 320, height: 800 }); await fit(student, 'Pending teen safety at 320px');
  check('Pending synthetic teen without profile can consent, report an exact listing date and read receipt at 390px/320px');
  await login(operator, operatorEmail, operatorPassword); await visit(operator, '/admin/safety');
  await operator.getByRole('heading', { name: listing.title, exact: true }).waitFor();
  assert.equal(await operator.getByText(teenEmail, { exact: false }).count(), 0);
  await operator.getByRole('button', { name: 'Record decision', exact: true }).click();
  await operator.getByLabel('Report status', { exact: true }).selectOption('IN_REVIEW');
  await operator.getByRole('heading', { name: listing.title, exact: true }).waitFor();
  await operator.getByText(h.account(operatorEmail).id, { exact: true }).first().waitFor();
  await operator.getByLabel('Next status and reason', { exact: true }).selectOption({ label: 'Request listing withdrawal review' });
  await operator.getByRole('checkbox', { name: /I inspected the underlying listing/ }).check();
  await operator.getByRole('button', { name: 'Record decision', exact: true }).click();
  await operator.getByText('Listing withdrawal review requested.', { exact: false }).waitFor();
  await operator.screenshot({ path: `${output}/safety-operator.png`, fullPage: true }); await fit(operator, 'Operator safety queue');
  await operator.setViewportSize({ width: 390, height: 900 }); await fit(operator, 'Operator safety at 390px');
  assert.equal((await h.request(`/api/opportunities/${listing.id}?occurrence=${listing.occurrenceId ?? 'primary'}`)).status, 200, 'request alone does not bypass publication controls');
  check('Operator review and withdrawal request persist with bounded rationale and no reporter identity');
  await student.getByRole('button', { name: 'Refresh report status', exact: true }).click();
  await student.getByText('An operator requested a listing withdrawal review.', { exact: false }).waitFor();
  await student.getByRole('checkbox', { name: 'Delete this report and its review history.', exact: true }).check();
  await student.getByRole('button', { name: 'Delete report', exact: true }).click();
  await student.getByRole('heading', { name: 'No private reports recorded.', exact: true }).waitFor();
  check('Reporter receives in-app status and can delete the report and review history');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile('docs/evidence/safety-browser.json', JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, externalRequests: external, mode: 'synthetic-local-only', screenshots: [`${output}/safety-phone.png`, `${output}/safety-operator.png`] }, null, 2));
} finally { await browser?.close(); await h.cleanup(); }
