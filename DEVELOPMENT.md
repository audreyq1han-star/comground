# Working on CommonGround locally

The original marketing HTML, mockup, brand page and original README are preserved. The application is in `apps/web`; domain contracts are in `packages/domain`. The feature worktree is independent of the original clean `main` checkout.

## Start the synthetic demo

```sh
npm run dev
```

The reviewed launcher uses the portable Node 22.23.3 runtime under `.tools` when available, binds to `127.0.0.1:3100`, explicitly selects demo mode and prints a temporary reviewer token. It makes no external provider calls. Use synthetic data only.

## Local verification

```sh
npm run typecheck
npm test
npm run build
npm run test:full-http
npm run test:occurrences-http
npm run test:production-http
```

Browser tests use a separately available Playwright module and installed Chrome; no package installation is hidden in a test script:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:browser
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs npm run test:production-browser
```

Each harness creates a disposable synthetic database and owns its loopback server. Account-mode test harnesses set `COMGROUND_MODE=test` and use throwaway encryption keys. Verification/reset tokens are read only by local test helpers from their own disposable encrypted outbox; there is no HTTP test mailbox.

## Production-oriented code

Read [the current architecture and scope](docs/production-foundations.md), [acceptance matrix](docs/production-acceptance.md), and [deployment runbook](docs/deployment-readiness.md). Accounts, privacy, mail and AI contracts, migration, backups and restoration are implemented locally. Live integrations are not activated or verified. Real feeds remain deferred, and production supply is intentionally empty.

The deployment commands require explicit production configuration and approvals described in the runbook. Never use a demo database for production, copy secrets into the checkout, set a policy acknowledgment without approval, or run a notification worker with delivery enabled merely to test it. An existing key in the environment is not authorization to use it.

Historical demo specifications remain under `docs/` with their earlier scope. The current phase supersedes blanket deferrals of identity, notification infrastructure, bounded AI explanations and deployment tooling; it does not claim live service or legal/safeguarding approval.

## High-school local workflows and public preview

High school is the first audience, including students aged 18+. College-specific expansion is later. The synthetic 13–17 journey only exists in explicit test mode with `COMGROUND_TEST_FIXTURES=1`; under-13 accounts and all real minor enrollment remain disabled. Test-only local adult assignment is not verified guardian/school authority. Teens never use external AI, outbound email or measurement.

The isolated redesigned public site is in [apps/public-site](apps/public-site/README.md), with real Magic UI components and a fictional interactive preview. It runs at `http://127.0.0.1:3120`; it stores no personal data and performs no API writes. Original marketing HTML stays unchanged.

The exact implementation map is [the high-school blueprint matrix](docs/high-school-blueprint-matrix.md). Additional contracts are documented in [synthetic outcome evidence](docs/evidence-synthetic.md), [deployment operations](docs/deployment-operations.md). Source operations, safety moderation, distribution, evidence and readiness have dedicated operator pages; actual verified operator accounts are required for account-based workflows.

New browser harnesses, after the main build, use the already installed Playwright module and their own loopback ports:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/with-local-node.mjs --experimental-strip-types tests/high-school-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/with-local-node.mjs --experimental-strip-types tests/safety-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/with-local-node.mjs --experimental-strip-types tests/distribution-browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/with-local-node.mjs --experimental-strip-types tests/source-control-browser.mjs
npm run test:performance
npm run quality:local
```

These use disposable synthetic accounts and do not establish live source reliability, actual consent, organizer confirmation or successful delivery. `quality:local -- --browser` adds existing browser suites; check the script and port availability before concurrent runs.
