# CommonGround public preview: journey and copy packet

Status: implementation goal state, 18 October 2026. This document is a content specification, not evidence that the proposed pages have been implemented or tested. It inventories the current source before the public polish pass.

## Audience, purpose, and voice

Help a high-school student find an interesting kind of volunteering, understand the practical requirements, and decide what to ask next. High-school students aged 18 and over are part of that audience. Families, schools, and organizers need clear supporting information without displacing the student journey.

The public preview offers three fictional activities and fixed sample choices. It is useful because a visitor can inspect requirements, compare examples, and try a temporary shortlist. It does not accept personal information, create accounts, connect live opportunities, send applications, or register participants.

Voice: an informed older student explaining a useful starting point. Use ordinary verbs, specific tasks, short sentences, and direct labels. Let the activity descriptions create interest. No urgency, pressure to build a résumé, claims about “the best” opportunities, fake popularity, or promises about future success. A student does not need a career plan to look around.

### Continuity decisions

| Preserve | Evolve | Retire from the public journey |
| --- | --- | --- |
| CommonGround name; the welcoming “Find a way to get involved” promise; garden/pantry/reading examples; high-school focus | One long page becomes a short browse → detail → shortlist journey. Requirements become visible beside a relevant example. Families receive a dedicated guide. | Repeated technical and consent caveats in the main selling sections; every CTA returning to the same anchor; descriptions of local test accounts; signup language; unsupported claims inherited from the original static marketing page |

The original sunrise/horizon brand mark is a useful continuity cue. Copy should work with it without adding a second metaphor such as a “launchpad,” “journey engine,” or “growth compass.”

## Current route inventory

Verified by reading route files and their imported UI components. Routes below are existing source, not a claim that they are publicly deployed. `apps/web` uses runtime/account/student providers and API-backed components; the proposed preview must not serve that application.

### Public preview today

| Route / source | Current role and behavior | Goal-state decision |
| --- | --- | --- |
| `/` — `apps/public-site/app/page.tsx` | A single marketing page with how-it-works, three fictional examples, a native detail dialog, family notes, seven FAQ answers, and repeated `#preview` CTAs. `ActivityPreview.tsx` changes a fixed age range and example in React memory. | Split into six focused page templates below. Retain the examples and requirement clarity. |

### Student application: discovery and ongoing use

Paths in this table are under `apps/web/app/`; the component column identifies source under `apps/web/components/`.

| Route | Component / verified journey role | Public-preview treatment |
| --- | --- | --- |
| `/` | `student/Dashboard.tsx`: personal starting point with matches, saved ideas, and self-reported progress | Replace with a public introduction, not an invented personal dashboard |
| `/dashboard` | Same dashboard component; duplicate entry into the ongoing student experience | Exclude; one public home is enough |
| `/onboarding` | `student/Onboarding.tsx`: profile/preferences and consent for account mode; fixed local personas for demo mode | Exclude; optional fixed sample-age buttons on Explore demonstrate one requirement without collecting a profile |
| `/profile` | `student/Profile.tsx`: stored preferences, version conflicts, optional feature controls, demo export/deletion | Exclude; no profile, storage, or privacy settings implied by a memory-only preview |
| `/opportunities` | `Catalogue.tsx`: filters and pagination over published catalogue records, including practical date/area/fee filters | Reinterpret as `/explore`, with three fictional records and a small set of useful fixed filters |
| `/opportunities/[id]` | `OpportunityDetail.tsx`: occurrence-level facts, requirements, source information, and student actions | Reinterpret as `/explore/[slug]`, with three static example detail pages and no external signup destination |
| `/matches` | `Matches.tsx`: requirement-based recommendations, reasons, feedback, and optional explanation controls | Show sample-age requirement results beside examples; do not claim personal matching or AI processing |
| `/saved` | `student/Saved.tsx`: date-specific stored ideas, removal, and unavailable-date states | Reinterpret as `/shortlist`, held only in React context across client navigation and cleared on reload |
| `/activity` | `student/Activity.tsx`: demo destination previews and self-reported applied/attended/withdrawn outcomes | Exclude; no fabricated completion, application, attendance, or activity history |
| `/alerts` | `student/Alerts.tsx`: optional in-app reminder preferences, reminders, and digest preview | Exclude; no reminder delivery or notifications in the public preview |
| `/settings/alerts` | Same Alerts component, with a settings-oriented route title | Exclude with `/alerts` |
| `/digest` | `student/ShortlistDigestPage.tsx`: private shortlist generation and separate optional email digest choice | Exclude; `/shortlist` has no subscription or delivery control |
| `/evidence` | `evidence/StudentEvidence.tsx`: private outcomes and synthetic evidence workflow | Exclude; the public checklist may say that school recognition needs a separate school decision |
| `/safety` | `student/SafetyReports.tsx`: private report workflow, including listing-targeted reports | Exclude the form; provide practical questions in the family guide and avoid implying monitored incident reporting |
| `/communities/[slug]` | `student/ReviewedCommunityPage.tsx`: reviewed synthetic community page, current example catalogue, optional campaign context | Exclude from this preview; do not invent a school, organizer, partnership, or active campaign |

### Account and supporting adult pages

All remain outside the public deployment. Listing them here fulfills the page audit; exposing a cosmetic copy of an account flow would add friction and imply unavailable functionality.

| Route | Component / verified journey role | Decision |
| --- | --- | --- |
| `/account` | `account/AccountSecurity.tsx`: account overview, role/age-band state, privacy and security links | Exclude |
| `/account/signup` | `account/AuthForms.tsx`: account creation | Exclude; no early-access form or account CTA |
| `/account/login` | `account/AuthForms.tsx`: sign-in | Exclude |
| `/account/recover` | `account/AuthForms.tsx`: recovery request | Exclude |
| `/account/reset` | `account/AuthForms.tsx`: password reset token form | Exclude |
| `/account/verify` | `account/AuthForms.tsx`: email verification token form | Exclude |
| `/account/password` | `account/AccountSecurity.tsx`: authenticated password change | Exclude |
| `/account/sessions` | `account/AccountSecurity.tsx`: active session review and revocation | Exclude |
| `/account/privacy` | `account/PrivacySettings.tsx`: storage and optional processing choices, export/deletion, youth restrictions | Exclude; concise preview-data explanation belongs in the guide |
| `/account/notifications` | `account/NotificationSettings.tsx`: optional email event reminders | Exclude |
| `/account/youth-review` | `account/YouthReview.tsx`: synthetic guardian/school review request | Exclude; do not imply verified consent or adult authority |
| `/account/reviews` | `account/YouthReviewInbox.tsx`: specifically assigned synthetic adult-review inbox | Exclude; no reviewer role is exposed |

Inventory total: 27 `apps/web` route files outside admin/API, plus one current `apps/public-site` route file. The original root `index.html`, `mockup.html`, and `brand.html` are separate static artifacts. The public deployment must serve the isolated preview output rather than accidentally publishing the legacy signup form or local app.

## Public route architecture and CTA map

| Route | Visitor question | Primary next step | Secondary/contextual next step |
| --- | --- | --- | --- |
| `/` | What is this, and is it worth trying? | **Explore examples** → `/explore` | Featured **See garden example** → `/explore/garden`; **Read the family guide** → `/for-families` |
| `/explore` | What kind of activity interests me? | **See example** → selected detail route | **View example shortlist** → `/shortlist`, only visually emphasized when it contains examples |
| `/explore/garden`, `/explore/pantry`, `/explore/reading` | What would I do, and what should I check? | **Add to example shortlist** → memory-only state change | **View example shortlist** after adding; **Back to examples** → `/explore` |
| `/shortlist` | How do these possibilities compare? | **Review the checklist** → `/how-it-works#checklist` | **Explore more examples** → `/explore`; individual **Remove** actions |
| `/how-it-works` | How do I go from interest to a considered next step? | **Try it with the examples** → `/explore` | Local `#checklist` anchor is the destination from the shortlist |
| `/for-families` | What should students and the adults helping them discuss? | **Look at an example together** → `/explore` | Local sections for families, schools, and organizers; no outreach or enrollment CTA |

Header navigation: **Explore**, **How it works**, **For families**, **Example shortlist** with an accurate count when nonzero. The brand returns home. The header does not also need a second large Explore button when Explore is already the current page.

Footer navigation: the same four destinations. Footer line: **CommonGround · A preview for high-school students.** Supporting line: **Fictional activities. No applications or account signup.**

Every page displays a compact preview label near its introduction. Detail pages repeat the no-application fact near the shortlist action. Do not repeat the full enrollment/consent explanation in every section.

## Ready-to-use copy

### Home `/`

**Metadata title:** CommonGround — Find a way to get involved

**Metadata description:** Explore a CommonGround preview for high-school students. Compare three fictional volunteer activities, understand their requirements, and try an example shortlist.

**Hero eyebrow:** A preview for high-school students

**H1:** Find a way to get involved.

**Intro:** Explore volunteering that starts with your interests. See what you’d do, what’s required, and what to ask before taking part.

**Primary action:** Explore examples

**Quiet secondary link:** How it works

**Boundary below actions:** Try three fictional activities. No signup or personal details needed.

**Illustration caption:** A little time outdoors. A place to start.

The garden illustration depicts an idea, not a real organizer, venue, participant, or partnership. Do not caption it as an actual program.

**Featured section eyebrow:** Start with something that interests you

**H2:** Outdoors, hands-on, or from home.

**Section intro:** There’s more than one way to contribute. Take a closer look at an activity before deciding whether it belongs on your shortlist.

Featured garden excerpt:

- **Community garden morning**
- **Fictional example · Environment**
- Help prepare planting beds and organize garden materials.
- **Ages 16+ · Two hours · In person**
- **One thing to ask:** What should I bring, and who will show me the work?
- **Link:** See garden example

Short adjacent editorial text, rather than three repetitive feature cards:

**H3:** The details are part of the decision.

**Body:** Age requirements, travel, time, and supervision can change what works. CommonGround’s preview puts those questions next to the activity.

**Link:** See how the checks work → `/how-it-works`

**Three-step section H2:** From “that sounds interesting” to “what’s next?”

1. **Find an idea.** Start with a type of activity you’re curious about.
2. **Read the requirements.** Look at the age range, time commitment, and anything that needs checking.
3. **Make a small shortlist.** Compare a few possibilities, then work through the questions to ask.

No additional large CTA is needed inside this flow; the next section offers a different helpful destination.

**Family section eyebrow:** For the people helping you choose

**H2:** Bring someone into the conversation.

**Body:** A parent, guardian, teacher, or counselor can help you think through transport, supervision, and school requirements. Start with the same details and a few useful questions.

**Action:** Read the family guide

**Closing H2:** Something catch your interest?

**Body:** Open an example, look at the requirements, and try a shortlist of your own.

**Action:** Explore examples

**Small line:** Built around high-school students, including those aged 18 and over.

### Explore `/explore`

**Metadata title:** Explore examples — CommonGround

**Eyebrow:** Three fictional activities

**H1:** What catches your interest?

**Intro:** Try an outdoor project, a practical team task, or something you can do from home. Open an example to see the work and the questions that come with it.

**Boundary:** These activities are made up for the preview. They cannot be booked.

**Interest control label:** Type of activity

**Fixed options:** All activities / Environment / Community / Education

**Format control label:** How to take part

**Fixed options:** Any format / In person / Remote

**Optional requirement-demo label:** Try a sample age range

**Help:** Choose a fictional range to see how the age requirement changes. This is not a question about your age.

**Fixed options:** Ages 13–15 / Ages 16–17 / Age 18+ and in high school

If the existing narrower range control is kept, use **Try the narrower 14–15 example**, displayed only for the 13–15 choice. Do not silently narrow the range or infer an exact age. Default to the fixed 16–17 sample.

**Result status:** Showing 3 fictional examples / Showing 1 fictional example / Showing 0 fictional examples. Counts describe only the preview inventory, not people, demand, or live supply.

**Listing CTA:** See example

**Shortlist link:** View example shortlist (2), with the actual in-memory count. With zero examples, a quiet **Example shortlist** link in navigation is sufficient.

**No results H2:** No examples with those choices.

**No results body:** This preview has three activities. Try a different type or format to see another one.

**No results action:** Show all examples — resets category and format, keeping the sample age clearly displayed.

### Shared detail-page structure

**Breadcrumb:** Explore / [Activity name]

**Eyebrow:** Fictional example · [Category]

**H1:** [Activity name]

**Intro:** [Concrete activity description below]

**Facts labels:** Age requirement / Time commitment / Format / Cost / Guardian requirement

**Cost value:** No fee in this example

**Date value, if shown:** No date is scheduled

**Guardian value for garden/reading:** Not specified in this example

**Guardian value for pantry:** Guardian required in this example

Do not use a green check or “no guardian needed” for an unspecified requirement. Do not invent an organizer name, address, timestamp, deadline, remaining capacity, source-verification badge, accessibility provision, or school approval.

**Section heading:** What you’d do

**Section heading:** Why this might interest you

**Section heading:** Questions to ask

**Sample-age result label:** With the [16–17] sample

**Fits title:** This sample meets the age requirement.

**Fits explanation:** This example starts at age [16]. The full [16–17] sample range is within that requirement. The other details still need checking.

**Below-minimum title:** This sample includes ages below the minimum.

**Below-minimum explanation:** This example starts at age [14]. The [13–15] sample includes age 13, so the full range does not meet the requirement.

**Guardian result title, when the age check passes:** The age range fits. A guardian is also required.

**Guardian explanation:** Meeting the age requirement does not settle the guardian requirement. In a real activity, ask the organizer how that arrangement works.

When the age check fails and a guardian is required, show both facts. Changing to the 18+ sample does not silently remove the stated guardian requirement. Never use “eligible,” “approved,” “safe,” “perfect match,” or a percentage score for this partial demonstration.

**Shortlist area heading:** Worth comparing?

**Before-action explanation:** Add this fictional activity to your example shortlist. It stays while you move between these pages and clears when you reload.

**Primary button:** Add to example shortlist

**After-add button state:** Added to example shortlist

**After-add status:** [Activity name] added. No application has been sent.

**After-add next action:** View example shortlist

**Existing-item status:** This example is already on your shortlist.

**Quiet boundary:** This is a comparison tool. These activities cannot be booked.

Adding a fictional item may remain available for comparison even when the sample age fails. Keep that failed requirement visible on both the detail and shortlist. A bookmark must not imply eligibility.

### Garden detail `/explore/garden`

**H1:** Community garden morning

**Intro:** Help prepare planting beds and organize materials for a community garden.

**Facts:** Ages 16+ / Two hours / In person / No fee in this example / Guardian requirement not specified

**What you’d do:** Work through practical garden tasks, such as getting planting beds ready and sorting tools and materials.

**Why this might interest you:** You’re curious about the environment and enjoy work you can see taking shape.

**Questions to ask:**

- Where and when would the activity take place?
- What should I wear or bring?
- Who will explain the tasks and supervise the work?
- Are the tasks and site suitable for my access needs?

**Illustration caption:** An example of hands-on work outdoors.

### Pantry detail `/explore/pantry`

**H1:** Food pantry packing

**Intro:** Sort supplies and prepare packs with a community food team.

**Facts:** Ages 14+ / Three hours / In person / No fee in this example / Guardian required

**What you’d do:** Help organize supplies and assemble packs as part of a team.

**Why this might interest you:** You like practical tasks and working alongside other people.

**Questions to ask:**

- Does a guardian need to attend, or is another arrangement required?
- What tasks are suitable for my age?
- Is lifting involved, and what help is available?
- What instructions or training would I receive before starting?

**Illustration caption:** An example of working together on a practical task.

### Reading detail `/explore/reading`

**H1:** Remote reading preparation

**Intro:** Help prepare reading materials for an education project, from home.

**Facts:** Ages 16+ / Two hours / Remote / No fee in this example / Guardian requirement not specified

**What you’d do:** Help organize and prepare reading materials for the example project. This example does not describe direct tutoring or contact with children.

**Why this might interest you:** You enjoy reading and want to explore a task you can do remotely.

**Questions to ask:**

- What would I produce, and how would I know it is finished?
- When is the work due, and is there a fixed meeting time?
- Who would explain the task and review the work?
- What equipment or software would I need?

**Illustration caption:** An example of contributing from home.

### Example shortlist `/shortlist`

**Metadata title:** Example shortlist — CommonGround

**Eyebrow:** Compare a few possibilities

**H1:** Your example shortlist

**Intro:** Look at the time, format, and requirements side by side. Then decide which questions you would ask first.

**Boundary:** Fictional activities only. This list stays as you browse these pages and clears when you reload. Nothing is booked or sent.

**Comparison labels:** Activity / Age requirement / Time / Format / Guardian requirement / Sample-age check

**Row link:** Read details

**Remove action:** Remove — accessible name should include the activity name.

**Removed status:** [Activity name] removed from the example shortlist.

**Empty H2:** Start with one possibility.

**Empty body:** Open an activity that interests you and add it here. You can compare the details before choosing what to ask next.

**Empty action:** Explore examples

**Nonempty next-step H2:** Before an interest becomes a plan.

**Body:** A good next step is often a question. Use the checklist to think through dates, travel, supervision, and any school requirements.

**Primary action:** Review the checklist

**Secondary link:** Explore more examples

Do not offer “Apply,” “Register,” “Send to parent,” “Email my list,” “Save forever,” “Download my hours,” or any external contact action. Do not call this persistent storage or imply the list will be available next time.

### How it works `/how-it-works`

**Metadata title:** How it works — CommonGround

**Eyebrow:** A few useful steps

**H1:** Interest first. Details next.

**Intro:** You don’t need to know your future plans to explore volunteering. Start with something you’d like to try, then look at what taking part would involve.

**Boundary:** This preview uses fictional activities so you can try the process without an account.

**Step 1 H2:** Find an idea.

**Body:** Browse by the kind of work or how you’d take part. Outdoors, with a team, or from home is enough of a starting point.

**Step 2 H2:** Look at the requirements.

**Body:** Interest alone does not tell you whether an activity will work. Check the age requirement, time commitment, location, and any guardian or training requirements.

**Supporting example:** A 14+ activity does not fit every age in a 13–15 sample. A guardian requirement is a separate question, even when the age range fits.

**Step 3 H2:** Keep a small shortlist.

**Body:** Compare the details of a few examples. You can remove an idea or look at another one without making a commitment.

**Step 4 H2:** Ask before making a plan.

**Body:** For a real activity, confirm the current details with the organizer. If you need school recognition, speak to your school before taking part.

**Checklist H2 (`id="checklist"`):** Questions worth asking before you apply

Checklist is informational, not a form, sign-off, consent mechanism, or eligibility certification. Use a plain list or accessible disclosures; no misleading progress-complete badge.

1. **The activity:** What will I actually do? Who can answer my questions?
2. **The requirements:** Does the activity accept my age? Is training, permission, or a guardian required?
3. **The practical plan:** When and where is it? Can I get there and back? Are there costs or equipment to arrange?
4. **Support and access:** Who will supervise? What support or adjustments can the organizer provide?
5. **School recognition:** If I need service hours or credit, what does my school require before I start?
6. **The current details:** Is the activity still available, and have any requirements changed?

**Closing action:** Try it with the examples

**Compact FAQ, if useful below the checklist:**

**Can I join from this preview?** No. The activities are fictional, and there are no applications or account signups here.

**Is this matching me with an opportunity?** You can try fixed sample age ranges and see a requirement check. This preview does not create a profile, use AI, or make a full eligibility decision.

**Will an activity count for service hours or credit?** Your school decides what it recognizes. A shortlist or requirement check does not guarantee either.

**What happens to my choices?** The sample choices and shortlist stay in this page session while you browse. Reloading clears them. There is no account or email signup.

The last answer must match actual implementation. Do not add an absolute “we collect no data” claim: hosting infrastructure can have normal request logs even when the app has no personal-data form or analytics.

### For families `/for-families`

**Metadata title:** For families, schools, and organizers — CommonGround

**Eyebrow:** Supporting a student’s next step

**H1:** A useful conversation starts with the details.

**Intro:** Students can explore what interests them while the adults helping them ask practical questions. Start with the work, the requirements, and the support needed to take part.

**Boundary:** CommonGround is a prelaunch preview with fictional activities. Real student enrollment is not available here.

**Families H2:** For families

**Body:** Look at the activity together. Ask who will supervise, what permission is needed, and how travel or access needs will be handled. A listing or a requirement check cannot answer every question about an experience.

**Useful prompts:**

- What interests you about this activity?
- What would help you feel prepared?
- What should we ask the organizer before making a plan?

**Schools H2:** For schools and counselors

**Body:** An activity can be interesting without meeting a school’s service-hour or credit requirements. Explain your approval process, what evidence you need, and which questions students should ask before taking part. This preview does not award or certify hours.

**Organizers H2:** For organizers

**Body:** Clear listings help students decide whether to ask for more information. Age limits, tasks, dates, supervision, access arrangements, costs, and the right contact person all matter. The activities here are invented; no organization or school is presented as a partner.

**Availability H2:** What this preview does today

**Body:** Anyone can explore three fictional activities and try a temporary shortlist. There are no live feeds, applications, accounts, guardian approvals, or email subscriptions on this site. Before real minor enrollment, the age, consent, and safeguarding approach still needs review.

**Closing action:** Look at an example together

## Shared recovery and interaction copy

| State | Heading / message | Action |
| --- | --- | --- |
| Unknown detail slug / 404 | **We couldn’t find that example.** This preview includes three fictional activities. Choose one from Explore to continue. | **Explore examples** |
| Generic page error | **This page didn’t open.** Try again, or return to the examples. | **Try again**, then quiet **Explore examples** link |
| Loading route, only if needed | Opening the example… / Opening your example shortlist… | No fake progress percentage |
| Filter update | Showing [number] fictional examples. | Announce in a polite status region; keep keyboard focus on the selected control |
| Shortlist add | [Activity] added to the example shortlist. No application has been sent. | **View example shortlist** |
| Shortlist remove | [Activity] removed from the example shortlist. | Keep focus useful; empty-state action appears when last item removed |
| Age preset change | Showing requirements for the [16–17] sample. | Do not say “Your age” or silently change filters |
| Existing shortlist item | This example is already on your shortlist. | **View example shortlist** |

Unknown route and error treatments must be actual route behavior, not decorative screenshots. Browser back/forward, direct links, reload clearing, and selected-filter visibility need verification after implementation.

## Before / after review

| Surface | Before, verified in existing public source | Goal-state improvement |
| --- | --- | --- |
| Home introduction | Warm headline, but a long page with every major CTA pointing at `#preview` | Keep the headline; immediately offer a real browse destination and a concise preview boundary |
| Activity discovery | Three activity buttons and an age selector in a single large embedded workspace | A dedicated, scannable Explore page with concrete summaries, fixed useful filters, and clear results |
| Detail | Native modal compresses facts, checks, and next step into one overlay | Shareable static detail routes with tasks, reasons, requirements, unanswered questions, and one meaningful action |
| Shortlist | No public shortlist exists | Temporary, explicitly described comparison with a clear next step and a useful empty state |
| How it works | Broad process copy amid marketing sections | Direct walk-through connected to the actual example journey, ending in a useful checklist |
| Families | Family, school, and organizer information shares a section with implementation-heavy synthetic-consent caveats | Dedicated short guide explains questions and current limits in ordinary language |
| Questions | Seven answers include local account behavior, future opportunity categories, and repeated caveats | Four focused answers address joining, sample checks, school recognition, and temporary choices |
| Legacy claims | Root `index.html` advertises AI recommendations, every opportunity type, badges, portfolios, and unconditional free availability | These claims do not enter the isolated preview. Demonstrated value is browsing, requirement clarity, and comparison |
| Visual proof | Original illustrations and functional age checks are credible preview material | Show the actual listing/detail/shortlist behavior; use no invented users, quotes, statistics, partner logos, live-feed stamps, or success rates |

## Explicit anti-slop and claim review

- Removed vague promises about unlocking potential, transforming futures, seamless discovery, empowering communities, and personalized success. They offer no observable benefit in this preview.
- Kept specific tasks and practical decisions: prepare planting beds, sort supplies, prepare reading materials, check age/time/guardian requirements, compare examples, ask an organizer.
- No fake testimonials, student counts, organizer counts, hours, ratings, acceptance percentages, deadlines, availability signals, or partnerships.
- No claims of vetted safety, guaranteed suitability, legal consent verification, school credit, certified hours, live collection, AI matching, or real application delivery.
- No invented scarcity, “join now,” waitlist, fear of falling behind, college-admission pressure, or résumé promises.
- One main next step per page. Supporting destinations are quiet links or clearly different actions. Informational pages do not repeat a large signup CTA in every section.
- “Preview,” “fictional,” and “example” remain visible at entry and action points. Technical terms such as synthetic account, runtime mode, provider seam, operator, persona, and persistence do not appear in visitor copy.
- The same label names the same action across pages. “Example shortlist” consistently means a temporary comparison list. “Add” does not become “apply,” “save permanently,” or “register.”
- Empty and error states explain what happened and offer one useful recovery action. They do not blame the visitor or ask for unnecessary information.

## Implementation acceptance notes

1. Public assets and generated pages come only from `apps/public-site`. No `apps/web` API, account route, database, private token, legacy form, or admin state is reachable from the preview.
2. Use fixed activity and age presets only. No free-text input, birthday, location, contact information, forms, subscriptions, outbound messaging, or user-data submission.
3. Keep shortlist and sample choices in React context across client navigation. Clear on reload. No localStorage, sessionStorage, cookie, database, tracking, or analytic event is required for this preview.
4. Filtering is category/format only. A sample age result explains the full chosen range; it does not imply a complete matching decision. Never turn off the guardian condition automatically for an adult sample.
5. The three fixed detail pages must work via direct URLs. Unknown slugs and routes need the recovery content above. Do not rely solely on modal state.
6. Render all claims and action labels from this packet against actual behavior. If the implementation differs, update copy before deployment; do not leave the mismatch as a footnote.
7. Independent content/design review and real desktop/phone browser evidence remain required after implementation. This packet alone is not a release-quality or accessibility sign-off.

## Evidence sources

- `apps/public-site/app/page.tsx`: current hero, navigation, process, family notes, FAQ, and anchor CTAs.
- `apps/public-site/components/ActivityPreview.tsx`: current example selector, native dialog, fictional-age input, and point-of-action copy.
- `apps/public-site/components/preview-model.ts`: three fictional activities; minimum-age/guardian model and full-range comparison behavior.
- `apps/public-site/README.md`: isolated app boundary, current browser-memory behavior, and verification workflow.
- `apps/web/app/**/page.tsx` excluding admin/API: route inventory and imported components.
- `apps/web/components/Catalogue.tsx`, `OpportunityDetail.tsx`, `Matches.tsx`: discovery and requirement behavior.
- `apps/web/components/student/` and `apps/web/components/account/`: student and account responsibilities described in the inventory.
- `brand.html`: original brand mark and color-language evidence.
- `index.html`: legacy breadth/AI/portfolio/free-availability claims that must not be carried into this preview without support.
