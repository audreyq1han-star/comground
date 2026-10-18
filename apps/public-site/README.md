# CommonGround public preview

An isolated public demonstration for high-school students: browse three fictional activities, inspect practical requirements, keep a temporary example shortlist and work through questions to ask before a real application. The original root site and the authenticated application in `apps/web` are separate from this static export.

## Run and build

Use the repository's reviewed, already installed dependencies. From the repository root:

```sh
NEXT_TELEMETRY_DISABLED=1 npm run build:public
npm run preview:public
```

Open `http://127.0.0.1:3120`. `PUBLIC_PREVIEW_PORT` changes the local port. The server serves the exact exported files and the configured response headers on loopback only. For editing, use `npm run dev --prefix apps/public-site`, after stopping any other server on that port. No development server is exposed online.

`build:public` uses Next static export and audits the output. Root `vercel.json` explicitly selects `apps/public-site/out`; no application API, account system, admin route, database, worker or server function belongs to that output. See [deployment boundary](../../docs/public-preview-deployment.md) for the existing-hosting release process. A successful local build alone is not deployment evidence.

## Journey and state

| Route | Purpose |
| --- | --- |
| `/` | Introduce the idea and show a concrete example |
| `/explore` | Filter three examples by activity type and participation format |
| `/explore/garden`, `/explore/pantry`, `/explore/reading` | Explain tasks, sample requirements and questions to check |
| `/shortlist` | Compare temporary choices, remove them and continue to the checklist |
| `/how-it-works` | Explain the preview and offer a practical checklist |
| `/for-families` | Provide family, school and organizer guidance |

All choices are fixed fictional examples. There are no personal-detail inputs, forms, accounts, applications, email subscriptions, analytics, external assets or provider connections. React context keeps choices across internal navigation and clears them on reload. The application does not use cookies, local storage or session storage. Hosting infrastructure may retain normal request logs.

The sample age comparison uses the entire range. Ages 13–15 fail a minimum age of 14; an explicitly chosen 14–15 sample can meet that age rule while the separate guardian requirement remains visible. An 18+ high-school sample is available. Age fit is not permission to participate, evidence of safety or a complete eligibility decision. An example shortlist is not an application or an attendance record.

## Content and design

The reviewed goal is a sunny community field guide with CommonGround's original sunrise/horizon mark and navy, ocean, teal and coral palette. Original SVG scenes illustrate planting, packing and reading preparation; they do not depict a real program or partnership. The homepage invites exploration; interior pages focus on the next task. No fictional testimonials, usage totals, partner logos, live-feed claims, AI claims or credit guarantees are used.

- [Full route inventory and copy packet](../../docs/public-journey-content.md)
- [Visual goal and responsive requirements](../../docs/public-preview-design-goal.md)
- [Independent content/design review](../../docs/public-preview-independent-review.md)

Actual MIT-licensed Magic UI `GridPattern` and `ShimmerButton` adaptations are retained. See [provenance](vendor/README.md) and [license](vendor/LICENSE.magicui.txt). Motion is restrained and disabled under reduced-motion preferences. Native links, labeled controls, one H1 per route, skip navigation, visible focus and useful empty states are part of the design; browser evidence is required to verify their implementation.

## Verification

```sh
node scripts/with-local-node.mjs node_modules/typescript/bin/tsc -p apps/public-site/tsconfig.json --noEmit
node scripts/with-local-node.mjs --experimental-strip-types --test apps/public-site/preview-model.test.ts tests/public-preview-boundary.test.ts
npm run build:public
```

The independent browser review covers real local and deployed routes at desktop, tablet and phone widths, direct loads, back/forward, filters, age/guardian explanations, shortlist changes/reset, unknown routes, keyboard operation, reduced motion, request methods and storage. Final screenshots and walkthroughs are generated outside the repository. Earlier captures under `output/playwright` and `browser-check.mjs` describe the previous single-page preview and are historical evidence, not validation of the revised route journey.

This preview does not establish live opportunity availability, user research, legal consent approval, safeguarding readiness or production enrollment readiness. The authenticated application's separate tests and operational gates remain in force.
