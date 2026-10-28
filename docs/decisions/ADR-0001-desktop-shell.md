# ADR-0001: Desktop shell — Electron 45, electron-vite, strict TypeScript 6

Date: 2026-10-28 · Status: accepted (roadmap decisions D1, D4, D14)

## Context

Nearmora needs local filesystem access, a native folder picker and an offline-first UI built with React. The owner already knows React and Vite.

## Decision

- **Electron 45.1.0**: latest major, so it has the longest support window. If the R1b packaging spike finds native-module problems, we fall back to 44.10.0.
- **electron-vite 6.0.0** builds main, preload and renderer from one config on top of Vite 8.3.5.
- **TypeScript 6.0.3**, not 7.0.2: typescript-eslint 8.72.1 supports only `<6.1.0`. All strict flags are on, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Exact versions are pinned in `package.json`, and the lockfile is committed.

## Consequences

- Electron adds runtime size and its own security responsibilities (see ADR-0002).
- We revisit TypeScript 7 once typescript-eslint supports it.
- The renderer bundle isn't minified (electron-vite's default). That doesn't matter for a local app, and we'll check it again when packaging.
