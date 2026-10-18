> Current account/privacy/provider/deployment work and commands are in [DEVELOPMENT.md](DEVELOPMENT.md) and [docs/production-foundations.md](docs/production-foundations.md). This earlier local-demo guide is retained for its demo-specific workflows; blanket production deferrals are superseded.

# CommonGround — reviewed local app

The application is on branch `feat/local-catalogue-matching`. Run `git log -1 --oneline` for the current checkpoint. The original README, landing page, mockup and brand page are unchanged from the upstream static site.

## Start locally

From the repository root, with the reviewed Node runtime and dependencies available:

```sh
npm run dev
```

Open **http://127.0.0.1:3100**. The launcher prints a temporary reviewer token for the **Operator** form. It binds to loopback and generates the token in memory. Stop with Control-C. No provider account or credential setup is needed.

For a fresh dependency setup, use `npm ci --ignore-scripts`. Install Node **22.23.3 or a later patched 22.x release** first. Tested with Node 22.23.3, Next 16.4.2, React 19.3.1 and TypeScript 7.0.2. Built-in `node:sqlite` is experimental in Node 22. No package install scripts are required by this build.

In the prepared local workspace, npm scripts use the official portable Node 22.23.3 under `.tools/node-v22.23.3-darwin-arm64/`; the global agent runtime is untouched. `npm run runtime:check` prints the selected runtime. The archive was verified against Node’s official SHA-256 checksums. `.tools` is excluded from Git and delivery archives. Elsewhere the launcher uses installed Node and stops clearly if it is older than 22.23.3 or outside 22.x. It never downloads a runtime automatically. See `docs/dependency-runtime-review.md`.

## Try the student flow

1. Choose **Alex · demo** in onboarding. Set example preferences and explicitly consent to local storage. Use synthetic details only.
2. The dashboard shows saved ideas, explained matches, activity and reminders. Preferences persist across reloads and process restarts.
3. **Explore** searches the full current catalogue before pagination. Category, coarse area, dates, mode and fee filters are stored in the URL for back/forward navigation.
4. Open a detail, inspect requirements and evidence, then **Save opportunity**. **Preview demo signup** opens a local destination preview. It records `OPENED`, never an application, and makes no external request.
5. **Activity** lets the persona self-report applying, withdrawing, attending or not attending. Attendance is available only after the occurrence ends. A labeled historical synthetic preview is included after consent so this path can be tried.
6. **Alerts** are off by default. Opt in to in-app event/follow-up or unavailable-listing reminders, mark them read or dismiss them, then opt out. They are computed when the app is read; no email/SMS or scheduler runs.
7. **Profile** edits preferences with version checks, exports JSON, ends the session, switches personas, or withdraws consent and deletes that persona's private data. Sam has separate stored state.
8. Requiring school credit correctly produces no eligible sample matches: no shipped sample claims approval.

9. **Alerts / Preview shortlist** manually generates up to three current explained matches. It never schedules or sends a digest. `/settings/alerts` also opens these controls.
10. On a detail, **Record feedback** stores a private fit signal or a factual listing issue. Only factual issues reach **Operator / Listing reports**, without persona identity or preferences. **Activity** shows the reporting persona’s feedback and reviewer resolution. These actions never create an application.

11. A listing can have several explicit dates. **Choose a date** updates its URL; saves, previews, feedback, activity and reminders refer to that exact date. Matching selects one eligible date per opportunity. Cancelling one date leaves reviewed active siblings available.
12. **Optional local measurement** is a separate, default-off choice in onboarding, Profile and Matches. Once enabled, visibly presented Matches shortlists can collect structured relevance and linked self-reported actions. Dashboard, focus reads and digest previews do not create exposures. Turning measurement off deletes its records without deleting the profile.

## Try the operator flow

1. Open **Operator** and use the process token. Overview reports the real local state and unconnected integrations.
2. **Catalogue / Review** opens records with facts, evidence, current availability, publication issues and audit history. New imports/edits retain exact before-and-after fact snapshots. Legacy history is labeled honestly; earlier facts cannot be reconstructed. Edit with a reason; material edits return to draft without changing source freshness. Publish or reject a draft after inspecting it.
3. Withdraw a published example, observe its unavailable state in Saved, then restore it. Restore requires another publication review.
4. **Sources** pauses every listing from that source immediately and blocks imports/publication. Resume keeps ordinary freshness and completeness checks intact.
5. **Imports** replays only named synthetic fixtures and preserves immutable import runs. Identical replays reuse the existing listing; changed facts return it to draft.
6. **Exceptions** can be acknowledged; resolution is blocked while the underlying condition remains. **Organizations** never asserts real verification. **Matching QA** exercises deterministic cases. **Outcomes** exposes aggregate self-reports without student identities or preferences.
7. **Acquisition** controls the fictional `/communities/demo-neighborhood` page and two allowlisted synthetic campaign links. Attribution is first-touch, only after profile creation and separate measurement consent. Pausing a campaign blocks new attribution; it never sends outreach.

8. **Listing reports** shows factual feedback only. Inspect the listing, correct or withdraw it if appropriate, then resolve with a reason. Resolving a report alone does not edit or verify its listing.

9. Import the manual **garden-series** fixture to try multiple dates. Its occurrence editor retains stable date IDs, supports at most 12 explicit dates and bounded fixed-UTC repetition, and cancels dates instead of removing their history. Repetition does not extend freshness. Material edits require publication review.
10. **Measurement** reports a 30-day recipient funnel, seven-day self-reported application windows, nonresponders and no-match seekers. Live totals and complementary cohorts are suppressed below three distinct opted-in personas. The two-persona app therefore shows honest suppression; a separately labeled calculation example demonstrates the arithmetic without entering live totals.

## Persistence and demonstration boundaries

A newly empty catalogue seeds once with seven diverse current listings, one formerly published historical occurrence and four blocked drafts. Existing catalogue data and edits are never reset on startup. Sources, organizations, import runs, review decisions and additional control/audit state are stored alongside separate private student tables in `.data/comground.sqlite` (ignored by Git).

Fixtures use a stable UTC day within a process. The current examples expire after three days. To refresh later, **restart the process first** to advance its fixture day, then import and review current fixtures through Operator. Reimporting within the same process reuses the same fixture dates. Alternatively use a new explicitly named database while retaining the old file:

```sh
COMGROUND_DB_PATH="$PWD/.data/another-synthetic-demo.sqlite" npm run dev
```

Fixed selectable personas are a demonstration, not secure production accounts: anyone with local access can choose either. Do not enter real personal information. The app never asks for names, email, exact birth dates or addresses. Signed cookies separate student and reviewer APIs. Student signing keys rotate on process restart; the launcher also creates a new reviewer token. Reselect a persona after restart to load its saved data. Logout clears the browser cookie; there is no production identity provider or server-side per-session revocation registry.

Deletion removes the persona's profile, saves, activity/events, reminder state, feedback/reports, alert preferences and measurement/attribution records. A database-wide anonymous revision counter remains to prevent old pre-deletion edits from becoming valid again; it contains no persona or preference information. Local SQLite storage is unencrypted and has no automatic backup. Tests cover process restarts, not machine power loss, disk failure or backup restoration.

## Verify

Run these from the worktree. HTTP and browser tests use temporary databases and clean up their loopback servers. Stop a dev server before running the legacy HTTP test because Next shares a development lock.

```sh
npm test
npm run typecheck
npm run build
npm run test:http
npm run test:full-http
npm run test:occurrences-http
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs npm run test:browser
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs npm run test:accessibility
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs npm run test:review
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs npm run test:occurrences-browser
```

The legacy HTTP regression uses port 3101 and disables seed data. Full HTTP acceptance uses the production build on port 3104, including graceful and abrupt restarts. Browser acceptance uses the production build on port 3102 in installed Chrome, blocks external requests, checks desktop and 390/320px layouts, and captures screenshots plus a short video under `output/playwright/full-app`. Elsewhere, supply an installed Playwright module and Chrome via `PLAYWRIGHT_MODULE`/`PLAYWRIGHT_CHANNEL`.

See `docs/verification.md`, `docs/full-local-app-spec.md`, `docs/full-local-architecture.md` and `docs/evidence/`. Earlier slice documents and evidence are historical records of checkpoint `ac5f7ee`; the full-app verification record supersedes them. The old closeout browser script is replaced by full-app HTTP restart tests and the current browser suite.

## Implemented versus deferred

Implemented locally: student onboarding/preferences/dashboard/discovery/details/matching/saves/self-reports/reminders/privacy controls; operator review/edit/publication/source/history/exceptions/QA/outcome/community/report workflows; manual digest preview and private/factual feedback; persistent versioned SQLite state; actual desktop/phone UI.

Deferred: real permitted data feeds and scheduled collection, production identity/authorization, safeguarding and consent policy for the chosen student cohort, external AI explanations, email/SMS delivery, organizer confirmation, certified hours/school credit, deployment/backups, and real distribution/pilot metrics. `packages/domain/providers.ts` records integration seams only. Real source policies and validation must be implemented deliberately; connecting a remote URL is not enough.

The requested local follow-up adds explicit multiple occurrences, occurrence-level student history, consented recommendation/rules-version measurement and synthetic channel attribution. Remaining feed work includes semantic duplicate/merge review and failed external-import checkpoints; named operator assignment remains a production scaling task. See `docs/occurrence-measurement-spec.md` and `docs/independent-review.md` for acceptance and the updated gap matrix.

The blueprint's business milestone gates remain unproven by this synthetic app. No real source requests, outreach, paid resources, deployments or external accounts were used.
