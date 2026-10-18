> Historical slice record for checkpoint `ac5f7ee`. For the current full app, see `full-local-app-spec.md` and `verification.md`.

# Local implementation order and ownership

1. Shared spec/contracts: parent. Complete before implementation delegation.
2. Domain: `rules.ts`, `fixtures.ts`, rule tests. Owner domain agent. Validate structure, publication requirements and eligibility before ranking. Synthetic fixtures cover valid, missing-age, expired, cancelled, no-permission and material-change cases.
3. Data/API: SQLite repository, session/HTTP guards, API routes, backend tests. Owner backend agent. Depend on contracts; coordinate exported functions with domain agent. No student persistence.
4. UI: local welcome/catalogue/detail/matches/operator pages, components/CSS. Owner frontend agent. Depend on HTTP contract; error/empty/loading/mobile states required. Use genuine APIs, not invented client-side publication.
5. Parent integration: pinned dependencies/config/scripts; typecheck, tests/build; browser E2E import→review→catalogue→match and negative cases; actual screenshots and verification notes.

No agent changes root index.html, mockup.html, brand.html, remote settings, commits, branches, deployment or another agent's owned files. Coordinate contract changes before editing. Parent resolves integration defects. Later milestone functionality remains a design artifact.

After verification, the user authorized the parent to create a local checkpoint commit of the implementation, docs and tests. This supersedes the earlier no-commit boundary for that checkpoint only; feature-branch publication and a draft PR were subsequently authorized. Merge and deployment remain outside scope.
