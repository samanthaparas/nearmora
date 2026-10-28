# R1b evidence — CI and packaging spike

Date: 2026-10-28 · Machine: Apple Silicon (arm64), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] built app, not packaged · [pkg] packaged app · [ci] GitHub Actions · [human] manual check

| Gate item | Evidence | Label |
|---|---|---|
| Clean `npm ci` → lint → typecheck → unit → E2E → package → smoke passes | Run locally from a fresh git worktree with no `node_modules` | [auto] |
| Same sequence passes on GitHub's macOS runner | Passed on PR #2, [run 40789547854](https://github.com/samanthaparas/nearmora/actions/runs/40789547854) (2026-10-28): every step succeeded, 11/11 E2E tests and all 17 packaged checks passed | [ci] |
| ESLint type-aware rules work | A probe file with a floating promise, `any` and an empty async function produced 3 errors; the real code has 0 | [auto] |
| better-sqlite3 works in Electron | `--self-test` in the development build and in the packaged app: SQLite 3.53.4, foreign keys enforced, transaction, join | [int] [pkg] |
| sharp works in Electron | same self-test: libvips 8.18.7, resize and PNG re-encode | [int] [pkg] |
| Fuses set | `scripts/smoke-packaged.mjs` reads all 7 fuses from the binary | [pkg] |
| `ELECTRON_RUN_AS_NODE` refused | The packaged app ignores it. **Control:** the unfused development Electron binary does run as Node with the same command, so the check can fail | [pkg] |
| Packaged app launches without crashing | Still running after 6 s | [pkg] |
| No source, tests or docs shipped; UI-only packages not shipped | `app.asar` listing check. It initially caught React and the fonts being shipped, which was fixed | [pkg] |

Package size: 309 MB (`du -sh`, unsigned `.app`, arm64). Recorded as a baseline, not yet optimized.

## Recommended branch protection for `main` (owner to apply)

GitHub → Settings → Rules → Rulesets → New branch ruleset, targeting `main`:

- Require a pull request before merging (approvals: 0 is fine solo)
- Require status checks to pass: **Lint, typecheck, test and package (macOS)**
- Require branches to be up to date before merging
- Block force pushes and deletions
- Leave bypass empty, so these rules apply to admins too

## Not yet covered

- Signed and notarized build, and first-launch Gatekeeper behaviour (needs an Apple Developer ID).
- Windows packaging.
- Intel (x64) Macs: only arm64 was built.
