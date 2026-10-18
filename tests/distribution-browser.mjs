import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { adultProfile, createProductionHarness, dataOf, expectStatus, syntheticPassword } from '../scripts/test-production-http.mjs';

// Requires the shared build; each run uses an isolated loopback server and disposable DB.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const h = await createProductionHarness(3116), output = 'output/playwright/distribution';
const accounts = { student: { email: 'digest.student.synthetic@example.invalid', password: syntheticPassword() }, operator: { email: 'digest.operator.synthetic@example.invalid', password: syntheticPassword() } };
const errors = [], external = [], checks = [];
let browser;
const check = name => { checks.push(name); console.log('PASS', name); };
async function visit(page, path) { await page.goto(h.base + path); await page.waitForLoadState('networkidle'); }
async function fit(page, name) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} fits viewport`); }
async function login(page, account) {
  await visit(page, '/account/login'); await page.getByLabel('Email address', { exact: true }).fill(account.email); await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'You’re signed in.', exact: true }).waitFor();
}
async function context(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== h.base && !['data:', 'blob:'].includes(url.protocol)) { external.push(url.origin); return route.abort(); } return route.continue(); });
  const page = await ctx.newPage(); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (/Content Security Policy/.test(message.text())) errors.push(message.text()); }); return page;
}
try {
  await mkdir(output, { recursive: true }); await mkdir('docs/evidence', { recursive: true });
  await h.start('test', { COMGROUND_TEST_FIXTURES: '1', COMGROUND_SKIP_DEMO_SEED: '0' });
  for (const [actor, account] of Object.entries(accounts)) {
    expectStatus(await h.request('/api/account/register', { method: 'POST', body: { ...account, adultConfirmed: true } }), 202);
    expectStatus(await h.request('/api/account/verification/confirm', { method: 'POST', body: { token: h.actionLink(account.email, 'VERIFY_EMAIL').token, password: account.password } }));
    if (actor === 'operator') h.bootstrap(account.email);
    expectStatus(await h.request('/api/account/session', { actor, method: 'POST', body: account }));
  }
  const profile = adultProfile(0, true); profile.preferences.ageMin = 18; profile.preferences.ageMax = 18;
  const saved = dataOf(await h.request('/api/student/profile', { actor: 'student', method: 'PUT', body: profile }));
  assert.equal(dataOf(await h.request('/api/student/digest', { actor: 'student' })).enabled, false);
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const student = await context(), operator = await context(1440);
  await login(student, accounts.student); await visit(student, '/digest');
  await student.getByRole('button', { name: 'Prepare private preview', exact: true }).click();
  await student.getByText(/current options · checked/).waitFor();
  assert.equal(await student.getByRole('checkbox', { name: /Enable optional shortlist digest emails/ }).isChecked(), false);
  await student.getByRole('checkbox', { name: /Enable optional shortlist digest emails/ }).check();
  await student.getByRole('button', { name: 'Save digest choice', exact: true }).click();
  await student.getByText('Digest subscription saved.', { exact: false }).waitFor();
  for (const width of [320, 390, 768, 1440]) { await student.setViewportSize({ width, height: 1000 }); await fit(student, `Student digest at ${width}px`); }
  await student.setViewportSize({ width: 390, height: 1000 }); await fit(student, 'Settled digest phone'); assert.equal(await student.getByRole('heading', { name: 'A fresh look at your next step.', exact: true }).count(), 1); await student.screenshot({ path: `${output}/digest-phone.png`, fullPage: false }); await student.locator('form.settings-panel').screenshot({ path: `${output}/digest-choice-phone.png` });
  check('Private preview and distinct default-off digest subscription work at 320/390/768/1440px');
  await login(operator, accounts.operator); await visit(operator, '/admin/distribution');
  await operator.getByLabel('Batch label', { exact: true }).fill('Synthetic browser review');
  await operator.getByRole('button', { name: 'Prepare batch preview', exact: true }).click();
  const batchCard = operator.locator('article').filter({ has: operator.getByRole('heading', { name: 'Synthetic browser review', exact: true }) });
  await batchCard.waitFor(); await batchCard.getByText(/Preview the reviewed public opportunities/).click();
  assert.equal(await batchCard.getByRole('button', { name: 'Approve reviewed batch', exact: true }).isEnabled(), false);
  await batchCard.getByRole('checkbox', { name: /I reviewed the public opportunity dates/ }).check();
  await batchCard.getByRole('button', { name: 'Approve reviewed batch', exact: true }).click();
  await batchCard.getByRole('button', { name: 'Queue current approved digests', exact: true }).click();
  await operator.getByText('Eligible current digests were queued.', { exact: false }).waitFor();
  assert.equal(await operator.getByText(accounts.student.email, { exact: false }).count(), 0);
  h.database(db => { const row = db.prepare("SELECT state FROM notification_outbox WHERE purpose='DIGEST'").get(); assert.equal(row?.state, 'BLOCKED'); });
  for (const width of [320,390,768,1440]) { await operator.setViewportSize({ width, height: 1000 }); await fit(operator, `Distribution at ${width}px`); }
  await operator.screenshot({ path: `${output}/digest-review-desktop.png`, fullPage: true });
  check('Operator reviews exact public dates, approves a version and queues only an encrypted blocked request; student identity stays hidden');
  await student.getByRole('checkbox', { name: /Enable optional shortlist digest emails/ }).uncheck();
  await student.getByRole('button', { name: 'Save digest choice', exact: true }).click();
  await student.getByText('Digest subscription is off.', { exact: false }).waitFor();
  h.database(db => { assert.equal(db.prepare("SELECT state FROM notification_outbox WHERE purpose='DIGEST'").get()?.state, 'CANCELLED'); });
  check('Student withdrawal removes prepared selections and cancels the pending digest');
  await visit(operator, '/admin/community-pages');
  await operator.getByLabel('Page title', { exact: true }).fill('Fictional browser school club');
  await operator.getByLabel('Public URL slug', { exact: true }).fill('fictional-browser-club');
  await operator.getByLabel('Page description', { exact: true }).fill('Explore manually reviewed local volunteering examples for students.');
  await operator.getByRole('button', { name: 'Create draft', exact: true }).click();
  const pageCard = operator.locator('article').filter({ has: operator.getByRole('heading', { name: 'Fictional browser school club', exact: true }) });
  await pageCard.getByRole('button', { name: 'Approve this copy', exact: true }).click();
  await pageCard.getByRole('link', { name: 'Open public page', exact: true }).waitFor();
  await visit(student, '/communities/fictional-browser-club'); await student.getByRole('heading', { name: 'Fictional browser school club', exact: true }).waitFor();
  await student.getByText('Synthetic example — no school, community or organizer partnership is claimed.', { exact: true }).waitFor();
  await fit(student, 'Public synthetic community at phone width'); await student.screenshot({ path: `${output}/community-phone.png`, fullPage: true });
  await pageCard.getByRole('button', { name: 'Pause page', exact: true }).click();
  await pageCard.getByRole('button', { name: 'Archive inactive page', exact: true }).click();
  await pageCard.getByText('ARCHIVED', { exact: true }).waitFor();
  await visit(student, '/communities/fictional-browser-club'); await student.getByRole('heading', { name: 'This community page is unavailable.', exact: true }).waitFor();
  for (const width of [320,390,768,1440]) { await operator.setViewportSize({ width, height: 1000 }); await fit(operator, `Community controls at ${width}px`); }
  check('Manual community draft, review, public disclosure, pause and audited archival work across phone and desktop widths');
  const held = await h.beginStreamedRequest('/api/student/digest', { actor: 'student', method: 'PUT', body: { enabled: true, expectedVersion: 2, expectedProfileVersion: saved.version } });
  expectStatus(await h.request('/api/account/session', { actor: 'student', method: 'DELETE' }));
  assert([401,403].includes((await held.finish()).status));
  const heldOperator = await h.beginStreamedRequest('/api/admin/distribution', { actor: 'operator', method: 'POST', body: { label: 'Must not be prepared' } });
  expectStatus(await h.request('/api/account/session', { actor: 'operator', method: 'DELETE' }));
  assert([401,403].includes((await heldOperator.finish()).status));
  check('Real session logout while the body is held blocks both student subscription and operator batch mutations');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile('docs/evidence/distribution-browser.json', JSON.stringify({ verifiedAt: new Date().toISOString(), checks, pageErrors: errors, externalRequests: external, externalProviderCalls: 0, mode: 'synthetic-local-only', screenshots: [`${output}/digest-phone.png`, `${output}/digest-choice-phone.png`, `${output}/digest-review-desktop.png`, `${output}/community-phone.png`] }, null, 2));
} finally { await browser?.close(); await h.cleanup(); }
