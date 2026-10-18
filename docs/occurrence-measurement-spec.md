# Local occurrence and measurement acceptance

Authorized follow-up on 17 October 2026, starting at `7318b44`. This closes local application gaps previously deferred too broadly. It supersedes the multi-occurrence, recommendation-measurement and synthetic-attribution deferrals in the previous review. It does not authorize real feeds, outreach, external tracking, real student data, production identity, deployment or external AI.

## Shared contracts and division

- Root owns shared occurrence/app DTOs, public detail query handling, integrated acceptance, documentation and delivery.
- Supply owner owns domain occurrence parsing/rules/fixtures and catalogue repository/history/tests.
- Student backend owner owns private occurrence migrations, saves/activity/reminders/feedback, lifecycle/export and handlers.
- Measurement owner owns its new typed contracts, injected SQLite store, consented recommendation/attribution APIs, campaign controls and aggregation tests.
- Student UI and operator UI owners edit disjoint component trees. A separate reviewer verifies the integrated code against these criteria.

## Occurrences

`OpportunityOccurrence` has a stable `id`, `startsAt`, `endsAt`, `timezone`, `validUntil` and `isCancelled`. One opportunity owns 1–12 explicit occurrences. Legacy records have an implicit `primary` occurrence. Explicit arrays retain `primary`; top-level schedule fields remain a primary compatibility projection. Parent cancellation affects the whole series; an individual occurrence cancellation does not cancel siblings. Repetition creates explicit bounded UTC dates with stated fixed-interval semantics; no scheduler or hidden RRULE expansion exists.

Public listing results contain one parent card with a selected current occurrence and its current available dates. `GET /api/opportunities/:id?occurrence=:id` selects an exact date or returns unavailable; it never silently substitutes a different date. Filtering chooses a qualifying date before pagination. Matching evaluates full occurrence intervals, chooses an eligible date and returns at most three distinct parent opportunities. Saved and historical data keep exact occurrence references.

| ID | Acceptance |
|---|---|
| O1 | Operator can inspect, add, edit, repeat and cancel dates with stable identities; version checks and immutable history remain intact. |
| O2 | Material changes return to draft; cancelled/expired primary dates do not hide reviewed active siblings. Parent withdrawal/source pause suppress all applicable dates. |
| O3 | Detail selection, card links and URL state identify the selected occurrence; unknown/mismatched IDs fail without fallback. |
| O4 | Full-interval eligibility and filtering operate per occurrence; three dates from one series cannot monopolize the shortlist. |
| O5 | Save/handoff uniqueness is `(signed owner, parent, occurrence)`. Repeated requests are idempotent, another date is independent. Save/preview availability is checked without implying eligibility or an application. |
| O6 | Activity, factual feedback, reminder identity, dismissal and attendance gates preserve the exact date. One occurrence's attendance never applies to another. |
| O7 | Pending activity follows only reviewed changes to its own occurrence; completed self-reports retain their original outcome facts. Unavailable retained items remain understandable. |
| O8 | Transactional legacy migration preserves saves, history, versions, outcome snapshots and reminder state. Reopening/restarting does not rerun or lose the migration. |

## Local recommendation measurement and channels

Measurement is a separate default-off choice. It stores no IP address, user agent, referrer, free text or copied preferences. Signed local ownership exists solely for privacy controls, unique-recipient arithmetic and deletion. Operator projections never contain owner identifiers, private rows or preferences.

Matches can request a server-signed presentation token identifying its exact ranked choices, profile version and rules version. A client acknowledgement after the result renders records an idempotent exposure, including an empty shortlist. Dashboard GETs, focus/session reads, Matching QA and manual digest previews do not create exposures. Distinct-recipient denominators remain stable across repeated presentations. Structured `RELEVANT`/`NOT_RELEVANT` feedback references the exact displayed occurrence; confirming relevance requires current availability and eligibility. Factual listing reports remain a separate operator workflow.

First-touch attribution accepts only a server-owned enabled synthetic campaign after profile creation and measurement consent. The campaign query may travel through the local onboarding URL without anonymous tracking or persistence. Later visits cannot rewrite first touch. Pausing a campaign blocks new attribution without rewriting historical exposures. No outbound communication occurs.

| ID | Acceptance |
|---|---|
| M1 | Explicit default-off consent independent of storage/reminders; existing profiles remain opted out. Opt-out purges measurement/attribution and immediately stops collection. |
| M2 | Only acknowledged visible results count; empty seekers remain visible in coverage. Duplicated acknowledgements do not add batches. Recipient counts include nonresponders and deduplicate repeated views. |
| M3 | Exposures retain exact opportunity/occurrence/version references and rules/profile versions without copying sensitive preferences. Feedback cannot target an unshown or another owner's choice. |
| M4 | Useful rate = distinct recipients confirming at least one relevant choice / all distinct shortlist recipients. Show nonresponses and zero denominator honestly. |
| M5 | Next-step conversion uses timestamped self-reported APPLIED events within seven days of the relevant exposure/occurrence. OPENED/saves are separate, and current activity state is not substituted for a longitudinal funnel. Partial observation windows are labeled. |
| M6 | Export/delete includes consent, attribution, exposures, relevance and linked outcomes. Another persona's data remains unchanged; state survives restart. |
| C1 | Safe allowlisted synthetic campaign links support community → onboarding → matching. Unknown/disabled codes cannot forge attribution; enabled/paused changes are versioned. |
| C2 | Operator views use a fixed 30-day window and three-person minimum cohort; suppress small and complementary cells. The two-persona live demo can legitimately remain suppressed. |
| C3 | A separately labeled synthetic calculation example demonstrates unsuppressed arithmetic without being included in live totals or claiming real acquisition. |
| C4 | No owner IDs, preferences or event-level data leak through aggregate/campaign endpoints; student and operator roles remain separate. |

## Verification plan and true deferrals

Test independent dates, expired/cancelled siblings, reschedule snapshots, repeated actions, full-interval eligibility, legacy migration/restart, nonresponders, zero matches, seven-day boundaries, campaign first touch/pause, opt-out/delete and aggregate isolation. Exercise complete desktop/phone journeys, failures/retry and URL/back-forward state. Run unit, legacy/full HTTP, browser, accessibility, strict type and production build checks after integration.

Real source adapters, semantic source deduplication and failed external import checkpointing remain deferred with data-feed work. Production identity/safeguarding, external AI, real outreach/delivery, real pilot outcome gates and deployment/backups remain genuine external or production gates. They are not implied by local metrics.
