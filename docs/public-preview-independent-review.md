# Public preview: independent goal review

Reviewed 18 October 2026. Scope: the existing `apps/public-site` source, preserved real browser captures from 17 October, and the student-facing route inventory in `apps/web`. This is a source/capture review before the expanded online preview is implemented. It is not a new browser run or a deployed-site acceptance result. The main application remains outside the public preview.

## Visitor task and decision

Persona: a high-school student visiting on a phone for the first time, curious about volunteering but unsure which practical requirements matter. A parent or school staff member may review the same example with them.

The visitor should be able to browse a small fictional catalogue, understand one activity's requirements, keep it in a temporary example shortlist, and leave with concrete questions to ask before any real application. The intended path is `/` → `/explore` → `/explore/[slug]` → `/shortlist` → `/how-it-works#checklist`. `/for-families` supports that path.

**Decision:** accept these six page templates as the design goal, subject to the acceptance criteria below. They demonstrate a useful student journey without presenting account enrollment or live opportunity supply as available.

## Ranked findings in the existing preview

| Priority | Evidence | Finding and required outcome |
| --- | --- | --- |
| High | `apps/public-site/app/page.tsx:23`, `:26`, `:33`, `:36`; `components/ActivityPreview.tsx:36–43` | Every main action returns to the same comparison panel; its detail dialog closes back to the examples. This was valid for the earlier one-page concept, but does not fulfill the newly requested broader preview. Build the browse → detail → temporary shortlist → checklist path, with a useful destination at each step. |
| High | `apps/web/components/Header.tsx:12–13`; `student/StudentSession.tsx:74–86` | The local application offers nine student navigation links plus account/persona and operator controls. It must not become the public preview shell: many destinations require stored identity/profile state and introduce operational concepts. Public navigation should expose only the six preview templates; direct account/admin/API routes must remain outside the deployed preview. |
| Medium | `apps/public-site/app/page.tsx:7–13`, `:26`, `:34`, `:38` | Repeated policy caveats and details about adult test accounts make the page sound like an implementation report. Keep a short, clear fictional/no-application notice on each route, repeat it at consequential actions, and place detailed family/school limitations on the support pages. Do not remove the actual boundary. |
| Medium | `apps/public-site/app/page.tsx:17`; `apps/web/components/Brand.tsx:1` | The public page substitutes a new line monogram for the existing sunrise mark. Use the original mark and palette consistently unless a brand change is separately chosen. |
| Medium | Preserved `apps/public-site/output/playwright/mobile-hero-390.png` | At 390 × 844, meaningful activity artwork begins near the bottom of the first screen; most of that screen is headline, introduction and navigation. Place the primary action and a recognizable part of the activity scene in the initial phone view. Keep the boundary legible. This is a composition issue, not a clipping defect. |
| Medium | `apps/public-site/app/page.tsx:29–36` | Multiple abstract headings repeat “start,” “curiosity,” “clear” and “next step” without adding a new task. Replace repeated motivational sections with concrete activity details, comparison or the checklist. One primary action per screen; navigation links may remain secondary. |
| Low | `apps/public-site/app/globals.css` narrow-phone rules; preserved mobile preview capture | Essential metadata falls to 9–10px in small activity controls. Use at least 13–14px for facts the visitor must compare, even if that requires vertically stacked choices. Do not shrink meaningful requirements to preserve a three-column control. |

No fabricated testimonial, partner logo, match percentage, participation total or real booking promise was found in the existing public preview. Its labeled controls, native dialog, visible focus, reduced-motion rules and honest guardian/age comparison are useful foundations to retain.

## Student-route breadth: what the preview should represent

| Local application area | Existing routes | Public treatment |
| --- | --- | --- |
| Discovery and understanding | `/opportunities`, `/opportunities/[id]`, `/matches` | Represent through `/explore` and fictional detail pages with readable requirements and explanation. Do not expose stored profile versions, ranking internals or measurement logs. |
| Keeping ideas | `/saved`, `/dashboard`, `/activity` | Represent only the temporary example shortlist. Do not imply persisted saves, application tracking or confirmed attendance. |
| Preferences and identity | `/onboarding`, `/profile`, `/account/*` | Use fixed fictional scenarios; no sign-in, name/email/password fields, school identifiers, personal free text or durable profiles. |
| Follow-up and evidence | `/alerts`, `/settings/alerts`, `/digest`, `/evidence` | Explain practical next questions in the checklist. No outbound subscription, proof upload, verification or self-reported completion feature is needed in this public preview. |
| Safety and operations | `/safety`, `/admin/*` | Keep operational workflows local. Family/support copy must not imply that a synthetic preview provides real monitoring, safeguarding, guardian verification or emergency response. |
| Community distribution | `/communities/[slug]` | Do not imply school/organizer partnerships. A fictional community context may illustrate an example if explicitly labeled. |

## Implementation acceptance criteria

1. **Complete route journey.** Primary homepage action goes to `/explore`. Each example has a stable detail URL. Detail has one primary add-to-example-shortlist action. Shortlist leads to a practical checklist. The header and footer provide a clear route home. No links point to localhost, the local account application or nonexistent destinations.
2. **Useful empty and error states.** Empty shortlist gives one obvious “Explore examples” action. A filter with no result explains that only the fictional examples are being filtered and offers reset. Unknown slugs produce a useful not-found page. Back navigation preserves choices for the lifetime actually supported.
3. **Honest state.** The shortlist's lifetime is stated before or at the first add action and on its page. If state exists only in React memory, say that refresh clears it; do not call it a saved account list. The visible count, duplicates, removal, back navigation, refresh and a new tab must behave consistently with this wording. Add/remove status is announced to assistive technology.
4. **No personal-data path.** Only fixed fictional scenario/filter choices. No free-text forms, account enrollment, contact capture, uploads, location permission, storage identifiers, outbound provider calls or analytics. Hosting may still receive ordinary request metadata, so avoid the absolute claim “we collect no data.” Say what this preview itself does.
5. **Requirements remain distinct.** Age-range comparison covers the whole chosen band. Guardian requirements remain separate even for the age-18+ high-school scenario. Unknown dates, supervision, accessibility or school recognition remain questions. No “eligible,” “safe,” “verified,” confidence percentage or recommendation proof is inferred from an age-only comparison.
6. **Concrete copy.** Explain the activity, its time commitment, mode and stated requirements before abstract benefits. Use “example”/“fictional” where needed. Avoid internal terms such as fixture, provider, admission policy, profile version, exposure or assigned test account. No invented social proof, partner relationships, urgency, available places or certified hours.
7. **Accessible interaction.** One clear H1 per route; semantic headings/landmarks; skip link; visible focus; real links for navigation and buttons for actions; labels for filters; keyboard access to every action; current-page indication. Primary touch actions should be at least 44px. Any dialog must trap focus, dismiss with Escape and return focus. Essential text stays readable at narrow widths and zoom.
8. **Responsive composition.** No horizontal page overflow or clipped requirements at 320, 390, 768, 1024 and 1440px. At 390 × 844, the first view contains the purpose, primary action, short fictional boundary and meaningful activity imagery. Lists and detail sections should scan naturally rather than repeat identical marketing cards.
9. **Restraint in motion.** Preserve reduced-motion behavior. Prefer a short accent to perpetual shimmer; motion must never hide content, delay actions or compete with reading. Decorative art must not be represented as a photograph of a real program.
10. **Fresh deployed evidence.** Independently verify the exact deployed revision with desktop/phone captures, route refresh/deep links, keyboard journey, add/remove/reset behavior, external-request/storage checks and console/network checks. Existing account walkthrough footage and old homepage captures do not prove the new preview.

## Content and visual packet decision

Read the complete [journey and copy packet](public-journey-content.md) and [visual goal](public-preview-design-goal.md) after the initial observations above. Both are **accepted for implementation**. There is no remaining content/design goal blocker.

The packets address the existing dead-end interaction, preserve the original sunrise identity, reduce repeated slogans and implementation language, and define useful fictional detail/shortlist/checklist routes. They explicitly handle empty filters, an empty shortlist, unknown URLs, failed age requirements, separate guardian conditions, keyboard behavior and narrow layouts. The visual packet provides an achievable phone composition budget rather than shrinking text to fit.

Implementation clarifications sent to both owners:

- Keep a failed sample-age requirement visible when its activity is added for comparison and when shown in the shortlist. Adding must never imply approval.
- Preserve the temporary shortlist through internal client navigation, and clear it on refresh/new tab consistently with the stated memory-only behavior.
- Keep critical age/guardian and no-application limits visible near the decision; do not hide them only in optional FAQ disclosures.
- Verify touch spacing in the compact phone header and actual readable text sizes after rendering.

These are goal decisions. Acceptance of the packets is not approval of screenshots or code that has not yet been produced.

## Current static-export boundary check

Read `vercel.json`, `apps/public-site/next.config.mjs`, `scripts/audit-public-export.mjs`, `scripts/serve-public-preview.mjs`, `tests/public-preview-boundary.test.ts` and the deployment runbook. The current configuration explicitly serves `apps/public-site/out`, disables framework inference, exports static pages, has no functions/rewrites/cron tasks, blocks form submission and embedding, limits asset/connections to the same origin, and requests no indexing. The feature deployment switch was still disabled at this check.

Independently ran the two public-boundary tests: **2/2 passed**. The current baseline export audit passed for **31 static files**. This does not establish the contents of the expanded future export or the hosting project's effective deployment settings. The final artifact audit should also inspect provider-key names and token patterns; the current script's credential checks cover only selected configuration/private-key/path markers. Direct online account/admin/API absence and actual response headers still require fresh verification.

## Review limits

Runtime, deployment isolation and hosting authorization are being handled separately by the integration owner. This review does not certify accessibility, legal consent, age/guardian identity, service-hour approval, real source permission or production readiness. The source/capture observations above should not be presented as results from the future deployed preview.
