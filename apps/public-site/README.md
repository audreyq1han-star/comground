# CommonGround public preview

An isolated, working public-site redesign. The original `index.html`, `brand.html`, and `mockup.html`, and the existing `apps/web` application are preserved. This app has its own Next configuration, TypeScript project, output directory, port, and declared dependency versions, and resolves the already installed dependencies from the repository root. No installation is needed in the prepared workspace.

## Run locally

From the repository root:

```sh
NEXT_TELEMETRY_DISABLED=1 node scripts/with-local-node.mjs node_modules/next/dist/bin/next build apps/public-site --webpack
NEXT_TELEMETRY_DISABLED=1 node scripts/with-local-node.mjs node_modules/next/dist/bin/next start apps/public-site --hostname 127.0.0.1 --port 3120
```

For local editing, use `next dev apps/public-site --hostname 127.0.0.1 --port 3120` with the same wrapper instead of `build`/`start`. Stop the production process before running development on that port. Its `.next` directory is separate from the main application.

Open **http://127.0.0.1:3120**. No account, database, runtime mode, credentials, source feeds, AI provider, email service, or API server is used. Every primary CTA goes to `#preview`. There are no forms, external links, external assets, analytics, persistence, or API mutations in this app. Selectors keep fictional values only in React memory. Responses and metadata request no indexing. This remains a local preview, not a deployment.

## Design and content

The direction is **A clear first step**: retain the original navy/ocean/teal/coral identity, give the welcome a strong typographic hierarchy and an original community-garden illustration, then use a solid starting line to connect **Facts → Check before joining → Next step**. One practical comparison area replaces repeated marketing card grids. The pantry and remote-reading illustrations are also original code-native SVG; none depicts a real program, person, organization, or partnership. The garden is an illustration, not evidence of an actual opportunity.

Content and brand decisions are documented in `../../docs/public-site-copy.md` and `../../docs/public-site-brand-audit.md`. High-school students, including those aged 18+, are the initial audience. The copy does not promise connected feeds, AI recommendations, attendance verification, school credit, vetted safety, or real enrollment. A visible boundary states that real minor enrollment is disabled. The former early-access form is replaced by a functioning in-page example, so no personal contact information is requested.

The interactive example compares the **entire** chosen age range. Ages 13–15 fail an activity with a minimum age of 14. An explicitly selected narrower 14–15 range can pass that age check, but cannot satisfy the separate guardian condition. The age-18+ high-school choice remains available. Example-age fit is not approval or a complete eligibility decision. Dates, access, supervision, credit, and organizer details still require confirmation. A native modal presents the same facts, checks, and next-step boundary, with Escape dismissal and focus return.

## Components and accessibility

Actual MIT-licensed **Magic UI ShimmerButton and GridPattern** source is adapted to ordinary CSS, with no dependency installer. See `vendor/README.md` for official-source provenance and `vendor/LICENSE.magicui.txt` for the retained notice. The restrained perimeter animation is used on the example-details action. The faint grid sits behind the starting-line steps. All motion stops under `prefers-reduced-motion`; important content is never hidden pending animation.

The page uses semantic landmarks, a skip link, one H1, real labeled controls, pressed state for activity selection, an atomic live status, visible focus, a native modal, native FAQ disclosures, local system fonts, and responsive text/facts. Its artwork has descriptive accessible names. These choices and the browser checks are useful evidence, not an accessibility certification.

## Verification and mockups

```sh
node scripts/with-local-node.mjs --experimental-strip-types --test apps/public-site/preview-model.test.ts
node scripts/with-local-node.mjs node_modules/typescript/bin/tsc -p apps/public-site/tsconfig.json --noEmit
PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs node scripts/with-local-node.mjs apps/public-site/browser-check.mjs
```

The browser script expects the built preview at port 3120. `PUBLIC_PREVIEW_URL` can select another localhost origin. `PLAYWRIGHT_BROWSER_PATH` can select an already installed Chromium executable; otherwise it uses installed Chrome. It never downloads a browser or package. It blocks external browser requests, records unexpected attempts, checks no non-GET requests occurred, and saves real browser captures under `output/playwright/` (ignored generated artifacts). The selected verified runtime in this workspace is the pre-existing Chrome headless shell 152; installed Chrome 154 produced screenshot tiling artifacts after viewport resizing, so it was not used for final captures.

Capture annotations:

- `desktop-hero-1440.png`: actual first screen; readable promise, original artwork, audience, and preview boundary.
- `desktop-1440.png`: actual full-page composition, not a fabricated screenshot.
- `mobile-hero-390.png`, `mobile-preview-390.png`, `mobile-390.png`: actual mobile welcome, interaction area, and full page.
- `mobile-320.png`, `tablet-768.png`: narrow-phone and tablet compositions.
- `example-details-1440.png`: native detail modal with the guardian requirement and no-booking boundary.
- `verification.json`: execution timestamp, checks passed, request count, console/page errors, and external-request count.

The supplied source and screenshots are review artifacts. No live user research, production usage, legal consent approval, real opportunity availability, or release readiness is inferred from them.
