# Synthetic evidence and outcome measurement

This local workflow serves high-school students, including students aged 18 or over. Every evidence record carries `SYNTHETIC_NOT_VERIFIED`. External verification is `DISABLED`. No record establishes real attendance, a verified introduction, certified hours, organizer safety, school credit, a guardian's identity, or legally sufficient consent. Production synthetic writes and real minor enrollment remain disabled.

## Private failed-fit records

`/evidence` lets an admitted student with profile storage consent record why one exact opportunity occurrence did not fit. The bounded taxonomy is `WRONG_AGE`, `CLOSED`, `TIMING`, `TRAVEL`, `NO_RESPONSE`, or `OTHER`. There is no personal-details or free-text field. Updates use `expectedVersion`, retain the reason history, and are visible only to the owner. Failed fit is a self-report, never operator-confirmed evidence. Operators cannot browse these reports through the evidence queue.

## Consented claim exchange

1. The student selects an exact occurrence and one evidence kind: `INTRODUCTION`, `DOCUMENTED_APPLICATION`, or `ORGANIZER_ATTENDANCE`. Attendance requests require the stored occurrence to have ended.
2. An unchecked sharing checkbox explains the minimal fields that will be shared. Creating the request returns an opaque one-time reference. It expires after 24 hours, is shown only in the creation response, and is stored only as a hash. It is absent from exports and later reads.
3. The student may choose to share that reference with a local operator. This application sends no message or email and exposes no global student directory.
4. A verified adult operator exchanges the reference. The exchange consumes it and assigns that operator. The operator sees occurrence facts, claim kind, status and version, with no student account ID, email, preferences or failed-fit history.
5. The assigned operator may record a bounded `synthetic:` evidence reference and expiry, or later revoke the record. Recording checks the exact occurrence dates again. A rescheduled date requires a new student request. Attendance can be recorded only after the occurrence ends.

Student APIs never accept a claimed owner, operator identity or confirmation. An operator cannot record against an unassigned claim or their own student claim. Withdrawal invalidates the reference and any recorded contribution. The current owner admission and storage consent are checked again for operator exchange and decisions. Claims are versioned; stale decisions return a conflict and the screens offer reload/retry. Expiry is evaluated at read and decision time, without depending on a worker.

Limits are 100 claims per owner, 100 failed-fit records per owner, 100 versions per record, and 1,000 scope records. Evidence expiry must be later than recording and at most 366 days away. Histories preserve role, action, time and version; the server additionally stores the actor ID for operator decisions. Public owner/claim projections do not expose cross-person identity.

## Scoped school-program and organizer records

`/admin/evidence` also supports `SCHOOL_PROGRAM_APPROVAL` and `ORGANIZER_REVIEW` examples. A record names an existing organization, optionally one of its opportunities, and a school-program reference for school records. The reference must match `synthetic:` plus bounded letters, numbers and punctuation. This is a local program key, not a school identity lookup.

Scope records carry validity dates, evidence reference, recording actor, version, and revocation history. An active duplicate for the same kind/organization/opportunity/program is rejected; the operator must revoke the old record before replacing it. Matching checks the selected program and organization, plus the opportunity when the record is opportunity-scoped. A program record does not enable a global approval flag. Organizer review never asserts school-program approval. Existing public credit claims remain false.

## Aggregate synthetic evidence metrics

`GET /api/admin/evidence/summary` returns a read-only, `no-store` operator summary. It rejects query filters, preventing owner-selected or arbitrarily narrowed slices. `EvidenceMetricsPanel` displays it independently of self-reported activity in the operator outcomes screen. It does not expose owner keys, claims, references, organizations, emails or private profiles.

The separately delivered original `metrics.csv` distinguishes independently evidenced introduction/application, organizer-confirmed attendance, and repeat participation from self-report. This implementation adapts those definitions for local synthetic validation; it does not meet their real-evidence requirements or expansion gates. In particular, the original introduction/application measure is a 4–6 week pilot count; this UI uses a fixed rolling 28-day window for comparability.

| Measure | Definition |
| --- | --- |
| Eligible profiles | Current verified, admitted adult student accounts with explicit `HIGH_SCHOOL` stage, current private storage consent, and enabled measurement consent. Local demo profiles are permitted only in demo mode. All teen accounts are excluded, even after approval. |
| Introductions / applications | Distinct eligible profiles with current unrevoked evidence of that kind recorded within the last 28 days. The combined measure counts a profile once. |
| Attendance | Distinct eligible profiles with current organizer-attendance evidence for an exact occurrence ending in the last 28 days. |
| Attendance denominator | Distinct eligible profiles with current introduction/application evidence for an occurrence ending in the last 28 days. The paired numerator requires attendance for the same opportunity, occurrence ID and stored start/end dates. |
| Repeat denominator | Profiles with a complete 28-day observation window after their earliest distinct opportunity in the last 90 days of currently valid attendance evidence. |
| Repeat numerator | Profiles in that completed cohort with attendance at a second distinct opportunity within those 28 days. Another session of the same opportunity does not count. Partial observation windows remain separate. |

Only `RECORDED` claims with the synthetic label and currently valid evidence contribute. Claims must have been created and recorded after the current measurement opt-in. Attendance dates must also be after that opt-in. Opting out immediately removes contributions; opting in again does not restore earlier claims. Expiry, revocation, invalid admission, profile withdrawal and deletion are reflected on the next read. Historical occurrence facts remain usable after catalogue removal because the metric reads the recorded snapshot, not today's listing. The 90-day repeat view is bounded, not a lifetime history; expiry or withdrawal can change which current evidence is earliest.

The minimum cohort is three. The response suppresses all related totals, rates and cohort partitions together when the cohort, a non-empty outcome group, or its complement contains one or two profiles. Checks also cover introduction/application overlap, union remainders, attendance numerator/denominator remainders, and mature-repeat remainders. Suppressed values are `null`, never substituted with zero. The two built-in demo personas therefore produce a suppressed demo summary. These local suppression rules are not a claim of production anonymity or independent verification.

## Integration and ownership boundaries

| Boundary | Hook or route |
| --- | --- |
| Schema initialization | `initializeEvidenceSchema(db)` in `apps/web/lib/evidence-repository.ts` |
| Private export | `exportOwnerEvidence(db, owner, now)`; returns failed fits and claims without sharing secrets |
| Private purge | `purgeOwnerEvidence(db, owner)`; caller owns transaction; profile foreign keys also cascade |
| School program matching | `hasActiveSchoolProgramApproval(db, {programId, organizationId, opportunityId}, now)` |
| Pure metrics | `calculateEvidenceMetrics(rows, now)` in `packages/domain/evidence-metrics.ts`; owner-key input is server-internal only |
| Repository summary | `readEvidenceMetrics(db, now, {allowDemo})` in `apps/web/lib/evidence-metrics-repository.ts` |
| Student routes | `GET /api/student/evidence`; failed-fit `POST` and versioned `PATCH`; claims `POST` and versioned withdrawal `PATCH` |
| Operator routes | `GET /api/admin/evidence`; claim exchange `POST`; versioned claim decision `PATCH`; scope creation `POST` and revocation `PATCH` |
| Metrics route and component | `GET /api/admin/evidence/summary`; `apps/web/components/admin/EvidenceMetricsPanel.tsx` |

Tables are `student_failed_fits`, `student_evidence_claims`, and `scope_evidence_records`. Private rows reference `student_profiles` with deletion cascades. Claim assignment and the private audit are deleted with the private claim. Scope records contain operator records rather than student records and retain their revocation history. Measurement uses the existing `measurement_consent` table; it adds no aggregate cache or schema.

## Validation

Repository and HTTP tests cover private ownership, bounded fields, version conflicts, one-use references, expiry, assigned operator authority, exact ended dates, rescheduling, withdrawal, export redaction, cascading deletion, program scope and production-disabled writes. Mutation boundary tests hold request bodies open, revoke the session, then release the body; the final authentication check rejects the write.

Metric tests cover current consent and re-opt-in, storage withdrawal, deleted profiles, approved/revoked youth exclusion, expired/revoked evidence, historical snapshots, exact-date pairing, repeat maturity, cohort partitions and complementary suppression. The metrics HTTP test checks operator authorization, query rejection, session revocation, aggregate-only output and no-store caching.

Run the focused suites with:

```sh
node scripts/with-local-node.mjs --experimental-strip-types --test packages/domain/evidence-metrics.test.ts apps/web/lib/evidence-*.test.ts
npm run typecheck
```

`tests/high-school-browser.mjs` exercises synthetic signup, offline review assignment, onboarding, privacy, claim exchange, scoped evidence, revocation, export and storage withdrawal. It checks 320px/390px layouts, console/CSP/external requests, and captures real rendered states. It runs against the shared production build with the existing Playwright module; its output files and final test result are generated by the integration run, not assumed by this document.
