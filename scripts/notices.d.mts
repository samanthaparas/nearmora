/**
 * Types for scripts/notices.mjs, so the tests that import it are type-checked. The script itself stays plain
 * JavaScript, run directly by Node after the build.
 */

export type ShipsAs = 'bundled' | 'shipped' | 'runtime'

export interface Notice {
  name: string
  version: string
  license: string
  kind: ShipsAs
  text: string
}

export function licenceText(dir: string, name: string): string | null
export function collectNotices(packages: Map<string, ShipsAs>, root: string): { notices: Notice[]; missing: string[] }
export function shippedPackages(root: string): Map<string, ShipsAs>
