# ADR-0003: Packaging, native modules and CI

Date: 2026-10-28 · Status: accepted (R1b)

## Context

R2 and R3 need SQLite (better-sqlite3) and image processing (sharp). Both are native code, and native code inside a packaged Electron app is the roadmap's biggest technical risk. We also need CI that blocks broken pull requests.

## Decision

- **Native modules without rebuilding.** better-sqlite3 13.0.3 and sharp 0.35.5 both ship prebuilt **Node-API** binaries. Node-API is ABI-stable, so the same binary works in Node (unit tests) and in Electron. We set `npmRebuild: false` and never compile native code. This also avoids the usual problem of keeping one build for Node and another for Electron.
- **npm 11 install scripts.** npm 11 blocks dependency install scripts unless `allowScripts` in package.json approves them. We deny better-sqlite3's (it would compile from source unnecessarily), electron-winstaller's (Windows only) and fsevents'. Electron 45 has no install script; it downloads its binary on first run.
- **electron-builder 26.18.0**, `dir` target only for now (an unsigned `.app` folder). DMG, signing and notarization come with the beta and need an Apple Developer ID (decision D10).
- **Electron fuses** set at package time: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`, app code only from an integrity-checked asar, no extra file:// privileges, cookie encryption on. An ad-hoc signature is reapplied so Apple Silicon will run it.
- **Only runtime packages ship.** React and the fonts are bundled by Vite, so they're devDependencies and stay out of the package. `dependencies` holds only what the main process loads at runtime (better-sqlite3, sharp, zod).
- **Packaged verification uses `--self-test`.** With the inspector fuse off, Playwright can't attach to a packaged app, and that's the point of the fuse. Instead the app has a self-test mode that exercises SQLite (foreign keys, a transaction, a join) and sharp (resize, re-encode) in memory, prints one JSON line and exits. `scripts/smoke-packaged.mjs` runs it, reads the fuses straight from the binary, confirms Node mode is refused, launches the app, and inspects `app.asar` for leaked source.
- **CI** (`.github/workflows/ci.yml`) runs on `macos-latest` for every PR and push to main: `npm ci` → lint → typecheck → unit → E2E → package → packaged smoke. Least-privilege token (`contents: read`), actions pinned to commit SHAs, and a newer push to the same branch cancels the older run.

## Consequences

- The `--self-test` flag exists in production builds. It reads no user data and makes no network calls; we keep it as a support diagnostic or remove it before the public release.
- The package is about 309 MB. better-sqlite3 ships prebuilds for every platform; trimming them is a later optimization, measured when it happens.
- The bundle ID `com.samanthaparas.nearmora.dev` is temporary. macOS ties permissions to it, so the final ID must be chosen before beta testers install anything.
- **Branch protection is not configured.** Recommended settings are in the R1b evidence note; the owner applies them.
