# Full local app scope and acceptance

Authorized 17 October 2026: build the complete local product before connecting real data feeds. Continue branch `feat/local-catalogue-matching` from `ac5f7ee78bfea72f1b13ee0999cb8510a9c19df2`. Local commits are authorized. Preserve original main and marketing files. At that local implementation stage, push was deferred. Feature-branch publication and a draft PR were subsequently authorized; merge, deployment, real collection, outreach, email/SMS, paid services, agreements, new external accounts/credentials and persistent provider access remain outside scope.

## Product boundary and reconciled blueprint

This local acceptance scope covers the principal M1–M6 student/operator workflows and SB01 in-app reminder/SB02 demo community-page portions with labeled synthetic data. It does not cover every original blueprint feature: the authoritative fresh-review gap matrix is `docs/independent-review.md`. Production milestone gates (real supply, real pilot outcomes, approved acquisition, two-week automation reliability, organizer confirmation and expansion readiness) are not achieved by a local app. SB03 real expansion decisions remain deferred; the operator overview reports integration gates instead of fake readiness scores.

Use the existing Next/React/TypeScript/SQLite stack and brand. No external calls or new runtime dependencies are required. The active AGENTS.md under apps/web requires reading the installed Next docs before app changes. Keep student data private to a signed demo persona, and operator access behind the process-only reviewer token. Two fixed personas (`demo-alex`, `demo-sam`) are selectable local demos, not real accounts or production authentication. Anyone with local access can choose either; prominently say to use synthetic details only. Never collect names, email, exact birth dates, addresses or free-form sensitive profiles.

All visible organization verification is `Synthetic — not verified`. No source import grants real rights. School-credit approval is false/unknown in shipped sample listings; there is no UI control to assert real verification or approval. Existing eligibility logic still supports evidence-backed future values and tests, but no generated marketing claim implies approval. Signup URLs stay example.invalid. The handoff creates a demo destination-preview event only, never an application.

## Working sections

1. Student session/onboarding/profile: choose a fixed demo persona, consent to storage, save minimal persistent preferences and a goal, edit with version checking, switch/end session, export own data, withdraw consent/delete own profile and dependent private records.
2. Student dashboard: useful next steps, explained top-three matches, saves, self-reported activity and in-app reminders. No fabricated performance percentages.
3. Discovery/detail: server-side search, category, coarse area, mode, date and fee filtering; URL-backed filters/pagination for back/forward; full requirements, evidence/freshness, save and demo-signup preview; missing/expired state.
4. Matching: persisted preferences, existing hard eligibility before ranking, grounded explanations, unknown/no-match states and clear edit-preferences path. External AI is a deferred provider interface, not simulated model output.
5. Saves/activity: idempotent save/remove and handoff. Activity statuses OPENED (demo handoff), APPLIED, ATTENDED, NOT_ATTENDED, WITHDRAWN. Every status after OPENED is explicitly SELF_REPORTED. Versioned updates with append-only own event history. Attendance requires an ended occurrence. No organizer-confirmed badge or school-hour certification. A clearly labeled synthetic historical OPENED example may be created on first explicit onboarding consent to make the attendance workflow testable; it is not a claimed application.
6. Notifications: default-off persistent in-app preferences; upcoming saved/current events, unavailable saved listings and post-event follow-up; read/dismiss idempotently. Opt-out immediately suppresses reminders. Compute locally from current data on reads; no external delivery or claimed scheduler.
7. Operator: overview, catalogue/review, versioned edit (material changes return to draft), publish/reject, withdraw/restore, read-time expiry/cancellation, field/audit history, source pause/resume and health, immutable import history and safe fixture replay, organization directory with no real verification claim, deterministic matching QA, aggregate self-reported outcomes, exceptions acknowledgement/resolution, and demo community-page publication controls.
8. Feedback/digest: manual current-match shortlist preview; private fit feedback, factual listing reports without identity/preferences, versioned reasoned operator resolution and owner history/export/deletion.
9. Community `/communities/demo-neighborhood`: fictional local front door backed by current published supply. Operator can pause it. No real partner branding, invitations or acquisition metrics. Acquisition screen reports local aggregate activity and which external distribution decisions remain deferred.

## Shared contracts and API

Parent owns `packages/domain/app-contracts.ts`; existing contracts.ts stays compatible unless coordinated. All successful single resources use `{data: ...}` except session `{authenticated, persona, profile}` and existing import response. Errors stay `{error:{code,message}}`. Mutations retain exact Origin, loopback Host and bounded JSON enforcement. Never accept caller-supplied ownerId. All role/private responses use no-store.

Student API (student backend owns all `/api/student/**`):

- GET `/api/student/personas` → `{data:DemoPersona[]}`; GET/POST/DELETE `/api/student/session`, POST `{personaId}` sets a signed HttpOnly SameSiteStrict student cookie. The signing key is process-only; restart changes the key, while profiles persist and can be reselected.
- GET/PUT/DELETE `/api/student/profile`: nullable profile; PUT ProfileInput with expectedVersion 0 for create; DELETE `{confirmation:'DELETE'}` cascades private data. GET `/api/student/export` → `{data:StudentExport}`.
- GET `/api/student/dashboard` → `{data:StudentDashboard}`; POST `/api/student/matches` `{}` → `{data:MatchResult[],eligibleCount,engine,profileVersion,preferences}`. Both require consented profile.
- GET/POST `/api/student/saves`, POST `{opportunityId}`; DELETE `/api/student/saves/:id` idempotent, where id is opportunityId. GET returns `{data:StudentSaved[]}`.
- GET `/api/student/activity` → `{data:ActivityItem[]}`; POST `/api/student/handoffs` `{opportunityId}` → `{data:ActivityItem}` idempotent per owner/occurrence; PATCH `/api/student/activity/:id` ActivityInput.
- GET/PUT `/api/student/alerts` → `{data:AlertPreferences}`; GET `/api/student/reminders` → `{data:InAppReminder[]}`; POST `/api/student/reminders/:id` `{action:'READ'|'DISMISS'}` idempotent.
- GET/POST `/api/student/feedback`, POST `{opportunityId,kind}` (`NOT_RELEVANT`, `WRONG_DETAILS`, `UNAVAILABLE`); idempotent per persona/listing/kind. GET `/api/admin/reports` returns only factual reports without owner identifiers. PATCH `/api/admin/reports/:id` `{expectedVersion,reason}` resolves once, with stale/state conflict protection.
- GET `/api/admin/outcomes` → `{data:OutcomeSummary}` requires operator, returns aggregates only; student backend owns this one admin route.

Catalogue/operator API (catalogue backend owns existing and remaining public/admin APIs):

- Existing session/fixtures/import/review APIs remain compatible. Public GET opportunities accepts PublicQuery, validates values, filters before pagination. Existing anonymous POST matches can remain as a temporary-preview compatibility path; integrated UI uses stored preferences.
- GET `/api/admin/overview` → `{data:OperatorOverview}`; GET `/api/admin/opportunities` → `{data:AdminCatalogueRecord[]}`; GET/PATCH `/api/admin/opportunities/:id` (EditOpportunityInput); POST `/api/admin/opportunities/:id/actions` CatalogueActionInput.
- GET `/api/admin/sources` → `{data:SourceHealth[]}`; PATCH `/api/admin/sources/:id` SourceUpdate. Pause suppresses imports/publication/public matching for that source immediately. Resume never bypasses completeness/expiry checks.
- GET `/api/admin/import-runs` → `{data:ImportRun[]}`; fixture reimports use existing POST imports and retain immutable run rows.
- GET `/api/admin/organizations` → `{data:OrganizationSummary[]}`; GET `/api/admin/matching-qa` → `{data:MatchingQaCase[]}`.
- GET `/api/admin/exceptions` → `{data:OperatorException[]}`; POST `/api/admin/exceptions/:id` ExceptionInput. A live underlying failure cannot be marked resolved.
- GET `/api/admin/communities` → `{data:CommunityPage[]}`; PATCH `/api/admin/communities/:slug` CommunityUpdate; public GET `/api/communities/:slug` returns published page or 404.

Supply backend exposes `repository()` and methods getPublic/listPublic/getAdmin/listReview for student backend. Student backend stores private tables in the same configured SQLite file using its own connection; do not share raw private rows with supply APIs. Coordinate internal history snapshot lookup: use the synthetic fixture externalId `synthetic-past-reading-001`, exposing only former public snapshot fields. No hardcoded new production credentials.

## Data/seed/migration rules

Preserve existing database contents using additive migrations. Do not drop tables or reset real files. Runtime may seed a newly empty database once with diverse visibly synthetic reviewed listings, one historical formerly published example, and blocked drafts. Seed audit reasons explicitly say synthetic demo setup, not real organizer verification. Direct repository tests remain unseeded. `COMGROUND_SKIP_DEMO_SEED=1` disables runtime seeding for original isolation tests. Do not overwrite operator edits on startup/restart. Keep existing fixture IDs; add examples, including `past-reading` / externalId above. Source pause belongs in persistent source-control state and must apply across all its opportunities, not only the last imported row.

Private state survives restart; the browser must reselect its persona after key rotation. Deletion removes preferences, saves, activity/handoff history, reminder state, feedback/reports and alert settings for that persona only. Export includes all stored reminder states, including dismissed or currently suppressed ones. No real outbound services. Provider integration seams are small documented interfaces (identity, matching explanation, source adapter, notification delivery); do not build speculative frameworks.

## Acceptance checklist (all required locally)

- [x] A01 No regression of original assets, main, safe URL/date parsing or hard eligibility.
- [x] A02 Both demo personas can consent/onboard/edit/reload; separate browser contexts cannot read/write each other's private data or override ownerId.
- [x] A03 Operator/session and student/session boundaries enforced server-side; expired/rotated sessions clear private UI state.
- [x] A04 Profile export/delete/withdrawal is complete and isolated; reselection after deletion returns onboarding.
- [x] A05 Search/filter/pagination state survives back/forward; filter validation, empty/loading/error/retry paths work.
- [x] A06 Stored matches honor full age band, occurrence availability, mode/area, fees, training/guardian/credit; no-match is valid and explanations grounded.
- [x] A07 Save/remove/handoff repeated actions are idempotent; unavailable saved items remain understandable; handoff never means applied.
- [x] A08 Activity transitions/history are versioned and labeled self-report; future attendance blocked, historical attendance works; stale updates conflict safely.
- [x] A09 Alert defaults/opt-in/read/dismiss/opt-out persist; expired/paused sources do not generate actionable upcoming reminders.
- [x] A10 Operator edit/review/publish/reject/withdraw/restore preserves audit and prevents stale or unreviewed publication.
- [x] A11 Source pause/resume, health, import history/replay, exceptions and community pause work; no fake organization/credit verification.
- [x] A12 Runtime fixtures seed once, existing data migrates without loss, and student/supply/audit state survives graceful and abrupt restart.
- [x] A13 Desktop 1440 and phone 390/320 layouts fit; keyboard/focus/labels/status announcements, contrast, reduced motion and no runtime errors verified.
- [x] A14 Interruptions/retries/double actions/back-forward and missing/not-found pages verified in Mac browser.
- [x] A15 Unit/API/browser suites, strict typecheck and production build pass after final changes; screenshots and supported video show actual app.
- [ ] A16 Final delivery: run guide and implemented/deferred list are in LOCAL_README.md; local checkpoint and Library receipts are recorded in the external handoff manifest after verification. This checkbox is a delivery-stage marker, not a missing app flow.

## Independent review addendum

The 17 October follow-up fixed stale cross-tab matching, unsaved reminder drafts, unknown save state, upcoming activity reminders, exact source history, freshness/evidence editing, operator recovery and exception history. It added manual digest preview and private/factual feedback. The subsequent local amendment below closes explicit multi-occurrence, attribution and measurement work with its own acceptance criteria. `docs/independent-review.md` retains semantic deduplication, failed external-import checkpoints and production operator assignment as separate future work.

## Local follow-up amendment

`docs/occurrence-measurement-spec.md` supersedes earlier deferrals for multiple dated occurrences, local recommendation measurement and synthetic channel attribution. It defines O1–O8, M1–M6 and C1–C4, with exact-date history, migration, independent consent, visible exposures, suppressed aggregates and first-touch campaign controls. The updated gap matrix is in `docs/independent-review.md`; real feed adapters, semantic duplicate review and failed external-import checkpoints remain feed milestones. Production identity, safeguarding, external AI/delivery and real pilot evidence remain separate gates.
