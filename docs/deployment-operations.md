# Local operational controls and expansion review

This is a reviewable single-Linux-host package. No service, timer, image, proxy, external provider or hosted CI job was activated. `docker compose config --quiet` passed with a temporary blank environment template and dummy image name; no container/daemon action was requested. Docker/nginx/systemd templates also have source-contract tests, but no container, installed proxy or unit was executed here. Local tests execute real temporary SQLite migrations, encryption/recovery and filesystem lock behavior. The distinction matters: a passing source check does not validate an installed proxy or host.

## Edge admission

The nginx template is an internet-facing edge on the same host as the loopback-published application. It keys limits from the actual socket address. Do not enable `real_ip_header`, `set_real_ip_from` or PROXY protocol, and do not put another proxy/CDN in front without reviewing that trust boundary. Incoming forwarding headers never select a rate bucket; the proxy replaces upstream Host, forwarded host/proto/port/IP and removes `Forwarded`.

The initial, reviewable budgets are:

| Budget | Limit |
| --- | --- |
| General requests per socket IP | 10/second, burst 30 |
| Account mutations per socket IP | 10/minute, burst 5 |
| Account mutations across the host | 4/second, burst 4 |
| Active account requests | 2 per IP, 8 total |
| General active requests | 20 per IP, 128 total |
| Request body | 64 KiB, buffered before forwarding |
| Header/body idle time | 10 seconds |
| Keepalive | 15 seconds, at most 100 requests |

Account mutation limits include login, registration, password/recovery/verification, future `/api/account/` mutation paths and the operator session endpoint. Nginx returns 429 when a budget is exceeded. Application account/KDF admission checks remain necessary. These are starting values, not measured production capacity: test authentication bursts, distributed traffic and shared-school/NAT behavior against the installed proxy, and record reviewed adjustments. A global budget protects expensive work even when a caller rotates addresses; it cannot guarantee availability against a distributed attack.

Unknown HTTP hosts are rejected, unknown TLS names fail the handshake, and a mismatching Host on an accepted TLS connection returns 421. Replace the fixed hostname in **every** template occurrence and match `COMGROUND_ORIGIN` exactly. Use the installed `nginx -t` before reloading. The access log excludes addresses, query strings, cookies and user agents; error logs still require restricted access and a retention review. Do not log request bodies or webhook signatures.

## Process and job coordination

`deploy/locks.mjs` coordinates the shipped production commands through private, exclusively created files beside the exact configured database:

- `.operation-lock` serializes backup, worker, retention, migration, restore and restore-review commands. Acquisition is non-waiting: contention fails with an observable error instead of creating a hidden queue.
- `.service-lock` belongs to the app launched by `production-start.mjs`, and remains until its Next process closes. A second managed app and stopped-service operations are refused. Startup acquires the service lease while holding the operation lock so migration cannot slip between validation and launch.
- `.maintenance-lock` identifies stopped-service migration/reconciliation/release. Readiness refuses it. Online encrypted backups, bounded mail jobs and approved retention may run alongside the one application process; the operation lock serializes those jobs with each other.

All containers must share the same local `/data` volume and database path. Do not launch `next start` directly, use a second database alias, or run arbitrary scripts against the live database. These are cooperative local controls, not distributed leases or an enforcement boundary against an operator with filesystem access. SQLite foreign keys, busy timeouts and notification leases/idempotency remain the data-level controls. `notifications-worker.mjs` also takes the production readiness/operation gate when used in production.

Normal completion releases owned locks. A crash, forced timeout, power loss or SIGKILL deliberately leaves a lock. No PID or elapsed-time heuristic steals it; container PIDs are not a reliable cross-container liveness signal. Stop traffic and timers, check all app/job containers and host processes, retain incident evidence, and only then have the operator remove the confirmed stale lock(s) from the exact database directory. Never remove a migration-state or restore-quarantine database marker to make startup succeed. Replacement lock ownership is checked before cleanup.

## Uninstalled scheduling templates

`deploy/systemd` includes worker, backup and maintenance one-shot services and timers. Their `.example` suffixes are intentional. They require operator installation, approved Docker access, private environment files and a corresponding enable marker under `/etc/comground/enabled/`. None of those files or units is installed by the code. Docker access is effectively host-level authority; service sandbox directives do not remove that daemon authority.

| Job | Proposed schedule | Required review/configuration |
| --- | --- | --- |
| Worker | Each minute, up to 5 seconds jitter | Approved delivery, configured sender/credentials, `/etc/comground/enabled/worker` |
| Backup | Daily 02:15 UTC, up to 15 minutes jitter | Separate backup key, volume capacity, custody/retention plan, `/etc/comground/enabled/backup` |
| Retention | Daily 03:15 UTC, up to 15 minutes jitter | Both explicit 7–365 day policies in private `/etc/comground/maintenance.env`, `/etc/comground/enabled/maintenance` |

The units read `/etc/comground/compose.env` for the approved image and runtime-file locations. Copy `maintenance.env.example` only after choosing the actual retention periods; its blanks fail closed. The schedules do not catch up missed invocations (`Persistent=false`). Adjust times to the reviewed capacity window. Configure host monitoring for failed units, lock contention, backup freshness/size, low disk space and unhealthy app checks. A missed backup is not success; investigate and rerun explicitly. A Docker healthcheck marks health but does not itself guarantee a restart or an alert.

Every job forbids image pulls/builds, has a bounded timeout and uses a reserved `comground-*-job` container name. `ExecStopPost` removes that specific container because killing the Docker client alone can leave a container running. Reserve these names for the templates. Forced termination may leave a database operation lock; follow the stale-lock procedure. Stop timers and wait for/stop all job containers before migrations or recovery cutover.

Scheduled backups use `production-backup.mjs --scheduled`, generating a unique timestamp/UUID directory in `/backups`. The tool never overwrites or expires a bundle. There is no automatic deletion policy or remote transfer; approval of retention and independent encrypted custody is still required. The same-host backup volume does not protect against host loss.

## Migration and recovery contract

The explicit schema step initializes catalogue/source-control, identity/youth-review, private student/evidence data, measurement, digest/community workflows, notifications/receipts, safety reports, matching evaluation audit and AI usage before writing its deployment marker. Required tables/columns, uniqueness rules, privacy deletion cascades and immutable evaluation triggers are checked on readiness and restoration. Schema creation does not enable or call a provider. Synthetic youth/review, evidence, source-control and new community-page records are refused in production even though their empty additive schemas exist there. Adult account ages and digest workflow data are allowed. Matching evaluation runs are deliberately allowed as retained synthetic QA evidence: they contain curated cases and operator audit, not student profiles or publishable supply, and must not be described as real pilot evidence.

Stop the app and every scheduled/manual job before upgrade. The migration command refuses a live managed service lease and requires a unique encrypted pre-migration backup for an existing database. Constructors are not promised to be one global transaction; incomplete migration retains its `migration_state=running` marker. Retry only after investigation, or use the recorded pre-release image and backup. Keep both exact image/tool versions and their configuration contract as part of the release record. Older incompatible snapshots may require the matching older restore tooling plus a reviewed forward migration; never bypass required-schema checks in the new tool.

Restoration still requires an unused target, authenticated ciphertext, independent keys, complete schema and full SQLite/FK integrity. The new database remains quarantined until post-snapshot deletion/suppression replay and approved retention reconciliation succeed. Release revokes sessions/action tokens, cancels unsent notifications and digest batches, disables restored digest subscriptions and clears every digest recipient association in the same transaction. Restored approvals cannot authorize a fresh send. Explicit maintenance prunes digest batch history older than 30 days, cascading its recipient rows. Retain the old live database and sidecars offline. Recheck the actual cutover configuration and local HTTP health before admitting traffic. The full recovery procedure and commands are in [deployment-readiness.md](deployment-readiness.md).

## Versioned high-school expansion review

`deploy/expansion-readiness.json` starts at version 1, **NO_GO**, with unknown evidence. It covers high-school students aged 13–17 and students aged 18 or above. It does not imply a college cohort. `/admin/readiness` displays the bundled record through an authenticated operator route; the view cannot approve or deploy anything.

Run the same check offline, without production configuration or credentials:

```sh
node scripts/with-local-node.mjs --experimental-strip-types scripts/check-expansion-readiness.mjs
node scripts/with-local-node.mjs --experimental-strip-types scripts/check-expansion-readiness.mjs --record /absolute/path/review.json
```

Exit 1 means no go or invalid input. To review an actual proposed expansion, retain the prior record, increment `version`, link it in `previousReview`, name the geography/cohort and identify the reviewed commit/image digest. Record an evidence reference, accountable reviewer reference and review time for every gate, plus an overall recording time, future expiry and explicit decision reference. Use document/review references, not student identities or secrets. Retain the version history in the reviewed change record. The UI reads the copy bundled with that application release; an alternate CLI file is not automatically published to the UI.

The validator checks completeness and time consistency of **declared** evidence; it cannot verify the referenced documents, real pilot results, approvals, or that the running image matches the declared candidate. Unknown/blocked/missing/expired gates force no go. Any scope containing production 13–17 enrollment is always no go in this release, even if someone edits every gate to passed. An adult high-school-only review can pass its declaration checks, but live activation still needs the accountable operator decision and deployment process.

## CI scope

The authored GitHub Actions workflow installs the lockfile with lifecycle scripts disabled, then checks whitespace, types, local tests, a production build and synthetic loopback HTTP acceptance. It uses no repository secrets and has no deployment/scheduled action. Hosted execution is tracked on the draft PR; local evidence predates publication. Dependency installation requires package-registry access; the test/build steps use synthetic local inputs with provider adapters disabled. Browser/accessibility acceptance, a current advisory audit and real proxy/host verification remain release gates.

## Reproducible local quality and performance

With the reviewed local Node runtime and existing dependencies, run `npm run quality:local`. It stops on the first failure: whitespace, types, unit/contracts, production build, synthetic HTTP acceptance and local performance. Each subprocess has a timeout. It installs nothing. Run while no other task is rebuilding the same Next output or using ports 3110/3118. `npm run quality:local -- --browser` additionally runs production browser acceptance on 3111; this requires an already installed Playwright module (or its absolute `PLAYWRIGHT_MODULE` path) and the existing browser selected by `PLAYWRIGHT_CHANNEL`. It does not fetch browsers. Other feature/accessibility browser suites remain separate acceptance checks.

After a build, `npm run test:performance` starts a disposable, empty production-mode app on loopback port 3118 with AI, delivery and real feeds disabled. It measures `/`, `/opportunities`, login, signup, runtime and opportunity APIs, one warmup then five sequential samples each. Initial regression thresholds are warm nearest-rank p95 ≤2 seconds, uncompressed HTML ≤300 KiB and API bodies ≤256 KiB. Requests are capped at 10 seconds and measurement at 120 seconds, with server cleanup afterward. Exceeding a threshold returns failure. The recorded response bytes exclude headers and page assets; the five-sample p95 is the slowest sample, not a reliable population percentile.

The command writes actual samples, timestamp, platform/CPU, Node/build/commit identity, dirty-tree state and pass/fail to `docs/evidence/local-performance.json`. A Mac run is local Mac evidence only. This is a regression signal for the empty catalogue, not browser paint, accessibility, populated database behavior, load, capacity or deployed nginx/TLS evidence. Do not carry its timing claim over to a different build or host, and do not remove the limitations when citing it.


## Feature-branch publication boundary

The repository already has Vercel Git integration. `vercel.json` uses the documented `git.deploymentEnabled` branch map to disable automatic deployments for `feat/local-catalogue-matching`. Other branch behavior is left unspecified and unchanged; no Vercel account, credentials or security settings are modified. Do not merge or enable deployment without the separate release review. See [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).

The draft PR publishes intentional source, documentation and tests. Machine inventory, absolute personal workspace paths, generated screenshots, recordings, runtime databases and secret/config files are excluded from the outgoing history. The original local checkpoints and media remain in the private local delivery. Historical evidence records keep their original timestamps and identify synthetic/local scope; they are not hosted-CI or provider evidence.
