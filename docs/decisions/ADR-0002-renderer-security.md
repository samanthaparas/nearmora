# ADR-0002: Renderer security boundary

Date: 2026-10-28 · Status: accepted

## Context

The renderer will display untrusted data: filenames, EXIF text and decoded images. If a bug ever lets a page run injected script, that script must not be able to touch the filesystem, run commands or send photos anywhere.

## Decision

| Layer | What we do | Where |
|---|---|---|
| Process | `app.enableSandbox()`; every window has `sandbox`, `contextIsolation`, no `nodeIntegration`, no `webviewTag` | `src/main/index.ts` |
| Loading | UI served from `app://nearmora` via `protocol.handle`, never `file://`. Only allow-listed file types are served, and paths can't escape `out/renderer` | `src/main/security/app-protocol.ts`, `renderer-files.ts` |
| CSP | Production: `default-src 'none'`, `script-src 'self'`, `connect-src 'none'`, no `unsafe-*`. A looser policy applies only to the Vite dev server | `src/main/security/policy.ts` |
| Navigation | `will-navigate`/`will-redirect` blocked unless the target is our own origin; `window.open` denied; webviews blocked | `src/main/security/harden.ts` |
| Permissions | Every permission request and check is denied (camera, microphone, notifications, location, devices) | `harden.ts` |
| IPC | Preload exposes a frozen object of named functions, never `ipcRenderer`. Each call passes through `createRouter`: trusted sender → known command → Zod-valid input → handler → Zod-valid output. Errors cross the bridge as codes only | `src/preload/index.ts`, `src/main/ipc/` |

## Consequences

- Adding a capability means adding a schema to `src/shared/ipc-contract.ts`, a handler (the compiler enforces this) and a named preload method.
- `URL.origin` is `"null"` for custom schemes, so trust checks compare scheme + host.
- Electron Fuses, code signing and packaged-app checks come in R1b.
