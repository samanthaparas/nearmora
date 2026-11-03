/**
 * Captions and labels for Memory Studio, turned into letter outlines (vector paths) with one bundled font. The preview
 * and the export both draw these outlines, so text lands in exactly the same place in both and never depends on
 * fonts installed on the computer (ADR-0017). Caveat is a handwriting font under the SIL Open Font License.
 */

import opentype from 'opentype.js'
import caveatData from '@fontsource/caveat/files/caveat-latin-500-normal.woff?inline'

export type Align = 'start' | 'middle' | 'end'

let caveat: opentype.Font | null = null

// The font arrives as a data: URL inside the bundle; it's decoded and parsed once, on first use.
function font(): opentype.Font {
  if (!caveat) {
    const bytes = Uint8Array.from(atob(caveatData.slice(caveatData.indexOf(',') + 1)), (c) => c.charCodeAt(0))
    caveat = opentype.parse(bytes.buffer)
  }
  return caveat
}

export interface Outline {
  /** SVG path data, with the text's baseline at y = 0 and its anchor (start, middle or end) at x = 0. */
  d: string
  /** The size actually used: smaller than asked when the text would be wider than its space. */
  size: number
}

/** The outline of one line of text at a size, shrunk to fit `maxWidth`, anchored as asked. */
export function textOutline(words: string, size: number, maxWidth: number, align: Align): Outline {
  const f = font()
  // Characters the font can't draw are left out rather than shown as empty boxes (the editor names them).
  const text = [...words].filter((c) => c.trim() === '' || f.charToGlyphIndex(c) !== 0).join('')
  const natural = f.getAdvanceWidth(text, size)
  const fitted = natural > maxWidth ? (size * maxWidth) / natural : size
  const width = f.getAdvanceWidth(text, fitted)
  const x = align === 'start' ? 0 : align === 'middle' ? -width / 2 : -width
  return { d: f.getPath(text, x, 0, fitted).toPathData(2), size: fitted }
}

/** Characters the caption font can't draw (they would show as empty boxes), so the editor can say so. */
export function missingCharacters(text: string): string[] {
  const f = font()
  return [...new Set([...text].filter((c) => c.trim() !== '' && f.charToGlyphIndex(c) === 0))]
}
