# Full local app verification

Verified on 17 October 2026 against the local production build in the feature worktree. The original `main` remains clean at `5109d51b7f26e71a3b75cb4bde100f91154a00a3`. `git log -1 --oneline` identifies the final local checkpoint. This record supersedes the earlier slice verification.

## Results

| Layer | Result | Evidence |
|---|---|---|
| Domain, persistence and API units | 176 passed, including 68 named eligibility cases | `npm test`; `docs/evidence/final-checks.json` |
| Strict TypeScript | Passed | `npm run typecheck` |
| Production build | Passed | `npm run build` |
| Original API regression | 16 checks passed | `docs/evidence/api-e2e.json` |
| Full production HTTP | 32 acceptance groups passed | `docs/evidence/full-app-http.json` |
| Installed Mac Chrome | 38 journey groups passed | `docs/evidence/browser-e2e.json` |
| Independent fresh Chrome review | 11 additional groups: cross-tab snapshots, dirty drafts, delayed saves, digest, feedback, activity reminders, operator failed refresh/history, second-persona mobile flow | `docs/evidence/independent-browser.json` |
| Occurrence and measurement HTTP | 23 acceptance groups passed | `docs/evidence/occurrence-measurement-http.json` |
| Occurrence and measurement Chrome | 21 groups, including four held-response race regressions and 390/320px checks | `docs/evidence/occurrence-measurement-browser.json` |
| Focused accessibility | Labels, sampled text contrast, 768/1024px layouts, modal forward/reverse Tab containment and focus return | `docs/evidence/accessibility-e2e.json` |

The browser suite checks every student and operator section at 390px and 320px, and the operator pages at 1440px. Separate contexts prove persona state separation. Its final arrays contain zero runtime exceptions, unexpected console errors and external requests. Deliberate catalogue503, unavailable404 and invalid-session403 scenarios verify recovery without treating expected failures as unexpected browser errors.

## Occurrence and measurement follow-up

The follow-up from `7318b44` adds the acceptance criteria in `docs/occurrence-measurement-spec.md`. Multiple explicit occurrences retain stable IDs and independent cancellation, exact-date filters/ranking, saves, previews, feedback, self-reports and reminders. Completed snapshots stay historical; pending and unavailable saved facts use only reviewed data for the same date. Verified legacy migrations preserve private IDs, events, versions and reminder state transactionally and roll back on failed copy verification.

Measurement is a separate default-off consent. Signed presentation receipts bind exact dated choices and publication/profile/rules versions. Visible acknowledgements include empty results, repeat acknowledgements are idempotent, and distinct-recipient rates include nonresponders. Seven-day self-reported applications use timestamps rather than current-state totals. First-touch synthetic attribution, campaign pause, export/opt-out/delete, 90-day retention and small/complementary cohort suppression are covered. The separately labeled arithmetic example never enters live data.

## Behaviors verified

- Consent-based onboarding, persistent versioned preferences, reload and session reselection; profile export and isolated deletion, including a deleted-profile stale-version regression.
- Server-side filter-before-pagination, URL-backed query/page state, back/forward restoration, empty/loading/error/retry and missing detail states.
- Full age-band, full-occurrence availability, mode/area, fees, training, guardian and school-credit eligibility before ranking. Explanations remain grounded and deterministic.
- Idempotent saves and repeated handoffs. A handoff is an OPENED demo preview, not an application. Unavailable supply rejects even repeated preview requests.
- Versioned self-report history; future attendance blocked; historical attendance allowed; published reschedules update pending timing without rewriting completed reports.
- Default-off in-app reminders, read/dismiss persistence, immediate opt-out and unavailable-listing handling.
- Material edit -> draft, publish/reject, withdraw/restore -> review, source pause/resume, immutable import and catalogue audit, matching QA, aggregate-only outcomes, exception acknowledgement/resolution and fictional community publication.
- Additive legacy migration, once-only synthetic seeding and stable edited data across graceful and abrupt server-process restarts. Restart invalidates prior session signatures while preserving supply/private state.
- Loopback Host, exact Origin, bounded JSON, strict input keys, signed role-specific cookies, version conflicts, and public allowlist projection.
- Original marketing/mockup/brand assets are byte-for-byte unchanged.

## Findings fixed during integration

1. Historical handoff snapshots could permit attendance after a future reschedule. Pending reports now use the latest published occurrence timing, with regression coverage.
2. Profile version1 could be reused after deletion/recreation. An anonymous database-wide monotonic revision counter prevents stale pre-deletion updates; no persona metadata is retained by that counter.
3. Repeated handoff could return an existing record after its source was paused. Current availability is now required before returning that idempotent response.
4. Routine focus revalidation discarded unsaved form edits. Same-persona checks preserve mounted forms; invalid/changed identities still clear private UI.
5. The async signup dialog did not consistently restore or contain keyboard focus. Explicit opener restoration and forward/reverse Tab cycling now pass real Chrome checks.

## Fresh independent review

The follow-up fixes and scope reconciliation are recorded in `docs/independent-review.md`. They add coherent cross-tab match snapshots, preserved reminder drafts, guarded save loading, activity-based reminders and complete export, immutable before/after catalogue snapshots, honest freshness/evidence, stale operator controls, manual digest preview and privacy-separated feedback/report resolution. All final suites use the checksum-verified workspace Node **22.23.3**; the Mac’s agent runtime is unchanged. See `docs/dependency-runtime-review.md` for the targeted advisory assessment and announced future update limitation.

## Reproduction and artifact boundaries

Run instructions and test commands are in `LOCAL_README.md`. Tests use isolated temporary databases. They do not require external credentials, data feeds or network requests beyond loopback. The source archive is an implementation overlay for the original clone; it excludes original marketing HTML, Git metadata, dependencies, databases, environment files and build output. The verification bundle includes current evidence, actual screenshots, the short browser walkthrough and editable report/diagram sources.

Historical evidence files for checkpoint `ac5f7ee` remain labeled by the earlier documents. They are not additional tests of the current build. `tests/closeout-e2e.mjs` and the superseded one-screen operator components were removed; their relevant checks are covered by the current full HTTP/browser suites.

## Limits and remaining gates

This verifies synthetic local workflows, not the complete original blueprint or a deployed student service. See `docs/independent-review.md` for the explicit implemented/deferred gap matrix. Fixed personas can be chosen by anyone with local access. Production authentication/authorization, permitted real feeds and scheduling, cohort-specific safeguarding/consent, external AI, outbound delivery, organizer confirmation, certified hours, real marketing/pilot metrics and deployment/backups remain deferred. Business milestone gates are not established by these test counts.

Local process recovery is tested; power loss, disk loss and backup restoration are not. Accessibility checks cover concrete keyboard, label, layout and computed contrast cases, with visual inspection; they are not a formal WCAG or assistive-technology conformance certification. No real students or organizations were contacted and no application was submitted.
