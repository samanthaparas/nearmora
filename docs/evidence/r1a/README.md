# R1a evidence — secure shell

Date: 2026-10-28 · Machine: Apple Silicon (arm64), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real Electron app, built but not packaged · [pkg] packaged app · [human] manual check

| Gate item | Evidence | Label |
|---|---|---|
| Strict TypeScript compiles | `npm run typecheck` passes | [auto] |
| Unknown IPC command rejected | `tests/unit/ipc-router.test.ts`, including `__proto__` and `toString` | [auto] |
| Invalid payload rejected before the handler runs | same file | [auto] |
| Untrusted sender rejected | same file, plus `tests/unit/security-policy.test.ts` | [auto] |
| Handler errors and extra fields don't leak | same file | [auto] |
| Protocol refuses path traversal | unit tests (7 traversal forms) + E2E fetch | [auto] [int] |
| No Node.js in renderer; sandbox + isolation on | `e2e/security.spec.ts` | [int] |
| CSP blocks inline script and network | `e2e/security.spec.ts`. **Mutation-checked:** with the CSP header removed, both tests fail | [int] |
| Navigation, new windows, permissions denied | `e2e/security.spec.ts` | [int] |
| Fonts bundled, no runtime download | Fraunces Variable and Source Sans 3 Variable report `loaded` while `connect-src 'none'` is in force | [int] |
| Visual check at 1440×900 and 1024×768, focus ring visible | screenshots in this folder | [human] |

## Not yet covered

- Packaged/signed app behaviour (R1b).
- VoiceOver, 200% zoom and 1280×800 checks (R6 accessibility pass).
- Mutation checks for the navigation and permission guards (only the CSP tests were mutation-checked).
