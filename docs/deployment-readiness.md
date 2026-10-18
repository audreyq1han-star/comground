# Deployment and recovery readiness

This package prepares a **single-node, single application process** with persistent SQLite. It does not deploy, open a port on a public interface, provision a domain, request a certificate, create an account, send email, invoke AI or connect a data feed. Production starts with an empty catalogue. Synthetic/demo databases cannot be promoted into production.

The code and runbooks are reviewable local deliverables. The Docker image, Compose service and nginx template have not been built or launched as part of this deployment task. Unit tests exercise real SQLite migration, encrypted backup, restore and quarantine in temporary directories with synthetic values; they do not establish live infrastructure readiness or policy approval.

The additional edge admission limits, cooperative process/job locks, uninstalled backup/retention timers, authored CI and versioned high-school expansion review are documented in [deployment-operations.md](deployment-operations.md). Their configuration tests are source checks, not evidence of Docker/nginx/systemd or hosted CI execution.

## Supported operating model

- One Linux host, one application process, one persistent local filesystem volume at `/data`, and a TLS reverse proxy on that host. Do not share SQLite over NFS, run multiple replicas or use ephemeral/serverless database storage.
- Node 22.23.3 or a later reviewed 22.x release; built-in `node:sqlite` remains experimental in Node 22. The Dockerfile pins the reviewed version tag. Resolve an approved immutable image digest and recheck the Node/dependency security floor before live deployment. Existing advisory evidence is in `dependency-runtime-review.md`; its pending October release is not implicitly covered.
- The container runs as UID/GID 1000, with a read-only image, dropped capabilities and no new privileges. Only `127.0.0.1:3100` is published. `/data` and `/backups` are persistent volumes; `/tmp` and Next's cache are disposable memory mounts.
- SQLite and its WAL/shared-memory files must remain on the same persistent filesystem. Never copy just a live `.sqlite` file to make a backup. Store the database on an encrypted host volume; ordinary SQLite rows are not encrypted by this application. Sensitive queued email envelopes are separately encrypted.
- `/tmp` is backup scratch space, not database storage. The supplied 512 MiB memory mount must fit a consistent database snapshot. Size it, the container memory limit, and persistent storage from measured deployment needs. Monitor free space and backup failures.

## Configuration contract

Application validation lives in `apps/web/lib/runtime-config.ts`. The production commands import that implementation, require an explicit production mode and never substitute demo values.

| Setting | Requirement |
| --- | --- |
| `COMGROUND_MODE` | `production` for these scripts. `demo` and `test` are loopback-only modes; test mode forbids external adapters. |
| `COMGROUND_ORIGIN` | Exact approved HTTPS origin, with no path, trailing slash, credentials, query or fragment. It must match the proxy's fixed Host. |
| `COMGROUND_DB_PATH` | Absolute persistent path. Compose fixes this to `/data/comground.sqlite`. Direct script use must supply it explicitly. |
| `COMGROUND_OUTBOX_KEY` | Persistent 32-byte base64 key. Retain it independently of database backups; losing or replacing it makes existing encrypted envelopes unreadable. Never put it in an image or repository. |
| `COMGROUND_ADULT_POLICY_ACK` | `adult-account-v1` only after the owner approves the actual adult-account admission/privacy policy. A string in a test is not that approval. |
| `COMGROUND_EMAIL_ENABLED` | Defaults off. `1` additionally requires `RESEND_API_KEY` and `COMGROUND_EMAIL_FROM`, an approved sender and approval for live delivery. No successful-delivery fallback is fabricated. |
| `COMGROUND_RESEND_WEBHOOK_SECRET` | Optional, separate Resend/Svix `whsec_…` signing secret for the approved receipt endpoint. Blank or invalid values make receipt processing fail closed. This is not the API key, outbox key or backup key. |
| `COMGROUND_AI_ENABLED` | Defaults off. `1` additionally requires `OPENAI_API_KEY`, `COMGROUND_AI_MODEL` and `COMGROUND_AI_POLICY_ACK=grounded-reasons-v1`, with the relevant policy approval and user consent. |
| `COMGROUND_BACKUP_KEY` | A **different** persistent 32-byte base64 key, needed only for backup/restore. The tools reject reuse of the outbox key. Keep both keys under separate approved custody from backup artifacts. |
| `COMGROUND_IMAGE` | Compose interpolation: an approved release image tag/digest. Never use an untracked moving deployment tag. |
| `COMGROUND_ENV_FILE` | Compose interpolation: absolute path to a private runtime environment file **outside this checkout**, for example `/etc/comground/production.env`. |

`deploy/production.env.example` contains intentionally blank required values and disabled adapters. It is not launch-ready and contains no credential. Have the authorized operator populate a private runtime file using the approved secret-management process; do not paste secrets into shell history, source control or task logs. The Docker context excludes environment files, credentials, local databases, portable runtimes and backup archives. No production secrets are passed to the build.

Production rejects `LOCAL_REVIEW_TOKEN` and test-fixture activation. A database is bound to one mode before schemas are created. Existing demo data, populated unbound databases and mode changes stop with an error. A fresh database is the supported production starting point.

## Local checks completed here

The focused test command is safe to run locally. It creates temporary synthetic SQLite files, closes/removes them and makes no HTTP or provider request:

```sh
node scripts/with-local-node.mjs --experimental-strip-types --test tests/deployment-config.test.ts
```

Covered: configuration failure before action; invalid mode/origin/key/policy inputs; private file permissions; real schema initialization and idempotence; no demo/account seeding; interrupted migration gates; receipt tables/columns/unique association/cascades; consistent WAL backup; AES-GCM ciphertext, separate keys and tamper rejection; no-overwrite restore; quarantine; retained receipt history and recipient suppression; revoked restored sessions/tokens; cancellation of unsent mail; container configuration boundaries.

`production-check.mjs --configuration-only` validates configured production settings and private storage permissions without opening a database or contacting a service. Full `production-check.mjs` additionally checks the build, required schema/marker, mode binding, migration/quarantine gates, SQLite quick/FK integrity and absence of synthetic records. `--http` adds **only** a request to `127.0.0.1:PORT/api/health`, carrying the configured Host; it never requests the public origin or a provider. Readiness is not proof of working DNS, TLS, provider credentials or real supply.

## Reviewed activation sequence

These are future operator commands after deployment approval and private configuration. They were not executed for this task. No `npm install`, image pull, certificate request or account provisioning is automated by the readiness scripts.

1. Review the application security/admission/privacy decisions; approve the host, DNS/TLS configuration, secret custody, database volume, recovery objectives and backup policy. Approve any external provider separately. Keep email and AI disabled until their own verification is complete.
2. Run the application's full unit, type, production-build, HTTP, browser and accessibility acceptance checks. Build the image from the same reviewed commit/lockfile. Record the resulting immutable digest. The Docker build uses `npm ci --ignore-scripts` and prunes development dependencies; building it requires package/image network access and is a separate approved action.
3. Place the private runtime environment file outside the repository, mode 0600. Set `COMGROUND_IMAGE` and `COMGROUND_ENV_FILE` in the operator's environment. Compose creates private, persistent volumes from image-owned `/data` and `/backups` directories.
4. Inspect the resolved Compose configuration privately; it contains runtime secret values. Do not copy its output into logs or this task. Run the configuration-only check, then initialize the empty schema explicitly:

```sh
docker compose -f deploy/compose.yaml run --rm app scripts/production-check.mjs --configuration-only
docker compose -f deploy/compose.yaml run --rm app scripts/production-migrate.mjs --confirm-service-stopped
docker compose -f deploy/compose.yaml run --rm app scripts/production-check.mjs
```

The explicit migration initializes catalogue/source control, account/youth review, private-profile/evidence/measurement, notification/digest/community, safety, matching-evaluation audit and AI-usage schemas. It creates no account or opportunity, runs full integrity/FK checks and records `comground_deployment_migrations: production-schema-v1`. This unreleased schema includes additive receipt fields (`provider_email_id`, `receipt_status`, `receipt_occurred_at`, `receipt_received_at`), unique provider-email association, account-owned receipt/suppression tables, owner-scoped `account_auth_limits` and DIGEST outbox support. Re-running initialization preserves existing encrypted jobs and adds missing fields/tables; readiness refuses incomplete tables, required columns, uniqueness rules, deletion cascades or immutable evaluation triggers. Synthetic-only youth/evidence/source/community rows remain prohibited; retained curated matching QA evidence is allowed, with its limitations described in [deployment-operations.md](deployment-operations.md). `deployment_meta.migration_state=running` remains if an initialization step fails. A retry is allowed through this migration tool, while normal startup refuses an incomplete migration. Existing databases require a new encrypted pre-migration backup directory. Never remove a failed migration marker to force startup.

5. Adapt `deploy/nginx.conf.example` to the exact approved host and existing certificate paths. Validate it with the installed proxy's configuration checker before reloading. The template rejects unknown hosts, overwrites forwarding headers, caps request bodies, limits requests and avoids query strings/user-agent/identity fields in its normal access log. Review host logging/retention separately; proxy errors and application errors also require appropriate access controls.
6. Start one application instance, then verify local health and the approved public HTTPS path. The container's startup refuses missing configuration, missing build/schema, maintenance locks, demo rows, incomplete migration or quarantine. Only after that validation may the proxy admit traffic. Operator bootstrap and live account verification are separate explicit account operations, not migration side effects.

```sh
docker compose -f deploy/compose.yaml up -d --no-build app
docker compose -f deploy/compose.yaml exec app node --experimental-strip-types scripts/production-check.mjs --http
```

7. Observe errors, latency, failed sign-ins, storage/WAL growth, database health and queue state. Provider acceptance is not proof of delivery; self-reported application/attendance is not organizer verification. There is no verified real feed or claimed pilot success simply because the service is healthy.

The separately authorized first-operator bootstrap uses an **existing verified adult account** and closes once an operator exists. It creates no account, sends no message and revokes that account's old sessions:

```sh
docker compose -f deploy/compose.yaml run --rm app apps/web/lib/account-bootstrap.ts --account-id account-UUID --confirm PROMOTE_FIRST_OPERATOR
```

Replace `account-UUID` with the reviewed existing account ID. No live-service operator was provisioned; synthetic acceptance operators exist only in disposable test databases.

## Upgrades and rollback

Stop incoming traffic and every worker before a schema upgrade. Stop the application, record the current image digest and take a unique encrypted backup. Do not scale up a second writer during an upgrade.

```sh
docker compose -f deploy/compose.yaml stop app
docker compose -f deploy/compose.yaml run --rm app scripts/production-migrate.mjs --confirm-service-stopped --backup /backups/pre-release-YYYYMMDD-HHMMSS
docker compose -f deploy/compose.yaml run --rm app scripts/production-check.mjs
```

The migration tool holds exclusive `.operation-lock` and `.maintenance-lock` files next to the database and refuses a managed `.service-lock`. A crash may leave locks; confirm no app/job process or container remains, preserve the failed-state evidence, then remove only confirmed stale locks before retrying. Normal failures remove owned locks but retain an incomplete migration marker when appropriate. Constructors perform additive changes and checked data migrations; the wrapper does not promise that all constructors form one global transaction. A preserved pre-migration backup is the recovery boundary. See [the coordination and stale-lock procedure](deployment-operations.md#process-and-job-coordination).

If the database schema remains compatible with the earlier application, switch back to its recorded image and revalidate. Otherwise restore the pre-upgrade backup to a new database, complete quarantine reconciliation and use the matching reviewed image. Do not run an old image against an unreviewed newer schema and do not delete live files to make a rollback appear successful. Escalate any integrity failure; retain the original database and its sidecars.

## Encrypted backup and restore drill

The backup uses SQLite's online backup API, so committed WAL changes are included. It requires a new output directory and never overwrites an existing archive. A private temporary snapshot is encrypted with AES-256-GCM; `/tmp` is memory-backed in the supplied container. The final directory contains only `database.sqlite.enc` and an authenticated `manifest.json` with schema/build metadata, ciphertext checksum and key fingerprints, never key material. A crash during backup can leave an incomplete directory; without a valid final manifest it is not a usable backup. Protect and remove leftover scratch files after investigating a failed operation.

```sh
docker compose -f deploy/compose.yaml run --rm app scripts/production-backup.mjs --output /backups/backup-YYYYMMDD-HHMMSS
docker compose -f deploy/compose.yaml run --rm app scripts/production-restore.mjs --backup /backups/backup-YYYYMMDD-HHMMSS --target /data/recovery-YYYYMMDD.sqlite
```

The backup volume on the same machine does not survive host loss. An approved operator must copy the **encrypted** complete bundle to separately protected storage, retain the required keys independently and test recovery. No remote copy or recurring backup job is activated by this task; the backup timer is an uninstalled template.

Restore checks ciphertext/authentication, matching backup and outbox keys, production binding, required schema and full SQLite/FK integrity. It publishes to a new path with exclusive creation; existing files/sidecars and the configured live path are refused. The restored copy is marked `restore_quarantined=1`. Health, normal database binding and startup all refuse it. The source/live database and backup stay unchanged.

**Deletion and suppression reconciliation is mandatory.** Keep a protected independent ledger outside the database backup, under an approved minimal-data policy, covering deletion requests and provider bounce/complaint suppressions received after each snapshot. Before releasing a restored copy, replay those decisions through the offline reconciliation tool, reconcile retention and record the review reference. Older backups can otherwise reintroduce withdrawn accounts, private data or permission to email a suppressed recipient. This package does not invent an external ledger or claim legal compliance.

Prepare a private, reviewed JSON export of the ledger with these fields: `format: "comground-deletion-register-v1"`, `reviewedThrough` as the timestamp through which requests have been reconciled (at or after the restored snapshot, through the maintenance cutoff), and `accountIds` as the unique account IDs to remove. The optional `notificationSuppressions` array contains `{accountId, reason, occurredAt}` entries; `reason` must be `BOUNCED` or `COMPLAINED`, and `occurredAt` must be a real UTC timestamp at or before `reviewedThrough`. Timestamps use `YYYY-MM-DDTHH:mm:ss.sssZ` (or whole seconds ending in `Z`). Unknown fields, reasons, malformed IDs and invalid/future timestamps fail closed before replay. Empty/omitted entries are valid only after review establishes there are no applicable decisions. Keep this export outside the backup/repository, mode 0600, readable by container UID 1000, and mount it read-only for the command. It is bounded to 1 MiB, 10,000 deletion IDs and 10,000 suppression entries; use a separately reviewed process for a larger recovery.

The reconciliation command applies deletions and suppressions in one transaction. It uses the same profile/private-data deletion hook as account deletion, then reapplies restrictions only to accounts that remain: absent/deleted owners are skipped, never recreated. Complaint status outranks bounce status, repeated replay is idempotent, and every affected unsent job is cancelled with its payload/token/lease/due state cleared. This reviewed ledger replay does not fabricate signed receipt events. It then runs approved account retention, 90-day measurement retention, expired-email cleanup and 30-day terminal-notification cleanup. The copy stays quarantined if any step fails. No provider contact or other network connection is used. Both account periods must be explicitly supplied as 7–365 whole days; the shell variables below represent values approved by the owner, not application defaults.

```sh
docker compose -f deploy/compose.yaml run --rm -e COMGROUND_DB_PATH=/data/recovery-YYYYMMDD.sqlite -v /etc/comground/recovery/deletions.json:/run/deletions.json:ro app scripts/production-reconcile-restore.mjs --confirm-service-stopped --confirm-policy-approved --register /run/deletions.json --reference restore-review-YYYYMMDD --unverified-days "$COMGROUND_APPROVED_UNVERIFIED_DAYS" --security-event-days "$COMGROUND_APPROVED_SECURITY_EVENT_DAYS"
```

After the recorded reconciliation, with traffic/workers still stopped, point `COMGROUND_DB_PATH` at the quarantined copy for the release command. In Compose, an explicit `-e` overrides its normal database path:

```sh
docker compose -f deploy/compose.yaml run --rm -e COMGROUND_DB_PATH=/data/recovery-YYYYMMDD.sqlite app scripts/production-release-restore.mjs --confirm-service-stopped --confirm-deletions-reconciled --confirm-retention-reconciled --reference restore-review-YYYYMMDD
docker compose -f deploy/compose.yaml run --rm -e COMGROUND_DB_PATH=/data/recovery-YYYYMMDD.sqlite app scripts/production-check.mjs
```

The release transaction requires that the offline reconciliation completed with the same reference. It revokes **all** restored sessions and account-action tokens, cancels every unsent restored notification and clears its envelope/token/lease fields. It also disables digest subscriptions, cancels retained digest approvals/batches with a restore audit, and removes every digest recipient association, preventing restored approval from authorizing a new send. It records the reconciliation reference/time, then removes quarantine. A failure rolls back this entire release. A new restore clears earlier reconciliation markers so an old review cannot release a later snapshot. Release does not dispatch mail or enable an adapter. Reauthentication, fresh account-action requests and renewed digest choices/reviews are necessary after recovery. Switch the reviewed service configuration to the recovered file, retain the old database offline and revalidate before resuming traffic. Compose hard-codes its normal DB path, so edit that reviewed setting for a recovery cutover; do not silently rename live files while a process holds them open.

Receipt history and account-level bounce/complaint suppression are restored with the database. Reconciliation and release must retain suppression for accounts that remain; cancelling the old queue must never reset it. Account deletion cascades suppression, while profile withdrawal alone retains it. Review bounce/complaint changes since the snapshot before resuming email; restoring older data must not silently allow a previously suppressed recipient again.

Only compatible, fully prepared database snapshots can be released by this version. A backup of an interrupted or older incompatible migration is retained as evidence/recovery material and requires a reviewed schema recovery before service. Never bypass required-table checks.

## Explicit maintenance and optional worker scheduling

Retention is not silently enabled on startup. After policy approval, one explicit run removes expired account sessions/action tokens/abuse buckets, abandoned unverified accounts and their private data under the chosen period, old security events, expired notification payloads, terminal notification metadata older than 30 days and measurement records older than 90 days. It never dispatches email or invokes AI:

```sh
docker compose -f deploy/compose.yaml run --rm app scripts/production-maintain.mjs --confirm-policy-approved --unverified-days "$COMGROUND_APPROVED_UNVERIFIED_DAYS" --security-event-days "$COMGROUND_APPROVED_SECURITY_EVENT_DAYS"
```

Live delivery is a separate operation. The production worker requires complete production configuration, enabled email, database readiness, `--once` and `--confirm-delivery-approved`. One invocation scans a bounded set of reminder candidates and attempts at most one queued delivery. Retry/lease/idempotency state stays in SQLite; provider acceptance is never labeled confirmed delivery.

```sh
docker compose -f deploy/compose.yaml run --rm app scripts/production-worker.mjs --once --confirm-delivery-approved
```

`deploy/systemd/comground-worker.service.example` and `.timer.example` are **uninstalled templates** for a one-minute schedule. The service requires a separately approved host service identity/Docker access, `/etc/comground/compose.env` containing the image/environment-file locations, and `/etc/comground/enabled/worker`. Do not install or enable the timer before live-delivery approval; stop it before migrations/restores. The one-shot unit and shared database operation lock coordinate shipped workers with backup/retention/migration jobs. Backup and retention have separate inactive templates and enable markers; see [deployment-operations.md](deployment-operations.md). No recurring job, maintenance policy or worker was activated by this task.

## Optional signed receipt activation

Outbound provider acceptance and subsequent delivery receipts are separate states. To activate receipts after owner approval, register the exact approved `COMGROUND_ORIGIN` plus `/api/webhooks/resend` in the provider's configuration, with **only** `email.delivered`, `email.failed`, `email.bounced` and `email.complained`. Put that endpoint's Resend/Svix signing secret in the private runtime environment as `COMGROUND_RESEND_WEBHOOK_SECRET`. Do not reuse an encryption/API key, store it in the image, or log it. No endpoint was registered and no live signing secret was configured during this task.

The endpoint is production-only and fails closed when its signing secret/origin is unconfigured. It requires the exact configured Host, verifies the untouched request bytes and Svix signature/timestamp before parsing, and retains minimal structured receipt fields. Preserve the raw body and `svix-id`, `svix-timestamp`, `svix-signature` headers through the proxy; do not rewrite/decompress callback bodies or log them. Verify the configured provider's signed callback path only as part of the separately approved activation.

Receipt processing intentionally remains available when `COMGROUND_EMAIL_ENABLED=0`: stopping outbound sends must not discard a later bounce or complaint for mail already accepted. Unknown/deleted provider IDs return 503 without retaining an orphan payload, allowing retry if a receipt arrived before acceptance was stored. Investigate repeated unknown callbacks in the provider's authorized dashboard rather than logging recipient/body data or weakening verification. Key rotation and provider replay are explicit operating actions; an unsigned receipt is never accepted as a fallback.

A signed `DELIVERED` receipt describes the provider's delivery result. It is **not** a read receipt, a verified application, attendance or organizer confirmation. Bounce/complaint receipts suppress future mail for that account; profile recreation, recovery requests, maintenance and backup restore do not automatically lift that restriction. Receipt events are bounded to 64 per correlation. Minimal correlations (opaque job/account/provider IDs, transient lease and expiry; no recipient, message or profile content) survive profile withdrawal for up to 30 days from dispatch preparation (original acceptance time for migrated legacy rows), so late bounce/complaint notices can still suppress future mail. Receipt events cascade when their correlation expires or the account is deleted. Restore drops unresolved correlations and invalidates outstanding dispatch leases; accepted correlations remain for their original retention window. Account-level suppression remains for the account lifetime, independently of receipt-history retention.

## Decisions required before live launch

- Audience decision: high-school students under 18, college students 18+, or both. Current adult-only admission is a temporary boundary, not an approved product scope. Any under-18 launch requires an implemented safeguarding/consent/incident/data design; changing a policy flag is insufficient.
- Backup retention and recovery targets. **Thirty days is a proposed upper backup-retention window, not an approved policy or compliance claim.** Approve it or choose another defensible window, schedule encrypted backups accordingly, expire old bundles deliberately and test restoration against the independent deletion register.
- Host/domain/TLS, encrypted storage, immutable image verification, logs/monitoring, secret custody/rotation and restore drill sign-off.
- Actual account/operator bootstrap and optional live email/AI activation. These require the relevant owner/provider policy approval; none happened here. Production readiness checks do not require a real account or contact either provider.
- Real data-feed permission and integration remain separate. Healthy empty production storage does not substitute for a useful, reviewed catalogue.


## Smallest live-setup decision list after the security review

These are four decisions; no provider, account, credential, domain or deployment was activated by this review. Real feeds remain separately deferred.

| Decision | Already assumed by the code | What the project owner must choose or authorize |
| --- | --- | --- |
| Audience and accountability | Temporary self-attested 18+ admission; no verified-age or minor workflows | Under 18, 18+, or both; approve the resulting consent, safeguarding, retention, support/deletion and incident responsibilities before admitting real people. Under-18 support needs implementation first. |
| Transactional email | Resend HTTP adapter and a signed Resend/Svix receipt endpoint | Approve Resend or request an adapter change; choose a sending domain/address with DNS control; securely supply `RESEND_API_KEY` and `COMGROUND_EMAIL_FROM`; register the approved HTTPS `/api/webhooks/resend` callback for delivered/failed/bounced/complained events and its separate `COMGROUND_RESEND_WEBHOOK_SECRET`; authorize a test recipient and limited send. |
| Optional AI | OpenAI Responses API with strict structured reason selection; no default model | Choose an approved OpenAI project/model that supports the required structured output, processing terms and spend cap; explicitly authorize `OPENAI_API_KEY` use and `COMGROUND_AI_POLICY_ACK=grounded-reasons-v1`. AI can stay off while the rest launches. A detected existing key is not authorization to use it. |
| Hosting and recovery | One Linux host and one application process, local persistent SQLite, Docker Compose and nginx/TLS example | Choose hosting provider and HTTPS domain (`COMGROUND_ORIGIN`), private runtime secret storage, encrypted persistent volume, distinct outbox/backup keys, approved image and backup/deletion-register custody/retention. Approve deployment and worker/maintenance schedules separately. Compose fixes DB storage at `/data/comground.sqlite`; serverless, NFS and multiple application replicas are unsupported. |

Local checks establish configuration gates, database mode isolation, account ownership and revocation, bounded injected provider contracts, authentic-signature handling and encrypted SQLite backup/restore behavior. Live integration is required to verify actual DNS/TLS, sender authorization and deliverability, provider callback routing/retries, OpenAI project/model availability and spend, deployed proxy/storage behavior, and an operational restore drill. Real student usefulness and organizer/safeguarding outcomes require a separately approved pilot.

## Remaining security limits after local hardening

This is a targeted local review, not a production security certification. Per-account throttling can still let someone who knows an address temporarily deny that account's password login; recovery has its own independent purpose limit. Two concurrent password jobs bound memory/CPU work but do not prevent sustained traffic from occupying capacity. New-address registration has a bounded 4,096-bucket table and fails closed while full; edge admission/rate controls and monitoring are still needed before exposure. No MFA is implemented, including for operators.

The supported one-application-process model matters: a second application writer changing consent while another waits for a SQLite write lock is not covered by the current AI dispatch consent boundary. The separate mail worker cannot change AI consent/session state; arbitrary concurrent application writers or multiple replicas require a new transaction/dispatch design and review. External provider actions already in flight cannot be recalled. Deletion and suppression after a backup require the independent reconciliation register; keeping or replaying that register remains an operational responsibility. Temporary 18+ self-attestation does not protect or verify minors.
