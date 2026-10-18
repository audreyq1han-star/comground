# Private safety reports and synthetic source operations

These local features provide app behavior and test contracts. They do not establish a monitored safeguarding service, real source permissions, operational response times, or a live connector.

## Safety integration

- `/safety` and `/api/student/safety/reports` require a verified STUDENT account. Pending synthetic youth review does not prevent recording a platform concern. A personalization profile is not required.
- Submission explicitly consents to storing the report and its history. Reports belong to the account, with an account deletion cascade; profile withdrawal calls `purgeOwnerSafetyData`. Account export uses `exportOwnerSafetyData`, including the reporting-limit counter.
- Reports are scoped to platform safety or an exact existing published listing occurrence. Category, urgency and moderation reason are bounded enums. Optional narrative is plain text, at most 500 characters, rendered without HTML or link interpretation.
- Urgency prioritizes the operator queue; it does not send an emergency alert. The immediate-danger choice tells the reporter to contact local emergency services or a trusted adult rather than await an app response.
- The verified OPERATOR queue includes report content and exact listing facts, without student identity, email, age, profile or preferences. The first review assigns the acting operator. Assignment changes accept only current verified OPERATOR account IDs. An audit event records the opaque actor ID and assignment at every version. Reporter status and export omit those operator identifiers.
- OPEN, IN_REVIEW, RESOLVED and DISMISSED transitions require matching structured rationales and a current version. Withdrawal requests require a reviewed listing report and do not change catalogue visibility. Existing catalogue review controls remain authoritative.
- Limits are six submissions per account per 24-hour window, 100 retained reports per account, 3,000 total reports, and 50 versions per report. Individual deletion retains the window counter to prevent delete/recreate bypass.

`initializeSafetySchema` runs after accounts. It owns `safety_reports`, `safety_report_events`, and `safety_report_limits`. Assignment and actor references are deliberately opaque text, so deletion of an operator does not remove another account's report history. Reporter identifiers are never projected into the moderation DTO.

## Source integration

`/admin/source-control` and `/api/admin/source-control` require a current verified OPERATOR account. Mutations require test mode plus `COMGROUND_TEST_FIXTURES=1`; production allows an empty read but cannot create synthetic workflow rows. Runtime handlers authorize after the bounded request body is consumed.

`initializeSourceControlSchema` runs after sources. It owns ten tables: permissions, permission events, ingestion runs, ingestion attempts, staged records, record links, merges, merge events, duplicate decisions and review time. All rows in these tables are synthetic for this release. Production readiness rejects populated synthetic source tables.

A source permission is versioned, owned, bounded by origin, path prefix, reusable fields and evidence scope, and has state and expiry. `sourcePermissionIssue(db, sourceId, now, {required, record})` applies the current contract to the exact current record. Production requires a registered permission. The legacy demo/test fixture exception applies only when no permission is registered; registered state and scope always apply. The catalogue calls this hook during import, publication review and public reads, so narrowing a contract removes incompatible existing publications immediately.

Staging uses a one-minute lease, a persisted cursor, atomic record/checkpoint commits, a maximum of 25 records/128 KiB per batch and three attempts with bounded backoff. A recovered worker cannot use the expired lease. Finished runs may be explicitly replayed from the saved cursor. There are at most 24 runs per source in a rolling 24 hours, 1,000 total runs and 2,000 staged records. A staged import rechecks current permission and exact snapshot equality before recording its catalogue link.

Exact aliases retain both source records and require identical material facts. A reviewed merge retains both catalogue records, requires identical occurrence dates, records actor/reason history and can be reversed. `sourceDuplicateIssue` suppresses an active alias on public reads; reversal still leaves the ordinary publication gates in effect.

The fetch contract has **no default network transport**. Tests inject DNS, robots and bytes. It requires an approved HTTPS origin/path, public IPv4 answers, a pinned destination address, manual bounded redirects, content type, byte and time limits, and per-host rate limits. Refusal, truncation, malformed schema and unsupported evidence become structured quarantine reasons, never executable instructions or model/tool input.

## Measurement definitions and remaining observation gate

The source console retains per-source local workload and adds the original operational measures. Every value is marked synthetic:

| Measure | Population and calculation |
| --- | --- |
| Scheduled source success | Rolling 14-day known authorized cadence obligations reconstructed from versioned permission history. Numerator: scheduled runs or their replay lineage completed by the next cadence boundary. Denominator: every known due interval, including missed, late, failed and still-pending obligations. Manual queue runs do not earn scheduled success; `due:` and `replay:` idempotency-key prefixes are reserved for their internal workflows. |
| Historical coverage | Source counts with unknown or partial history, unobserved source-hours and known authorized source-hours. Intervals before registration or across missing permission versions are unknown and never fabricated. Pause/expiry stop future authorized obligations; same-cadence active revisions retain their original cadence anchor. |
| Material-change review | Rolling 7-day decision cohort: hours from earliest matching staged change detection (or direct material revision) to the first subsequent publish/reject/withdraw decision. Initial imports and fetch bookkeeping-only changes are excluded. Repeated staged snapshots of identical material content share the earliest detection clock, and a bookkeeping-only catalogue revision cannot reset that clock. |
| Alias provenance coverage | Retained snapshots attached to another canonical source identity are explicitly excluded from material-change durations and counted as unknown samples. Mutable current link snapshots cannot prove their historical baseline or review decision. No completed review is inferred from an exact-link update; actual catalogue revisions retain their own auditable clocks. |
| Outstanding material changes | All current changed staged snapshots awaiting import and material revisions awaiting decision, including those detected before the 7-day window. Age distribution and older-outstanding count are separate from completed review durations. Legacy changed imports without revision evidence are counted as unknown. |
| Weekly review workload | Trailing 7 days of source-review entries, summed in hours with entry and distinct reviewer counts. This excludes initial sourcing/recruitment and explicitly does not measure all other review work. |
| Queued | Runs in QUEUED, RUNNING or RETRY_WAIT for that source. |
| Dead letters | Retained DEAD_LETTER runs for that source. |
| Oldest queued age | Age of the earliest created run in the queued population; null when none. |
| Success lag | Minutes since the latest successful completion; before any success, minutes since the current permission version. |
| Missing heartbeat | More than two configured cadences since the latest run heartbeat, or current permission version when no heartbeat exists. This is a per-source flag, not a count of missed executions. |
| Review queue age | Age of currently STAGED records; samples is the number of records. Imported and quarantined rows are excluded. |
| Review time | Explicit operator-entered review minutes; samples is the number of entries, not listings or operators. |
| Median / p90 | Sorted sample values; even medians average the middle two; p90 uses nearest rank `ceil(0.9*n)`. Empty populations produce null. |
| Daily quota remaining | 24 minus runs created in the trailing 24 hours, clamped at zero. |

The scheduler queues an initial registered source immediately, then at most one catch-up run when the enqueue cadence is due and no queued/running/retry work exists; it retains the latest cursor. Missed intervals are coalesced rather than fabricated as separate historical executions. The local due flag uses the same last-enqueue/active-run logic as the scheduler. Reconstructed historical due obligations remain independent of whether the scheduler actually ran. No live sustained success rate, independent heartbeat coverage, alert delivery, review SLA, or cost/throughput claim is made. A production adapter, independent heartbeat and an observed operating window remain required before these calculations can support a release claim. The real 20–40 listing / 15–25 student scope and complete human time logging are required to assess the 3–5 hour workload hypothesis. Deterministic tests prove calculation behavior only.

## Validation

Focused tests cover ownership, privacy cascades, urgency/assignment audit, stale versions, fresh authorization after body reads, source scope narrowing through catalogue public reads/import/re-review, malformed extraction, injected transport limits, leased retry/recovery, atomic checkpoint rollback, quota, even medians, source provenance and reversible duplicate review.

`tests/safety-browser.mjs` uses isolated port 3114. `tests/source-control-browser.mjs` uses isolated port 3119 and covers permission creation, due fixture runs, staged import, permission narrowing of an existing public listing, operator authorization, and 390/320px viewport checks. Both are authored for execution after the shared build; evidence JSON and screenshots are created only by successful runs. Duplicate merge behavior is covered by repository tests rather than fabricated through a live connector.
