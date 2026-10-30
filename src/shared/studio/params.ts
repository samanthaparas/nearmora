/**
 * A project's own settings on top of its template (background, margin, gutter). Stored as versioned JSON and
 * checked with this schema whenever it is written or read, so a damaged or unknown value never reaches the drawing code.
 * Only settings the person changed are stored; everything else comes from the template's defaults.
 */

import { z } from 'zod'

/** Bump when the stored shape changes, and teach `readParams` to upgrade the older shape. */
export const PARAMS_VERSION = 1

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Colours are stored as #rrggbb')

// Margins and gutters are in "reference pixels": pixels on a canvas whose shorter side is 1080. They scale with the
// canvas, so the same setting looks the same at social and print sizes.
export const ParamsSchema = z
  .object({
    v: z.literal(PARAMS_VERSION),
    background: hexColor.optional(),
    margin: z.number().min(0).max(300).optional(),
    gutter: z.number().min(0).max(300).optional(),
  })
  .strict()
export type Params = z.infer<typeof ParamsSchema>

/** Settings with every value filled in, in reference pixels. */
export interface ResolvedParams {
  background: string
  margin: number
  gutter: number
}

/** The two background colours offered so far; S2 adds a free colour choice. */
export const BACKGROUNDS = { cream: '#f8f0e8', white: '#ffffff' } as const

export const DEFAULT_PARAMS: Params = { v: PARAMS_VERSION }

/** Reads stored settings. Anything that isn't a valid version-1 object is refused rather than guessed at. */
export function readParams(value: unknown): Params {
  return ParamsSchema.parse(value)
}
