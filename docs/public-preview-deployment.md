# Public preview deployment

This feature branch prepares an isolated public demonstration under the existing Vercel GitHub integration. James authorized an online preview on 18 October 2026. The authenticated application remains local; this is not authorization to merge or deploy it.

## Export boundary

`apps/public-site/next.config.mjs` uses Next.js static export. `npm run build:public` builds only that application and audits the resulting files. Root `vercel.json` overrides framework detection, build, install and output-directory settings so only `apps/public-site/out` is served. The install command uses the committed lockfile and disables package lifecycle scripts. The export does not contain APIs, accounts, admin routes, databases or private configuration. No source feeds, email, AI provider, real enrollment, analytics or application forms are connected.

The static browser policy restricts connections and assets to this deployment, denies form submissions and embedding, and disables camera, microphone, location and payments. Inline scripts/styles remain allowed for Next's static bootstrap. Metadata and response headers request no indexing. Hosting infrastructure may retain ordinary request logs; the application does not collect personal details or maintain an account. Fictional choices stay in browser memory and reset on reload.

## Release process

The first sanitized code publication at `35364e3` disabled this feature branch's automatic deployments. After separate content/design review and two local implementation passes, candidate `773330e` passed 191 route/matrix/boundary checks and 24 journey checks. Branch deployment is now enabled only for this feature branch in the explicit configuration map. Other branch behavior is unchanged. The existing production branch is unchanged; do not use a main merge to obtain a preview URL. Deployment receipt and fresh online browser acceptance are still required before calling the preview online and verified.

Build with `NEXT_TELEMETRY_DISABLED=1 npm run build:public`. Run `npm run preview:public` for a loopback-only static server on port 3120; `PUBLIC_PREVIEW_PORT` can change the local port. This serves the exact exported files and response policy. No tunnel exposes the local application.

Deployment is verified from GitHub's Vercel check/deployment receipts and by a fresh browser session at the returned URL. Test desktop/phone routes, direct loads, back/forward navigation, shortlist reset, empty states, unknown routes, keyboard focus and reduced motion. Check that `/api`, `/admin` and `/account` are absent online. Capture actual screenshots and a new walkthrough from that deployment.

## Sources

- [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports): an HTML file per route and static assets in `out`; dynamic server features are unsupported.
- [Vercel file configuration](https://vercel.com/docs/project-configuration/vercel-json): build command, framework preset and output directory override project settings for a deployment.
- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration): branch-specific automatic deployment controls.

These documents describe platform behavior. Actual project permission, build and browser results are recorded separately; a configuration file alone is not evidence of successful deployment.
