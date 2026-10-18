# CommonGround public preview: visual goal

Status: proposed goal for review before implementation. 18 October 2026.

This packet describes the next public preview. It is not evidence that the proposed screens are implemented or deployed. Final copy and the complete route inventory live in [public-journey-content.md](public-journey-content.md). The implementation must remain a static, fictional demonstration with no accounts, personal-data entry, external organizer action, analytics, or connection to the local application database.

## Direction

**Visual thesis:** A sunny community field guide: a concrete activity earns attention, then clearly grouped requirements make the next step easy.

**Content plan:** Invite a student into an activity; let them browse three examples; explain the chosen example; let them keep a temporary example shortlist; offer a practical checklist. Families, schools and organizers get a compact guidance page linked where their questions arise.

**Interaction thesis:** A short scene entrance establishes place; active filters update the list and its status together; a small button-state change confirms adding an example to the shortlist. Important content is visible immediately. Motion stops under reduced-motion preferences.

The emotional goal is curiosity followed by confidence about what to check. The visible proof is the working comparison, honest requirements and checklist. There are no outcome numbers, user quotes, partner logos or claims of vetting, live availability, school credit, AI accuracy or completed enrollment.

## Evidence inspected

- [Original brand guide](../brand.html): sunrise over a horizontal line, ocean blue, teal reflection, coral/gold sun, deep navy, system sans typography.
- [Original landing page](../index.html): student-focused invitation, large text, rounded controls, bright illustration colors. Its early-access form is outside this preview's scope.
- [Current preview page](../apps/public-site/app/page.tsx), [styles](../apps/public-site/app/globals.css), [scene](../apps/public-site/components/CommunityScene.tsx), and [interaction](../apps/public-site/components/ActivityPreview.tsx).
- Actual local captures: `apps/public-site/output/playwright/desktop-hero-1440.png`, `desktop-1440.png`, `mobile-hero-390.png`, `mobile-preview-390.png`. These generated files remain local and are excluded from Git.
- Existing actual Magic UI [GridPattern](../apps/public-site/components/magicui/grid-pattern.tsx) and [ShimmerButton](../apps/public-site/components/magicui/shimmer-button.tsx), with [source provenance](../apps/public-site/vendor/README.md) and retained MIT notice.

Observed strengths: the original illustration has a narrative, the navy/paper/sky combination is recognizable, facts are separated from claims, and the sample comparison works. Observed problems: the current 390px hero places the artwork below approximately 730px; the desktop headline is substantially larger than the brand; the long homepage repeats introductory and final-CTA messages; the only detail surface is a modal; and the public wordmark uses a newly invented monogram rather than the original sunrise identity.

## Continuity map

| Decision | Treatment | Reason and visible result |
| --- | --- | --- |
| Sunrise and horizon | Preserve and restore | Reuse a simplified version of the original mark in header/footer; retain its blue field, warm sun and teal reflection. Do not use the newer U-shaped monogram. |
| Ocean, navy, teal and coral | Preserve with assigned roles | Navy is type and strong action; ocean is links/focus; teal/coral remain primarily illustration colors. Avoid several competing button colors. |
| Original garden/pantry/reading scenes | Evolve | Keep the recognizable activities; improve poses, proportions, negative space and crops. Depict fictional settings, never a named venue or claimed partner. |
| Bold sans typography | Evolve | Reduce display size and tracking compression; use a practical reading scale on interior pages. Brand lockup stays prominent. |
| Starting line / shared ground | Evolve into one signature | A quiet horizon line links scene and facts, and reappears as a thin divider above the next step. Use one meaningful line rather than many ornamental shapes. |
| Oversized repeated hero statements | Depart | Home has one invitation. Interior pages start with the working task. This gets people to an actual example earlier. |
| Boxed benefit grid and repeated CTA blocks | Depart | Use a featured listing excerpt, plain steps and separated listing rows. Reserve a containing panel for an interactive control group or comparison. |
| Five-color buttons and pulsing status | Depart | One primary action style per view. Never imply that a service is live by animation or a colored dot. |

## Design grammar and tokens

Use these values as a starting implementation contract, then verify rendered text and controls. Keep the existing local system-font approach; no remote font request or new font dependency is needed.

| Token | Goal |
| --- | --- |
| `--navy` | `#0e1f2e`: primary text and primary action background |
| `--ocean` | `#0369a1`: interactive text, focus, selected-control border |
| `--brand-blue` | `#0284c7`: original logo field; decorative areas only unless contrast is verified |
| `--paper` | `#f8f7f2`: primary reading surface |
| `--white` | `#ffffff`: optional control surface |
| `--sky` | `#a4d8ef`: scene sky and small broad section surface |
| `--sky-pale` | `#e9f4f5`: calm hero plane behind text |
| `--teal` / `--coral` | `#06c4b0` / `#fb923c`: scene accents, never white body text backgrounds |
| `--muted` | `#4d606a`: secondary reading text |
| `--line` | `#cad2d2`: decorative dividers; do not rely on this alone for interactive control boundaries |
| Body | Arial, Helvetica, sans-serif; 17px / 1.55 desktop, 16px / 1.55 phone |
| Home H1 | 72–80px / 1.03 at 1440px; 44–48px / 1.04 at 390px; 38–40px at 320px; tracking about `-.04em` |
| Interior H1 | 48–56px / 1.08 desktop; 34–38px / 1.1 phone |
| H2 / H3 | 34–42px / 1.12 and 22–26px / 1.2 desktop; 28–32px and 21–24px phone |
| Small text | 13–14px / 1.5. No 8–10px explanatory or eligibility text. |
| Label | 12px / 1.4, medium/semibold; sentence case by default. An uppercase section eyebrow may use modest tracking. |
| Content measure | 1200px maximum content width; 64–72px outer margins at 1440px, 32px at tablet, 20px at phone |
| Reading measure | Approximately 60–66 characters; factual definition lists can be narrower |
| Section spacing | 80–96px desktop, 48–64px phone; routine internal gaps 12/20/32px |
| Radius | 6px controls, 8px image crops; avoid a rounded box around every section |
| Primary controls | At least 48px high, comfortable side padding, clear text label; 3px focus outline with 4px offset |

The hero background runs edge to edge. Only its text/action container is constrained. Interior pages share the same content grid. Their page titles align with listing titles, facts and footer content rather than drifting between centered and left-aligned compositions.

## Shared shell

- Restore the original sunrise mark with a readable `CommonGround` wordmark; desktop lockup around 28–30px text, phone 23–25px. No extra tagline in the header.
- Desktop: brand at left, `Explore`, `How it works`, `For families` in the center/right, `Example shortlist` as a quiet text link with a count when nonzero. The active link has a visible underline and `aria-current="page"`.
- Phone: brand and shortlist on one row; three navigation links on a compact second row. Keep the shell around 96px high. Do not hide essential pages behind an untested menu, allow horizontal page overflow, or squeeze labels into 10px type.
- The brand link returns home; ordinary route links use normal browser navigation. Back/forward must restore a useful previous context. A detail page has a visible `Back to examples` link in addition to browser Back.
- Use one unobtrusive status sentence near each page's introduction: `Fictional examples. No applications or accounts.` Repeat more specific context only at the decision where it matters. Avoid a stack of prelaunch pills and warning boxes.
- Footer: simple brand, three information links, and short preview status. No newsletter, social proof, signup form or invented social account.
- Every route has a skip link, one H1, landmarks, visible keyboard focus, and a meaningful document title.

## Page and section execution brief

### 1. Home `/`

**Job:** make the purpose legible in one glance and invite a low-friction look at an example.

1. Full-bleed, pale-sky hero with original garden scene occupying the right and lower edge. Title and action sit over a calm area at left. Use the content agent's final headline, limited to about three desktop lines and three phone lines. A one-sentence explanation follows. The sole primary hero action is **Explore examples**. A nearby small sentence states that the activities are fictional and no account is needed.
2. One featured example excerpt with landscape crop, title, a short description, and age/time/format facts. The action is **See example**. This is concrete product proof and can replace the current broad “details matter” explainer.
3. A compact three-step horizontal sequence: browse, compare requirements, keep an example shortlist. On a phone, stack with a continuous vertical rule. Each step has one short useful sentence; avoid three separate bordered cards.
4. One short family/school reassurance area with a text link to the guidance page. Finish with a compact **Explore examples** action if it is separated from the hero by substantial content. Do not add another oversized slogan block.

**First viewport budget:** At 1440 × 900, header about 88px and hero about 640–680px; the entire headline, short description, CTA, preview note, and meaningful garden activity appear together. At 390 × 844, header at most about 96px, text/action area about 340–390px, and scene about 220–250px; the person/planting bed and CTA should both be visible before scrolling. At 320 × 640, preserve the CTA and at least the meaningful upper portion of the activity scene, then allow natural scroll. Never hide copy to hit a height target, or impose a fixed viewport height that clips larger text.

**Composition change:** Replace the rigid vertical paper/illustration split with a unified pale-sky canvas. The illustrated ground curves across the lower edge and supplies the horizon gesture. Keep people and activity to the right on desktop; on phone, use an intentionally recomposed lower scene rather than cropping off heads and hands.

### 2. Explore `/explore`

**Job:** compare the three fictional opportunities quickly.

- Start with `Explore examples`, one sentence of orientation, and the fictional-only note. This is a working page; no large marketing hero.
- Desktop layout: 240px filtering/scenario rail, a 40–48px gap, and the list. Phone: visible compact filters above results; category choices wrap naturally and remain at least 44px high.
- Show controls as a labeled, plain group: interest or category, format, and fixed fictional age scenarios if they are part of the agreed copy. Call the latter an example scenario. No birthday, name, school, location or free-text field. Do not label the chosen fictional scenario `your profile`.
- Result heading states the number of **examples**, not live opportunities. A short `role="status"` reports updates without moving focus.
- Use separated listing rows, with a 220–260px landscape scene crop on desktop, title, one-line task, and three or four practical facts. On phone the image can be a 16:9 strip above its facts; avoid an extremely tall illustration before every title. A compact 112px thumbnail beside a title is also acceptable if text remains readable at 320px.
- Listing titles are links. The visible row action is **See example**. Do not nest a button inside an entire clickable row or make the complete row an ambiguous pointer surface.
- An eligibility explanation is literal text tied to the current fictional scenario. Use a simple accent line and icon plus label. No percentage score, progress ring, stars or ranked “best match” badge.
- Empty state: clear heading, one sentence naming the current filter limitation, **Clear filters**. Preserve selected controls so the cause is visible. The three examples are a deliberately small demonstration, not a claim about supply.

### 3. Example detail `/explore/[slug]`

**Job:** understand the task and requirements, then keep the example if useful.

- A small `Back to examples` link comes first. Below: fictional-example label, activity title, short task description, and a landscape activity illustration.
- Desktop: title and image in the wider left column; a compact facts/action column at right, about 320px. The action column may be sticky beneath the header only while it fits the viewport. Phone: title → image → facts → requirement explanation → primary action → checklist. No fixed bottom action that covers text or browser controls.
- Present age, format, time, cost, training and guardian requirements as a definition list. Distinguish stated facts from unknown information with explicit labels. Do not turn “not stated” into a green success indication.
- The fictional scenario explanation sits adjacent to requirements and uses the wording agreed by the content/domain review. Age eligibility alone must not look like approval to attend. A guardian-required example retains that separate requirement even when age fits.
- Primary action **Add to example shortlist** becomes **Added to example shortlist** with a check and a nearby **View example shortlist** link. Addition announces a concise status without a modal, confetti or automatic redirect.
- The “Before you apply” content is a plain checklist of what to verify with an organizer and school in a real listing. There is no `Apply`, `Contact organizer` or fabricated external destination.
- The complete page stands alone when loaded directly; unknown slugs show a useful 404 with **Explore examples**.

### 4. Example shortlist `/shortlist`

**Job:** make a few examples easy to compare and turn curiosity into questions worth asking.

- Use the same task-first header. Explain the actual storage behavior in plain language once: this preview retains examples only in temporary page memory, according to the implemented session behavior. Do not promise persistence that has not been built.
- Empty: one small original illustration, `Your example shortlist is empty`, a short explanation and **Explore examples**. Avoid an enormous empty-state mascot or manufactured activity history.
- Populated: separated compact rows, with title, age/time/format facts, **See example**, and clearly named **Remove [title]** action. Never hide removal behind a decorative icon only.
- A requirement comparison can use a table on desktop if all column headings remain readable. On phone, stack the same facts in each row; no sideways data carousel.
- The meaningful next action is **Review the checklist**, linking to the visible checklist section. Checklist items can be local toggles, with a sentence that they are practice only. No completion badge implying attendance, service hours or consent.
- A calm text link back to explore supports comparison. The shortlist count uses accurate local state, and reset/refresh behavior is disclosed and tested.

### 5. How it works `/how-it-works`

**Job:** explain exactly what the visitor can do in this preview.

- Compact title and introduction; a three-step sequence uses the same horizon/vertical-rule device as home.
- Each step includes a short, actual example: an interest, an age/guardian requirement, and a shortlist question. Include one small rendering of the existing activity artwork rather than decorative technology icons.
- Show the distinction between sample requirements and the questions a real organizer must confirm. No “AI-powered”, “verified”, “personalized for everyone” or “seamless” language.
- A short FAQ answers signup, data, booking and school-recognition questions. Use native disclosure controls when answers are optional, not for critical restrictions.
- One primary ending action **Explore examples**. Contextual text links can lead to family guidance.

### 6. For families `/for-families`

**Job:** give families, schools and organizers specific questions and current boundaries.

- Use a paper reading surface, a compact title, and a modest original illustration of people reviewing a fictional activity together. If a new illustration is not ready, use a well-composed crop of the existing garden; do not substitute shield/checkmark iconography that suggests certification.
- Three plain sections with anchor links: families, schools, organizers. Each names the practical checks relevant to that reader. All remain on one page, preserving context.
- Critical preview boundaries are visible body text, not collapsed FAQ content. Clearly state that there is no real enrollment/application and no implied school recognition or organizer relationship.
- Use a single contextual **Explore examples** ending action. No provider-submission form, contact form, safeguarding pledge or made-up support channel.

## Original scene production direction

Retain code-native SVG artwork. The existing garden composition is a starting asset, not a final crop for every screen.

- Garden: one student-sized figure kneels or leans to plant, another helps with a watering can or seed tray. Both have complete limbs and clear hand/tool relationships. Keep the work surface at a plausible height and remove visually detached arm shapes. A raised bed and a planted foreground establish the activity immediately.
- Pantry: shelves, cartons and one packing action. Make the hand/box relationship visible; reduce skyline decoration that could confuse an indoor activity.
- Reading: an open book, reading materials, desk lamp and a chair or human hand can establish preparation. Avoid representing a live call or real child being tutored.
- Use a common horizon height, navy shapes, ocean/teal middle tones, warm skin/clothing highlights and occasional coral. Add subtle curved contour lines only where they describe a body, leaf or object. Avoid gratuitous texture, noise overlays, pseudo-3D glow and decorative confetti.
- Art has generous quiet sky for text at desktop and a separately positioned activity grouping for phone. Use viewBox/composition variants when required; avoid negative-margin crops that discard the important action.
- SVG titles/labels describe the depicted activity; repeated decorative crops use empty alternative text/`aria-hidden` where adjacent text already conveys their purpose. Keep the primary homepage illustration meaningful and accessible.
- These scenes are illustrative fiction. Do not label them as photos, real events, students, partners or test evidence.

## Actual Magic UI and motion contract

Use the two existing, attributed Magic UI components. No registry installer, new animation library or extra dependency is needed for this design.

1. **GridPattern:** a very faint static pattern confined to the process/checklist area. It describes an organized comparison surface; it should disappear if it competes with text. No animated/flickering grid behind the hero.
2. **ShimmerButton:** reserve for **Add to example shortlist** on the detail page. Preserve native button semantics and accessible label. A subtle perimeter pass may run on hover/focus; pause it when idle instead of repeating forever. The added state is calm and static. The homepage route CTA stays an ordinary link styled as a button.
3. **Entrance:** the hero scene and text can settle over about 280–420ms with a 6–10px translation. Base CSS must leave content visible if scripts or animation fail. Do not animate the headline word by word.
4. **Selection:** list rows update immediately; a 120–180ms surface/border transition shows which control changed. Never fade the complete result list to zero or reset scroll on every filter.
5. **Hover/focus:** a small arrow shift or underline change clarifies route links. Do not lift whole content sections or use zoom effects on people.

With `prefers-reduced-motion: reduce`, remove transforms, smooth scrolling, shimmer and transitions. All interaction feedback still uses text, shape and state. Motion is limited to the areas that explain a change; no idle floating figures, continuous parallax or decorative scroll hijacking.

## Anti-slop review gates

- The homepage demonstrates an actual example by its second section; it does not spend multiple screens praising the product.
- There is one dominant action in a decision area. Header/footer navigation is quieter. Repeated words such as “curiosity”, “journey”, “possibility” and “future” do not become section fillers.
- No decorative score or badge stands in for an explanation. No large numeral implies users, places, hours, partners or inventory.
- Illustration is about planting, packing or reading. It does not become a generalized happy-people collage.
- No glass panels, gradient glow, bento grid, orbital cards, marquee, logo cloud or testimonial placeholders.
- No paragraph explaining implementation details in the student journey. Preview limits are short and describe what the visitor can and cannot do.
- Remove any section that repeats the purpose or next step of its neighbor. Remove any decorative shape that weakens the reading order.

## Acceptance evidence for the implementation pass

Capture actual before/after page screenshots separately from this goal. Label goals as goals and screenshots as observed screens. Verify these at 1440 × 900, 768 × 1024, 390 × 844 and 320 × 640, plus 200% zoom and reduced motion:

- Home: brand, activity, purpose and Explore action visible early; no split/cropped text; no material content appears only on animation.
- Every template: title, one useful next step, consistent shell and footer, no horizontal page overflow.
- Explore: keyboard-operable controls; category/format/scenario changes; result announcement; empty filter state; clear filters; back/forward.
- Details: each slug loads directly; facts remain legible; age and guardian conditions are separate; shortlist add/remove feedback; unknown slug route.
- Shortlist: empty and populated states, correct count, reload/reset behavior accurately disclosed, checklist and return path.
- Information pages: headings form a coherent outline; FAQs work with keyboard; no hidden important boundary; links resolve.
- Accessibility: focus visibly follows keyboard operation, tap targets at least 44px, body text contrast at least 4.5:1 and essential non-text controls at least 3:1 where applicable, no color-only status, no trapped focus.
- Online boundary: browser network activity shows no personal-data submission, analytics, application API, provider contact or local-admin request. Final deployed URL is tested independently of the development server.

The fresh browser reviewer should report concrete defects against these goals, then the implementation should be revised and recaptured before it is called final.
