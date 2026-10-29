# ADR-0013: Beta hardening, part 1

Date: 2026-10-29 · Status: accepted (R6 part 1)

## Context

R6 gets the MVP ready for a small beta:
- **Performance:** the blueprint's proposed budgets, measured rather than advertised.
- **AC9, privacy:** the packaged core workflow works with networking disabled; traffic inspection shows no photo, metadata or analytics requests; cache deletion and catalog removal behave as described.
- **AC10, access:** keyboard-only journeys and VoiceOver pass; 200% zoom, reduced motion, contrast and error announcements are verified.
- **The R4 debt:** a prompt when quitting with unsaved choices.

## Decision

- **Quit with unsaved picks:**
  - While a set has unsaved picks, the review screen registers a `beforeunload` objection.
  - Main handles `will-prevent-unload` with a native dialog: "Keep reviewing" (the default and the Escape choice) or "Quit without saving".
  - Saving from this dialog isn't offered, because the picks live in the page. Keeping reviewing lets the person save there.
- **Network evidence (AC9), in three layers:**
  - **Built app, end to end:** the whole core workflow (index, review, Studio, export) runs with every host name failing to resolve (`--host-resolver-rules=MAP * ~NOTFOUND`).
    - A request recorder must see a deliberate control request and nothing else.
    - `lsof` lists every socket of every app process. Only Playwright's own two loopback ports (identified as the ports the test process is connected to) are allowed.
    - **Control:** a test opens a real listener in main, and the check flags it.
  - **Packaged app, automated:**
    - `--self-test` (SQLite, sharp, catalog migrations, the media worker process) passes inside `sandbox-exec` with `(deny network*)`.
    - **Control:** the same sandbox stops perl from opening even a loopback socket.
    - The packaged window can't be launched inside `sandbox-exec`: Chromium refuses to start its own sandbox inside another one, so its GPU process exits. That was found by trying and is recorded.
  - **Packaged app, human:** the core workflow with Wi-Fi off, as part of the VoiceOver checklist.
- **Accessibility checks (AC10), automated:**
  - **axe-core 4.13.0** runs on all eight screens at 100% and 200% zoom (WCAG 2.0/2.1 A and AA).
  - It's injected through the test connection, which the app's CSP doesn't apply to; `@axe-core/playwright` needs to open new tabs, which Electron doesn't support.
  - At 200% no screen may scroll sideways (WCAG 1.4.10).
  - Reduced motion must zero transition and animation durations.
  - **Control:** axe must report an injected image without alt text and grey-on-white text.
  - **Found and fixed:** at 200% the project editor scrolled sideways by 63 px; the preview now shrinks to fit.
- **The human check (AC10):** `docs/evidence/r6/voiceover-checklist.md` takes the owner through every screen with VoiceOver, a keyboard-only journey, and the offline packaged run.
- **Settings:**
  - Shows the catalog, thumbnail and preview sizes.
  - **Clear previews** (made again on demand) and **Clear thumbnails** (connected folders are rescanned straight away; offline ones stay blank until reconnected).
  - Only files named exactly like Nearmora's cache (a 64-character SHA-256 plus `.webp`) are deleted.
  - States that the catalog isn't encrypted, recommending FileVault, and that the app never connects to the internet.
  - "Not built yet" screens no longer exist.
- **Performance** is measured by `npm run measure:perf` on a defined, generated 10,000-photo collection. The results and whether each budget was met are in the R6 evidence note.

## Consequences

- **The network proof for the packaged window is a manual step** (Wi-Fi off), because of Chromium's nested-sandbox limit.
- **Cache clearing has no size limit or automatic eviction yet.** The blueprint's "user-visible size setting" is partly met: sizes are visible and clearing is manual.
- **Automated accessibility passes are necessary but not sufficient.** AC10 stays open until the owner's VoiceOver checklist is done.
