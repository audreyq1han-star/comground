> Historical slice record for checkpoint `ac5f7ee`. For the current full app, see `full-local-app-spec.md` and `verification.md`.

# Local checkpoint review

Authorized 17 October 2026: preserve the tested local implementation in one local commit on `feat/local-catalogue-matching`. At that checkpoint no push, merge or deployment was authorized. Feature-branch publication and a draft PR were subsequently authorized; merge and deployment remain outside scope. Use `git log -1 --oneline` for the resulting checkpoint identity; the delivery archive manifest also records the full hash.

## Scope reviewed

The commit adds the Next app, pure domain package, local SQLite/API layer, local launcher, pinned dependency manifests/lockfile, implementation documentation and automated tests/evidence. Original `README.md`, `index.html`, `mockup.html`, `brand.html` and `.DS_Store` remain unchanged. Original `main` remains at `5109d51b7f26e71a3b75cb4bde100f91154a00a3`.

The staged paths were checked for secrets, credential-bearing URLs, environment files, databases, build output, installed dependencies and unrelated files. No actual secret or runtime token was found. The URL-credential scan identified only an intentional negative test using dummy credentials on `example.invalid`. Auth tests also contain explicitly synthetic test strings; these are not live credentials. Runtime reviewer tokens are generated in memory or supplied by the caller.

Excluded from the commit and source archive: `.git`, `.env*`, `.data`, SQLite files/WALs, `node_modules`, `.next`, browser-session logs, screenshots and generated report/archive files. The dependency lockfile is included intentionally. `next-env.d.ts` and the framework-generated `apps/web/AGENTS.md` are source/tooling metadata; compiled output stays excluded.

## Verification retained

- 19 unit/domain/repository/auth/original-asset tests passed, including 45 age-band combinations.
- 16 HTTP acceptance checks and 21 original browser checks passed.
- 10 additional production-build closeout checks passed, including empty/error/retry states, invalid dates, rejection, token rotation, graceful restart and abrupt process-termination recovery.
- Typecheck and production build passed after the final fix.
- The final fix clears stale operator cards and returns to sign-in on `INVALID_SESSION`; it was reproduced before the fix and verified afterward in `tests/closeout-e2e.mjs`.

The checkpoint changes only documentation since those passing checks. No application behavior was added during preservation.

## Archive and recovery boundaries

The source ZIP is an implementation overlay for the original repository at the baseline commit. It includes the files added by this checkpoint plus a manifest. Original marketing HTML, Git metadata, databases, tokens and installed dependencies are not copied into that archive. Overlay it on the original checkout to retain the original-asset tests, then install from the lockfile with scripts disabled.

The working directory remains a linked Git worktree. Its Git history depends on its original clone; keep that original clone. The local checkpoint protects committed source but is not a remote backup. SQLite remains local, unencrypted and without automatic backup; its contents are intentionally excluded from Git and both deliverable archives.
