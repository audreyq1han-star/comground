> Historical slice record for checkpoint `ac5f7ee`. For the current full app, see `full-local-app-spec.md` and `verification.md`.

# Build-ready spec: local catalogue and matching slice

Authorized 17 October 2026 after the milestone mockups and architecture direction. Local implementation only, feature branch `feat/local-catalogue-matching`; preserve original root HTML assets and `main`. User explicitly authorized specs, subagent implementation and local testing in sequence, so further routine implementation approval is not required. A subsequent instruction authorizes a local checkpoint commit of the tested implementation, docs and tests. Feature-branch publication and a draft PR were subsequently authorized. Merges, deployment, paid services, real collection/outreach and provider calls remain outside this task.

## Objective and scope

One complete synthetic journey: operator selects a permitted fixture → validation → idempotent durable draft → explicit reviewed publication → anonymous catalogue/detail → temporary student preferences → deterministic hard-eligibility match with evidence-based template reasons. Demonstrate unknown/ineligible/expired/cancelled cases without presenting example listings as verified real opportunities or templates as AI.

Next.js 16.4.2, React 19.3.1, TypeScript strict. Installed Node 22.23.1 satisfies Next's >=20.9 requirement. Local persistence uses built-in `node:sqlite` (SQLite 3.51.3; experimental warning acknowledged). Future Supabase/Auth, ingestion schedules and OpenAI remain in the design, not this local build. No student accounts, persistent profiles, saves, notifications or outcomes yet.

## Structure and ownership

- `apps/web/app/`: Next routes/pages and UI. Frontend agent owns non-API pages, components and styles.
- `apps/web/app/api/`, `apps/web/lib/`: API handlers, ephemeral reviewer sessions and SQLite repository. Backend agent owns these.
- `packages/domain/contracts.ts`: shared contract, parent-owned; changes coordinated.
- `packages/domain/rules.ts`, `fixtures.ts`, `*.test.ts`: pure validation/eligibility/ranking and synthetic fixture factory. Domain agent owns these.
- `tests/`: parent integration/browser tests and evidence.
- `docs/`: spec, implementation plan, verification and actual screenshots.
- Parent owns package/config/scripts and final integration. No agent modifies another owner's files without coordination.

## Domain contract

See `packages/domain/contracts.ts`. Unknown eligibility facts are explicit nulls. ISO datetimes must parse and preserve UTC/timezone semantics. `availableFrom/Until` fully contains a candidate's start/end. Whole age band must qualify. For in-person events, a selected coarse area must match; this is not geocoding/travel-time computation. Mode, fee budget, training, guardian/supervision and requested school-credit approval are hard gates. Interest overlap ranks only eligible records. A missing or contradictory requirement returns NEEDS_CONFIRMATION, never ELIGIBLE.

Domain exports agreed before implementation:

```ts
parseFixture(input: unknown): FixtureRecord // throws DomainError
parsePreferences(input: unknown): Preferences // throws DomainError
publicationIssues(record: FixtureRecord, now: Date): string[]
isCurrent(record: FixtureRecord, now: Date): boolean
evaluateEligibility(record: FixtureRecord, preferences: Preferences, now: Date): EligibilityResult
rankMatches(opportunities: PublicOpportunity[], preferences: Preferences, now: Date): MatchResult[]
fixtureList(now?: Date): FixtureOption[]
```

`DomainError` exports `issues: string[]` and message. `parseFixture` rejects invalid structure/unsafe URLs/date order; incomplete eligibility fields may be null and remain review-blocked. No source string triggers code, tools, network or HTML rendering. `publicationIssues` checks approved fixture permission with evidence, confirmation/validity, cancellation and all required known facts. Same source ID/external ID plus identical content is idempotent; changed facts produce a new draft/version, never an unreviewed published edit.

## Repository interface

`createRepository(filename: string)` exports a repository with:

```ts
importRecord(record: FixtureRecord, now?: Date): { opportunity: AdminOpportunity; created: boolean; runId: string }
listReview(): AdminOpportunity[]
getAdmin(id: string): AdminOpportunity | null
review(id: string, input: ReviewInput, now?: Date): AdminOpportunity
listPublic(options?: { category?: string; limit?: number; offset?: number }, now?: Date): { data: PublicOpportunity[]; total: number }
getPublic(id: string, now?: Date): PublicOpportunity | null
close(): void
```

Repository throws a typed `RepositoryError(code,status,message)` for validation/conflicts/not found. Real SQLite constraints/transactions preserve source IDs, import runs and append-only review audit. Public DTO is explicit, with no permission evidence, reviewer reason, import diagnostics or secret. All public queries enforce PUBLISHED and `isCurrent` at read time. Production Supabase RLS is not claimed by local SQLite.

## HTTP contract

All responses are JSON; errors `{error:{code,message}}` with 400 malformed, 401 no reviewer session, 403 origin/host/session failure, 404 unavailable, 409 stale version, 422 invalid domain input, 413 oversized body. No stack traces or broad CORS.

| Route | Input / response | Access |
| --- | --- | --- |
| GET `/api/opportunities?category=&limit=20&offset=0` | `{data:PublicOpportunity[],total}`; limit1-50, nonnegative bounded offset | Anonymous; published/current only |
| GET `/api/opportunities/:id` | `{data:PublicOpportunity}` or404 | Anonymous; no existence leak for drafts |
| POST `/api/matches` | Preferences → `{data:MatchResult[],eligibleCount:number,engine:'DETERMINISTIC_RULES'}`; max3 returned | Anonymous local preview; preferences never persisted/logged |
| GET `/api/admin/session` | `{authenticated:boolean}` | Loopback host only |
| POST `/api/admin/session` | `{token:string}` → `{authenticated:true}` and short-lived HttpOnly SameSite=Strict session | Ephemeral process token; same-origin POST |
| DELETE `/api/admin/session` | Clear session | Same-origin |
| GET `/api/admin/fixtures` | `{data:{fixtureId,label}[]}` | Reviewer |
| POST `/api/admin/imports` | `{fixtureId:string}` → import result | Reviewer; allowlisted synthetic fixtures only |
| GET `/api/admin/opportunities` | `{data:AdminOpportunity[]}` | Reviewer |
| POST `/api/admin/reviews` | `{id,expectedVersion,decision:'PUBLISH'|'REJECT',reason}` → `{data:AdminOpportunity}` | Reviewer; audited transactional decision |

Suggested pages: `/opportunities`, `/opportunities/[id]`, `/matches`, `/admin` (includes operator login, fixtures, review queue). `/` is the local app's welcome/catalogue entry. Root static marketing files stay unchanged. No login/signup UI pretending to provide student accounts.

## Reviewer and privacy boundary

Parent start script generates an ephemeral `LOCAL_REVIEW_TOKEN` per process unless explicitly supplied for local tests; no credential file. Backend signs reviewer session cookie using that token, bounded lifetime, constant-time comparisons, HttpOnly and SameSite=Strict. Local server binds127.0.0.1. Mutations validate loopback Host and exact same Origin; reject cross-origin and missing Origin except deliberate test requests include it. Do not accept role from request body. Validate bounded JSON bodies (max32KiB) and fixture IDs. No real names, emails, DOB, student records or source requests.

## Commands and checkpoints

Parent adds: `npm install --ignore-scripts`; `npm run typecheck`; `npm test` (Node test runner with strip-types); `npm run build` (Next webpack); `npm run dev` (localhost:3100). Browser acceptance uses existing Playwright tooling or pinned runner, localhost only. Installation scripts are disabled; no remote scaffold generator.

1. Domain agent writes failing rule tests, implements, then runs its suite.
2. Backend agent writes repository/auth tests, implements, then verifies durable import/review/public-query behavior.
3. Frontend agent builds to the contract using real APIs. Parent integrates after API readiness.
4. Parent runs all tests, typecheck/build and browser flow; captures actual desktop/mobile screenshots and failure-state evidence.

## Acceptance matrix

- Import garden fixture twice → one draft/opportunity, separate observable import attempts allowed; no duplicate publish.
- Anonymous catalogue and guessed draft ID reveal no draft or review note.
- Unauthorized and cross-origin admin mutations fail; reviewer can approve only complete current permitted records.
- Missing age, revoked permission, cancelled/expired date and unsafe-link fixtures fail their intended gate.
- Stale expectedVersion gives409; material reimport returns to draft without unsafe public cache.
- Matching age16-17 sees eligible outdoors candidate; age14-15 cannot; missing requirements never become eligible; expired listings cannot rank.
- No-match state is actionable and honest. Changing preferences recomputes; no saved student data.
- Source/evidence links are synthetic `example.invalid` and visibly labeled. Official signup remains external and does not record an application.
- DOM text escapes fixture strings; no external fonts/assets/provider requests; keyboard labels/statuses work at390px and1440px without horizontal overflow.

## Boundaries and remaining work

Always validate inputs, use parameterized SQL, preserve original assets, label synthetic content and report actual test results. No deployment/commit/push or remote service calls. Supabase RLS, production auth, permitted adapters, realAI, saved activity, reminders, channel pages and outcome measurement remain future milestone work.
