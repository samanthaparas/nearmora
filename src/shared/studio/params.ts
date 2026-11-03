/**
 * A project's own settings on top of its template (background, margin, gutter, photo border, caption words, and each
 * photo's own place, tilt, corners, flip, lock and visibility, with the layer order). Stored as versioned JSON and
 * checked with this schema whenever it is written or read, so a damaged or unknown value never reaches the drawing code.
 * Only settings the person changed are stored; everything else comes from the template's defaults.
 */

import { z } from 'zod'

/** Bump when the stored shape changes, and teach `readParams` to upgrade the older shape. */
export const PARAMS_VERSION = 1

/** The longest caption, in characters, line breaks included; each layout also limits how many lines it shows. */
export const MAX_CAPTION = 160

/** The widest photo border, in reference pixels. */
export const MAX_BORDER = 60

/** The roundest photo corner, in reference pixels. */
export const MAX_ROUNDING = 300

/** Most photos a layout holds (carousels take up to 10); edits and layer order are keyed by these positions. */
const MAX_SLOTS = 20

// A rectangle as fractions of the canvas (a little way off it is allowed), so it keeps its proportions at any size.
const fractionRect = z.object({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2), width: z.number().gt(0).max(2), height: z.number().gt(0).max(2) }).strict()

/**
 * The person's own changes to one photo's place (S6a, ADR-0022). A moved or resized place is stored as fractions of
 * the canvas, so it keeps its proportions if the size changes; everything not set comes from the layout.
 */
export const SlotEditSchema = z
  .object({
    rect: fractionRect.optional(),
    rotation: z.number().min(-180).max(180).optional(),
    rounding: z.number().min(0).max(MAX_ROUNDING).optional(),
    flip: z.literal(true).optional(),
    locked: z.literal(true).optional(),
    hidden: z.literal(true).optional(),
    // S6b: a place the person removed from the layout. It holds no photo and isn't drawn; it can be restored.
    removed: z.literal(true).optional(),
  })
  .strict()

/** Most places a person can add to a layout (S6b); a project still holds at most 10 places in all. */
export const MAX_EXTRA_PLACES = 8

export type SlotEdit = z.infer<typeof SlotEditSchema>

const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i, 'Colours are stored as #rrggbb')

// Margins and gutters are in "reference pixels": pixels on a canvas whose shorter side is 1080. They scale with the
// canvas, so the same setting looks the same at social and print sizes.
export const ParamsSchema = z
  .object({
    v: z.literal(PARAMS_VERSION),
    background: hexColor.optional(),
    margin: z.number().min(0).max(300).optional(),
    gutter: z.number().min(0).max(300).optional(),
    // A frame drawn around each photo, inside its place, so the layout's geometry never moves.
    borderWidth: z.number().min(0).max(MAX_BORDER).optional(),
    borderColor: hexColor.optional(),
    // Caption words by caption id (playful layouts), with any line breaks the person typed. An empty string removes it.
    text: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,19}$/), z.string().max(MAX_CAPTION)).optional(),
    // S6a: changes to each photo's place, by position ("0", "1", …), and the drawing order of positions, back to front.
    edits: z.record(z.string().regex(/^(0|[1-9][0-9]?)$/), SlotEditSchema).optional(),
    order: z.array(z.number().int().min(0).max(MAX_SLOTS - 1)).max(MAX_SLOTS).optional(),
    // S6b: places the person added, after the layout's own, as fractions of the canvas (collages and seamless designs).
    extra: z.array(fractionRect).max(MAX_EXTRA_PLACES).optional(),
  })
  .strict()
export type Params = z.infer<typeof ParamsSchema>

/** Settings with every value filled in, in reference pixels. */
export interface ResolvedParams {
  background: string
  margin: number
  gutter: number
  borderWidth: number
  borderColor: string
}

/** Named colours offered as one-click choices for the background and the border; any other colour can be picked too. */
export const BACKGROUNDS = { cream: '#f8f0e8', white: '#ffffff', sand: '#e6d8c6', blush: '#e8b7b0', sage: '#b8bda6', charcoal: '#2f2b2c' } as const
export const BORDER_COLORS = { white: '#ffffff', cream: '#f8f0e8', charcoal: '#2f2b2c' } as const

export const DEFAULT_PARAMS: Params = { v: PARAMS_VERSION }

/** Reads stored settings. Anything that isn't a valid version-1 object is refused rather than guessed at. */
export function readParams(value: unknown): Params {
  return ParamsSchema.parse(value)
}
