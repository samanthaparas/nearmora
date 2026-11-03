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
  /** SVG path data. The first line's baseline is at y = 0, each line anchored (start, middle or end) at x = 0. */
  d: string
  /** The size actually used: smaller than asked when the text needed it to fit. */
  size: number
  /** The lines as drawn, after wrapping (and an ellipsis if the text ran past its last line). */
  lines: string[]
}

/** Space between baselines, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2
// Text never shrinks below this share of the size asked for; past that it wraps, then ends with an ellipsis.
const SMALLEST = 0.6

// Breaks text into lines no wider than `maxWidth` at `size`: at the person's own line breaks, then between words.
// A single word wider than the line is split between letters.
function wrap(f: opentype.Font, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word
      if (f.getAdvanceWidth(candidate, size) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      // A word too long for any line is cut between letters.
      for (const letter of word) {
        if (line && f.getAdvanceWidth(line + letter, size) > maxWidth) {
          lines.push(line)
          line = ''
        }
        line += letter
      }
    }
    lines.push(line)
  }
  return lines
}

/**
 * The outline of a caption: wrapped to `maxWidth` across at most `maxLines` lines, each line anchored as asked.
 * If it doesn't fit, it first gets smaller (down to 60% of `size`), then the last line ends with an ellipsis.
 * Both the preview and the export draw this one result, so every line breaks in the same place in both.
 */
export function textOutline(words: string, size: number, maxWidth: number, align: Align, maxLines = 1): Outline {
  const f = font()
  // Characters the font can't draw are left out rather than shown as empty boxes (the editor names them).
  const text = [...words.replace(/\r/g, '')].filter((c) => c === '\n' || c.trim() === '' || f.charToGlyphIndex(c) !== 0).join('').trim()
  let fitted = size
  let lines = wrap(f, text, fitted, maxWidth)
  while (lines.length > maxLines && fitted > size * SMALLEST) {
    fitted = Math.max(size * SMALLEST, fitted * 0.92)
    lines = wrap(f, text, fitted, maxWidth)
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1]!
    while (last && f.getAdvanceWidth(`${last}…`, fitted) > maxWidth) last = last.slice(0, -1)
    kept[maxLines - 1] = `${last.trimEnd()}…`
    lines = kept
  }
  const d = lines
    .map((line, i) => {
      const width = f.getAdvanceWidth(line, fitted)
      const x = align === 'start' ? 0 : align === 'middle' ? -width / 2 : -width
      return f.getPath(line, x, i * fitted * LINE_HEIGHT, fitted).toPathData(2)
    })
    .join('')
  return { d, size: fitted, lines }
}

/** Characters the caption font can't draw (they would show as empty boxes), so the editor can say so. */
export function missingCharacters(text: string): string[] {
  const f = font()
  return [...new Set([...text].filter((c) => c.trim() !== '' && f.charToGlyphIndex(c) === 0))]
}
