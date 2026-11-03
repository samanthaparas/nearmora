/**
 * Memory Studio canvas formats: the output size of each shape, for sharing or for printing. Shared by the editor and
 * the export, and stored on each project by id. Labels describe the shape and intended use only; they make no claim
 * about any platform's or print service's current rules.
 */

export interface Format {
  label: string
  width: number
  height: number
  /** Sharing sizes are made for screens; print sizes are 300 pixels per inch at the size named. */
  use: 'share' | 'print'
}

/** Print sizes are worked out at this many output pixels per inch (8 in × 300 = 2400 px). */
export const PRINT_PPI = 300

export const FORMATS = {
  square: { label: 'Square', width: 1080, height: 1080, use: 'share' },
  portrait: { label: 'Portrait', width: 1080, height: 1350, use: 'share' },
  landscape: { label: 'Landscape', width: 1350, height: 1080, use: 'share' },
  vertical: { label: 'Vertical', width: 1080, height: 1920, use: 'share' },
  // About 1.91 : 1: a common wide shape for link previews and banners.
  wide: { label: 'Wide', width: 1200, height: 628, use: 'share' },
  'print-8x8': { label: 'Print 8 × 8 in', width: 2400, height: 2400, use: 'print' },
  'print-8x10': { label: 'Print 8 × 10 in', width: 2400, height: 3000, use: 'print' },
  'print-12x8': { label: 'Print 12 × 8 in', width: 3600, height: 2400, use: 'print' },
  'print-12x18': { label: 'Print 12 × 18 in', width: 3600, height: 5400, use: 'print' },
  'print-16x24': { label: 'Print 16 × 24 in', width: 4800, height: 7200, use: 'print' },
} as const satisfies Record<string, Format>

export type FormatId = keyof typeof FORMATS
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export const isFormatId = (value: string): value is FormatId => Object.hasOwn(FORMATS, value)

/** "Portrait (1080 × 1350)", as shown on screen. */
export const formatLabel = (id: FormatId): string => `${FORMATS[id].label} (${FORMATS[id].width} × ${FORMATS[id].height})`
