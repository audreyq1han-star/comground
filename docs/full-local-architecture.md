> Historical demo architecture at d3aeefd. The current durable-account/provider/deployment implementation is documented in [production-foundations.md](production-foundations.md); its activation gates replace the blanket production deferrals below.

# Full local app architecture

The original static project is preserved at the repository root. The local application is a separate Next.js app under `apps/web`. This document describes the integrated local design; the acceptance record in `docs/verification.md` identifies which checks have actually passed.

## Implemented local boundary

```mermaid
flowchart TB
    subgraph MAC[Local development machine · loopback only · synthetic data]
      UI[Next.js / React interface]
      UI --> PUBLIC[Public catalogue and community APIs]
      UI --> STUDENT[Student APIs · signed fixed-demo cookie]
      UI --> OPERATOR[Operator APIs · process-token reviewer cookie]
      STUDENT --> PRIVATE[Private student repository]
      STUDENT --> RULES[Deterministic eligibility and top-three ranking]
      RULES --> PROJECTION[Current published public projections]
      PUBLIC --> PROJECTION
      OPERATOR --> SUPPLY[Catalogue repository · versioned decisions]
      OPERATOR --> AGGREGATE[Self-report aggregate counts only]
      PRIVATE --> AGGREGATE
      STUDENT --> MEASURE[Separate opt-in / signed presentation receipts]
      MEASURE --> PRIVATE
      OPERATOR --> METRICS[Suppressed recipient aggregates / synthetic example]
      PRIVATE --> METRICS
      STUDENT --> FEEDBACK[Owned feedback / factual listing reports]
      FEEDBACK --> PRIVATE
      OPERATOR --> REPORTS[Identity-free factual reports + resolution]
      REPORTS --> PRIVATE
      STUDENT --> DIGEST[Manual digest preview / no delivery]
      SUPPLY --> PROJECTION
      PRIVATE --> DB[(Local SQLite · private tables)]
      SUPPLY --> DB2[(Local SQLite · supply and audit tables)]
      FIXTURES[Explicit synthetic fixture adapter] --> SUPPLY
    end
```

The two database boxes are separate table ownership boundaries in the same configured SQLite file. Student handlers resolve ownership from the signed cookie; callers cannot choose an owner in payloads. Operator catalogue handlers do not return private student profiles. The operator outcomes API returns counts and explicit evidence labels only. Factual listing reports use a separate explicit projection without owner identifiers or preferences; private fit feedback is never exposed. Resolution does not itself edit or verify a listing. New catalogue imports/edits retain immutable before/after facts; legacy unavailable snapshots are not invented. Fixed personas are selectable by anyone with local access, so this is a demonstration of role separation rather than real account security.

Each parent has 1–12 stable explicit occurrence IDs. Legacy records migrate to `primary`. Public lists return one parent card and select a qualifying current date before pagination; matching returns at most three distinct parents. Exact-date URLs never substitute siblings. Published per-date snapshots preserve historical facts. Date edits return the parent to draft, and cancelling one date does not cancel its siblings.

Public availability is recalculated on every read: a listing must be published, complete, permitted in the synthetic source record, current, not cancelled, not withdrawn, and from an unpaused source. Material edits and changed fixture imports return the record to draft. Restoring a withdrawn listing also requires a fresh review. Public projections omit internal permission and review notes.

## Student state and truthful outcomes

```mermaid
flowchart LR
  PERSONA[Choose fictional persona] --> CONSENT[Consent + minimal preferences]
  CONSENT --> MATCH[Hard eligibility then explained ranking]
  CONSENT --> SAVE[Save current listing]
  MATCH --> PREVIEW[Preview example.invalid destination]
  PREVIEW --> OPENED[OPENED · demo handoff only]
  OPENED --> ENDED
  OPENED --> APPLIED[APPLIED · student self-report]
  APPLIED --> ENDED{Occurrence ended?}
  ENDED -->|yes| ATTENDED[ATTENDED / NOT_ATTENDED · self-report]
  ENDED -->|no| BLOCK[Attendance update blocked]
  OPENED --> WITHDRAWN[WITHDRAWN · self-report]
  CONSENT --> DELETE[Withdraw consent / delete private data]
```

Activity history preserves each acknowledged version. Repeated saves and handoffs do not duplicate records for the same owner, parent and occurrence. Another date has independent activity and reminders. Pending activity follows the latest published facts for that exact date; terminal outcomes retain their original snapshot. No UI action submits an application to an organizer. No status proves attendance, verified hours, organizer approval, or school credit. One visibly historical synthetic OPENED example is added only after consent so the ended-occurrence workflow can be tried.

Preferences, saves, activity, alert settings, all reminder state, and feedback persist locally. Owner export/deletion covers these private tables. Logout clears a browser cookie; process restart rotates the student signing key and a new launcher reviewer token invalidates old reviewer cookies. Data remains and can be loaded after choosing the demo persona again. Local in-app reminders are calculated on reads, default off, and can be marked read or dismissed; there is no delivery scheduler.

## Implemented local measurement

```mermaid
flowchart LR
  CAMPAIGN[Allowlisted synthetic entry link] --> PROFILE[Profile + separate measurement consent]
  PROFILE --> TOKEN[Server-ranked shortlist / signed receipt]
  TOKEN --> VISIBLE[Visible result acknowledged once]
  VISIBLE --> EXPOSURE[(Owned exact-date exposure references)]
  EXPOSURE --> RESPONSE[Optional structured relevance]
  EXPOSURE --> ACTION[Timestamped self-reported APPLIED]
  RESPONSE --> AGGREGATE[30-day recipient denominators]
  ACTION --> AGGREGATE
  AGGREGATE --> SUPPRESS[Three-person threshold + complementary suppression]
  SUPPRESS --> ADMIN[Aggregate-only operator view]
  PROFILE --> DELETE[Opt-out or delete purges owned measurement]
```

No anonymous events, IP addresses, user agents, referrers, free text or copied preferences enter measurement. Presentation references include exact occurrence/publication, profile and rules versions. Empty results count as seekers; repeat views do not multiply recipients. Useful rate includes every shortlist recipient, including nonresponders. Next-step conversion is a linked APPLIED self-report within seven days; saves and OPENED do not qualify. Partial observation windows remain labeled and in the denominator.

Dashboard/focus reads, Matching QA and digest previews are excluded. First-touch campaign attribution starts only after consent; pausing blocks new attribution. Ninety-day retention and a 250-batch per-persona limit bound local records. The two available personas remain below the live reporting threshold. A separately computed fictional example illustrates arithmetic without entering live data. Existing operator Outcomes remains a separately labeled synthetic current-state operational view, not a longitudinal measurement funnel.

## Deferred production integrations

```mermaid
flowchart LR
  PERMISSION[Approved source agreement + permitted access] -.-> ADAPTER[Production source adapter]
  ADAPTER -.-> SCHEDULE[Bounded scheduler + cursor + freshness policy]
  SCHEDULE -.-> QUARANTINE[Failed attempts / quarantine / duplicate review]
  QUARANTINE -.-> REVIEW
  SCHEDULE -.-> REVIEW[Existing review and publication boundary]
  IDENTITY[Production identity / roles / safeguarding policy] -.-> PRIVATE[Student ownership boundary]
  ELIGIBLE[Deterministic eligible facts] -.-> EXPLAINER[Optional AI explanation provider]
  CONSENT[Delivery consent + channel preference] -.-> DELIVERY[Approved email/SMS provider]
```

Dashed connections are future work. `packages/domain/providers.ts` records small provider interfaces only; no remote provider is active. A future AI explainer receives already checked facts and has no authority to alter hard eligibility. Production identity, data-retention policy, consent appropriate to the target cohort, safeguarding/incident review, source permission, deployment, backups and permitted distribution must be settled before a real student pilot. Source collection and delivery are deliberately disconnected in this build.

## Evidence map

| Concern | Source |
|---|---|
| Shared public/domain contracts and eligibility | `packages/domain/contracts.ts`, `rules.ts` |
| Student/operator app DTOs | `packages/domain/app-contracts.ts` |
| Synthetic scenarios | `packages/domain/fixtures.ts` |
| Catalogue persistence, audit, availability | `apps/web/lib/repository.ts` |
| Exact-date student migration and snapshots | `apps/web/lib/student-repository.ts`, `student-repository.test.ts` |
| Consented measurement, tokens and aggregation | `apps/web/lib/measurement-repository.ts`, `measurement-presentation.ts`, `measurement-handlers.ts` |
| Measurement DTOs | `packages/domain/measurement-contracts.ts` |
| Occurrence and measurement acceptance | `tests/occurrence-measurement-http.mjs`, `occurrence-measurement-browser.mjs` |
| One-time synthetic runtime initialization | `apps/web/lib/runtime.ts` |
| Reviewer cookie and mutation safeguards | `apps/web/lib/auth.ts`, `http.ts` |
| Student identity, consent, private state | `apps/web/lib/student-auth.ts`, `student-repository.ts`, `student-handlers.ts` |
| Full local HTTP and process-restart acceptance | `tests/full-app-http.mjs` |
| Actual desktop and phone journeys | `tests/browser-e2e.mjs` |

The blueprint's business milestones are not automatically achieved by implementing screens. Real permitted inventory, real student outcomes, organizer confirmation, channel conversion, reliable scheduled collection, and expansion readiness remain unverified.
