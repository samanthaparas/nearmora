/**
 * Memory Studio canvas formats: the output size of each shape. Shared by the editor and the export, and stored on
 * each project by id. Labels describe the shape and intended use only; they make no claim about any platform's rules.
 */

export interface Format {
  label: string
  width: number
  height: number
}

// Starting presets. More shapes and print sizes are added in Studio phase S3 (see the Studio expansion plan).
export const FORMATS = {
  square: { label: 'Square', width: 1080, height: 1080 },
  portrait: { label: 'Portrait', width: 1080, height: 1350 },
  landscape: { label: 'Landscape', width: 1350, height: 1080 },
} as const satisfies Record<string, Format>

export type FormatId = keyof typeof FORMATS
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export const isFormatId = (value: string): value is FormatId => Object.hasOwn(FORMATS, value)

/** "Portrait (1080 × 1350)", as shown on screen. */
export const formatLabel = (id: FormatId): string => `${FORMATS[id].label} (${FORMATS[id].width} × ${FORMATS[id].height})`
