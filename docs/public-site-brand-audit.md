# CommonGround public-site brand audit

Source-based audit and direction packet · 17 October 2026

## Evidence and scope

Reviewed the visible text, semantic structure, palette declarations, typography, and selected layout rules in the original [index.html](../index.html) and [brand.html](../brand.html). The originals were read only. Form configuration, credentials, hidden input values, and scripts were excluded from the content extraction and are not reproduced here.

This audit is based on source inspection, not a rendered accessibility certification. A browser check of the new implementation remains necessary. The handoff copy is in [public-site-copy.md](public-site-copy.md); implementation is assigned to `apps/public-site` on local port 3120.

## What the original communicates

The original has a useful central idea: help high-school students find a first experience when they do not know where to begin. Its voice is encouraging, direct, and oriented toward interests rather than prestige. The blue, teal, navy, coral, and pale sky palette gives it warmth without feeling formal. The CommonGround name naturally supports community and shared participation.

The page currently turns that idea into a much wider promise: AI matching, internships, research, competitions, badges, avatars, reflections, skill summaries, and a growth portfolio. Percentage scores and example progress totals make the prototype look more mature than its present capabilities. “Free forever” and broad equity claims make commitments that the local implementation does not establish. The early-access form collects personal information instead of allowing the promise to be assessed through a contained preview.

The visual structure repeats several similar card grids: problems, categories, matches, features, impact, and badges. The centered hero uses a broad pastel gradient, a radial glow, a pulsing status dot, and a small simulated phone. These effects compete with the actual information a student needs: what the activity is, whether the requirements fit, and what remains to be checked. The phone's very small type is especially weak as the main evidence of usefulness.

## Continuity map

| Existing signal | Decision | Reason and visible consequence |
| --- | --- | --- |
| CommonGround name and high-school focus | Preserve | Keep the name prominent and identify the initial audience in the first screen. Include students aged 18+ without treating school stage as age. |
| Helpful, low-pressure invitation | Preserve | Lead with curiosity and a first step. Avoid pressure about falling behind, résumé competition, rankings, or status. |
| Ocean blue, teal, deep navy, coral | Evolve | Use navy and light surfaces for most of the page; reserve teal and coral for selected details and actions. Keep text contrast independent of decorative color. |
| A sunny, hopeful mood | Evolve | Use a simple horizon or shared-ground illustration instead of glow effects. Its role is to introduce place and possibility, not imply a real partner or activity. |
| “Find opportunities that fit you” | Evolve | Keep the idea of fit, but explain that requirements come first and the page is a fictional prelaunch preview. |
| Dense feature and badge grids | Depart | Give the page an editorial sequence with one useful interactive example area. Remove unsupported feature commitments. |
| Tiny simulated phone screen | Depart | Show readable activity facts at normal page scale. Make the evidence useful on mobile instead of nesting another small screen inside it. |
| Match percentages and skill/impact totals | Depart | Replace numeric persuasion with specific, inspectable reasons and requirements. Do not invent precision. |
| Early-access personal-data form | Depart | Use an in-page preview CTA. No form submission, marketing dependency, or contact collection is necessary. |

## Recommended direction: A clear first step

**Thesis:** Make CommonGround feel like a welcoming starting place where a student can understand the facts and choose a next step with confidence about what is known.

**Desired impression:** Open, grounded, and capable of explaining itself. The page should feel useful before it asks for trust.

**Composition:** Anchor the first screen with navy and ocean blue, a restrained horizon illustration, and a readable headline. A large wordmark can identify the space, but it must leave room for the audience, prelaunch status, and primary CTA. Release into a warm light background for the information. Use one dominant text column with aligned facts rather than filling every section with equal-size cards.

**Signature move:** A visible starting line runs from an activity title through three short stages: “Facts” → “Check before joining” → “Next step.” Reuse the same line and labels in the explanation and the interactive preview. The line expresses the product's purpose: turning a vague interest into a sequence of concrete questions. It should remain understandable without animation.

**Typography:** Keep a locally available sans-serif family; the original already uses the system stack. Prefer a strong but readable headline, with supporting text at 17–20 px and a short line length. Use 14–16 px for factual labels, requirements, and boundary text. Do not demote crucial status information to the original phone's 7–11 px scale. Keep paragraph line height generous and all essential copy as real text.

**Space:** Give the hero one clear action cluster. Allow a full pause before the sample choices. Within the sample area, align the age, time, fee, and requirement labels so they can be compared quickly. Use a three-column arrangement only when the content remains readable; stack in the same order on narrow screens. Avoid horizontal scrolling for core card facts.

**Shape:** Use modest corner rounding on controls and expanded sample details. Let rules, spacing, and headings organize the rest. Remove decorative floating panels, repeated pill containers, and unrelated icon colors.

**Image:** A vector horizon or community-ground illustration is appropriate because it can carry the palette without suggesting real people, places, organizations, or endorsements. Avoid stock photographs of identifiable students, medical placements, or school buildings that appear to document an actual program. Label all opportunity content as fictional regardless of image treatment.

**Motion:** A brief entrance or hover cue may clarify the next action. Preserve immediate visibility of important content, respect reduced motion, and keep interactive results readable without an animation. Remove the pulsing dot because it can imply an active service. No progress animation should imply that an application, review, or booking happened.

## Palette and contrast corrections

The original CSS pairs white button labels with ocean blue `#0284c7`, teal `#06c4b0`, and coral `#fb923c`. Relative-luminance calculations from those declared opaque colors give approximately 4.10:1, 2.20:1, and 2.26:1 respectively. These are source calculations, not measurements of a rendered gradient or translucent layer.

For ordinary text, the contrast target is at least 4.5:1; large text has a 3:1 minimum. Ratios should not be rounded upward to claim a pass. See the [W3C explanation of WCAG 2.2 contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Role | Recommended pairing | Approximate contrast |
| --- | --- | --- |
| Primary button | White on deep ocean `#0369a1` | 5.93:1 |
| Teal action or emphasis | Navy `#0e1f2e` on teal `#06c4b0` | 7.60:1 |
| Coral action or emphasis | Navy `#0e1f2e` on coral `#fb923c` | 7.40:1 |
| Body copy | Navy `#0e1f2e` on a light opaque surface | Use as the default; verify the actual chosen surface |
| Muted text | Darken the original slate on pale sky | Original `#64748b` on `#f0f9ff` is about 4.46:1; use a darker token |

Keep the original brighter ocean blue for illustration, large lettering, and accents where appropriate. Use opaque surfaces behind small text. Recheck each actual focus, hover, disabled, selected, error, and expanded state after implementation; these suggestions are not a declaration that the whole page passes accessibility requirements.

## Content hierarchy

1. **First screen:** High-school audience, useful promise, prelaunch status, and “Explore the preview.”
2. **The need:** The practical questions that come before applying.
3. **How it works:** Start with preferences, compare requirements, confirm the next step.
4. **Interactive examples:** Fictional choice controls, readable facts, and explanations when a requirement does not fit.
5. **Families, schools, organizers:** Clarify each party's role without implying approval, verification, or partnership.
6. **FAQ:** Real enrollment status, fictional listings, age and school-stage distinction, review limitations, school credit, and personal information.
7. **Final invitation:** Return to the same preview; avoid introducing a new commitment.

The principal action is `#preview`. It must not silently send a visitor to a separate account server, a live form, or an external signup. The implementation agent has chosen an isolated local preview with no backend dependency; any optional link to the broader app should be added only after its destination and behavior are confirmed.

## Claims to remove or qualify

| Original claim or device | New treatment |
| --- | --- |
| “AI recommends” and “AI-powered” | Explain the local prototype's requirement checks and preference-based reasons, with no public-site AI promise. |
| “92% fit” and similar scores | Present an explicit reason and the facts behind it. |
| “Every type of opportunity, in one place” | Focus the current story on volunteering and community activities; identify later categories as possibilities only in the FAQ. |
| “Free forever,” “100% free,” and “no paywalls” | Omit commitments about future pricing; the preview itself requires no signup. |
| Completed activity totals, growth themes, and badges | Remove unsupported proof of outcomes or usage. |
| “Levels the playing field” as a demonstrated impact | Express the aim of a clearer starting point without claiming measured social outcomes. |
| Guardian/school review | State that the existing workflow uses fictional data and does not verify legal authority or consent. |
| Credit, volunteering hours, safety, or suitability | Require separate confirmation with the school or organizer; never add a certification seal. |
| Contact, privacy, and launch CTAs | Use only working, accurately described destinations. No placeholder promises or dormant live form behavior. |

## Meaningful optional contrast: Student field guide

A more editorial alternative would use a predominantly light paper surface, compact navy headings, numbered notes, small blue diagrams, and the same starting-line device. The page would feel closer to a practical school handout than an immersive community scene. It would reduce the horizon illustration to a small section marker and let activity facts lead immediately.

Choose this alternative if quick scanning by families and school staff becomes the dominant goal or if there is no strong illustration available. Keep the recommended horizon direction for the current high-school-first introduction: it provides a more inviting opening while the information below supplies the practical detail. The contrast should come from composition and reading pace, not an unrelated palette, a different audience promise, or unsupported claims.

## Review checklist for the new implementation

- Does the first screen explain who the page is for and what the visitor can actually do?
- Can a visitor identify that the examples are fictional before interacting with them?
- Does each age result evaluate the full selected range, with any narrowing explicitly chosen?
- Do the activity details distinguish a guardian requirement from school-credit approval and from account review?
- Does removing the logo still leave the blue/navy palette, starting line, and fact-first sequence recognizable?
- Is the status readable at 320 px width and at increased text size?
- Can every control be used with a keyboard, with visible focus and understandable changes?
- Are animations optional and are all the important facts still present with reduced motion?
- Are forms, live endpoints, inherited credentials, third-party analytics, and external calls absent from this isolated preview?
- Are the final page, console, network activity, and accessible names checked in a real browser before delivery?
