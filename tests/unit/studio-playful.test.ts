/**
 * Unit tests for playful Memory Studio layouts (S4a): caption text turned into outlines (fitted, anchored, characters
 * the font lacks left out), the shared drawing order, caption settings, the mask shapes, and what makes each playful
 * pair itself at every size: tilted cards, a film strip with holes, arches and circles.
 */

import { describe, expect, it } from 'vitest'
import { captionText, compose } from '../../src/shared/studio/compose'
import { FORMAT_IDS, FORMATS, type FormatId } from '../../src/shared/studio/formats'
import { layers } from '../../src/shared/studio/layers'
import { readParams } from '../../src/shared/studio/params'
import { arch, circle, torn } from '../../src/shared/studio/scene'
import { findTemplate } from '../../src/shared/studio/templates'
import { missingCharacters, textOutline } from '../../src/shared/studio/text'

// Every x, y pair in a path's data (enough for bounding boxes of the paths we make: M, L, Q, C, A end points).
function points(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const command of d.match(/[MLQCHVAZ][^MLQCHVAZ]*/gi) ?? []) {
    const n = (command.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number)
    const kind = command[0]!.toUpperCase()
    if (kind === 'A') for (let i = 5; i + 1 < n.length; i += 7) out.push([n[i]!, n[i + 1]!])
    else if (kind !== 'H' && kind !== 'V') for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!])
  }
  return out
}

const bounds = (pts: Array<[number, number]>) => ({
  left: Math.min(...pts.map((p) => p[0])),
  right: Math.max(...pts.map((p) => p[0])),
  top: Math.min(...pts.map((p) => p[1])),
  bottom: Math.max(...pts.map((p) => p[1])),
})

const make = (templateId: string, format: FormatId, params: Parameters<typeof compose>[0]['params'] = { v: 1 }) =>
  compose({ templateId, templateVersion: 1, format, params, photoCount: 2 })

describe('caption text', () => {
  it('is turned into outlines, anchored at the start, middle or end of its baseline', () => {
    const start = bounds(points(textOutline('then and now', 60, 2000, 'start').d))
    const middle = bounds(points(textOutline('then and now', 60, 2000, 'middle').d))
    const end = bounds(points(textOutline('then and now', 60, 2000, 'end').d))
    expect(start.left).toBeGreaterThanOrEqual(-1)
    // Centred on x = 0 by the text's advance width; letters' side spacing makes the ink a few pixels off.
    expect(Math.abs(middle.left + middle.right)).toBeLessThan(20)
    expect(end.right).toBeLessThanOrEqual(10) // a final letter may reach a little past its advance
    expect(start.bottom).toBeLessThan(25) // the baseline is y = 0 (only descenders go below)
  })

  it('shrinks to fit its width, and leaves out characters the font can’t draw', () => {
    const long = textOutline('A long caption that would never fit in a small space', 60, 300, 'start')
    expect(long.size).toBeLessThan(60)
    const box = bounds(points(long.d))
    expect(box.right - box.left).toBeLessThanOrEqual(301)
    expect(missingCharacters('then ♡ now, café — 😀')).toEqual(['♡', '😀'])
    expect(textOutline('then ♡ now', 60, 2000, 'start').d).toBe(textOutline('then  now', 60, 2000, 'start').d)
  })

  it('takes the template’s words until the person changes them; an empty caption is drawn as nothing', () => {
    const postcards = findTemplate('pair-postcards', 1)!
    expect(captionText(postcards, { v: 1 })('caption')).toBe('Good food, happier people')
    expect(captionText(postcards, { v: 1, text: { caption: 'Lisbon, June' } })('caption')).toBe('Lisbon, June')
    const blank = layers(make('pair-postcards', 'square', { v: 1, text: { caption: '' } }), 0)
    const words = layers(make('pair-postcards', 'square'), 0)
    expect(words.length - blank.length).toBe(1)
  })

  it('caption settings are checked: short ids, at most 160 characters (line breaks allowed)', () => {
    expect(readParams({ v: 1, text: { caption: 'Same brunch\nDifferent adventure' } })).toBeTruthy()
    expect(() => readParams({ v: 1, text: { caption: 'x'.repeat(161) } })).toThrow()
    expect(() => readParams({ v: 1, text: { 'Not an id': 'x' } })).toThrow()
  })
})

describe('captions that wrap (S4b)', () => {
  const lineWidth = (line: string) => bounds(points(textOutline(line, 60, 5000, 'start').d))

  it('breaks lines where the person typed them, and between words to fit the width', () => {
    expect(textOutline('Same brunch\nDifferent adventure', 60, 5000, 'start', 3).lines).toEqual(['Same brunch', 'Different adventure'])
    const wrapped = textOutline('Good food and happier people all summer long', 60, 420, 'start', 4)
    expect(wrapped.lines.length).toBeGreaterThan(1)
    expect(wrapped.lines.join(' ')).toBe('Good food and happier people all summer long') // nothing lost or reordered
    for (const line of wrapped.lines) {
      const box = lineWidth(line)
      expect(box.right - box.left).toBeLessThanOrEqual(421)
    }
  })

  it('puts each line one line-height below the last', () => {
    const two = bounds(points(textOutline('then\nnow', 60, 5000, 'start', 2).d))
    const one = bounds(points(textOutline('then', 60, 5000, 'start', 1).d))
    expect(two.bottom - one.bottom).toBeGreaterThan(60 * 1.2 * 0.8) // the second line sits about 72 px lower
  })

  it('shrinks text that would need too many lines, then ends with an ellipsis rather than overflowing', () => {
    const shrunk = textOutline('Good food, happier people', 60, 400, 'start', 1)
    expect(shrunk.size).toBeLessThan(60)
    expect(shrunk.lines).toHaveLength(1)
    const long = textOutline('one two three four five six seven eight nine ten eleven twelve thirteen fourteen', 60, 300, 'start', 2)
    expect(long.size).toBeCloseTo(36, 6) // 60% of the size asked for, the smallest it goes
    expect(long.lines).toHaveLength(2)
    expect(long.lines[1]!.endsWith('…')).toBe(true)
  })

  it('splits a single word too long for the line between letters', () => {
    const word = textOutline('Supercalifragilisticexpialidocious', 60, 200, 'start', 6)
    expect(word.lines.length).toBeGreaterThan(1)
    expect(word.lines.join('')).toBe('Supercalifragilisticexpialidocious')
  })

  it('a two-line caption on Postcards stays on the canvas at every size', () => {
    for (const format of FORMAT_IDS) {
      const { width, height, over } = make('pair-postcards', format, { v: 1, text: { caption: 'A long summer of good food\nand happier people' } })
      const caption = over.find((d) => d.type === 'text')!
      if (caption.type !== 'text') continue
      const outline = textOutline(caption.text, caption.size, caption.maxWidth, caption.align, caption.maxLines)
      expect(outline.lines).toHaveLength(2)
      const t = (caption.at.rotate * Math.PI) / 180
      const placed = points(outline.d).map(([x, y]): [number, number] => [caption.at.x + x * Math.cos(t) - y * Math.sin(t), caption.at.y + x * Math.sin(t) + y * Math.cos(t)])
      const box = bounds(placed)
      expect([box.left >= 0, box.right <= width, box.top >= 0, box.bottom <= height], format).toEqual([true, true, true, true])
    }
  })
})

describe('drawing order', () => {
  it('draws shapes under the photos, then the photos, then art and captions over them', () => {
    const order = layers(make('pair-film-night', 'portrait'), 0).map((l) => l.kind)
    expect(order).toEqual(['shape', 'photo', 'photo'])
    const postcards = layers(make('pair-postcards', 'portrait'), 0).map((l) => l.kind)
    expect(postcards.slice(0, 2)).toEqual(['photo', 'photo'])
    expect(postcards.slice(2).every((k) => k === 'shape')).toBe(true) // caption and postmark on top
  })
})

describe('mask shapes', () => {
  it('an arch and a circle stay inside their rectangle', () => {
    const rect = { x: 100, y: 50, width: 300, height: 500 }
    for (const d of [arch(rect), circle(rect)]) {
      const box = bounds(points(d))
      expect(box.left).toBeGreaterThanOrEqual(100)
      expect(box.right).toBeLessThanOrEqual(400)
      expect(box.top).toBeGreaterThanOrEqual(50)
      expect(box.bottom).toBeLessThanOrEqual(550)
    }
  })
})

describe('torn edges', () => {
  it('tear the same way every time for the same seed, and differently for another', () => {
    const rect = { x: 0, y: 0, width: 400, height: 300 }
    expect(torn(rect, 7, 10, 20)).toBe(torn(rect, 7, 10, 20))
    expect(torn(rect, 7, 10, 20)).not.toBe(torn(rect, 8, 10, 20))
  })
})

describe('each playful pair keeps its character at every size', () => {
  it.each(FORMAT_IDS)('%s', (format) => {
    const { width, height } = FORMATS[format]

    // Postcards: two tilted photos in opposite directions on white cards; the caption stays on the canvas.
    const postcards = make('pair-postcards', format)
    expect(postcards.elements.map((e) => Math.sign(e.rotation))).toEqual([-1, 1])
    expect(postcards.elements.every((e) => e.frame?.color === '#ffffff' && e.frame.pad > 0 && !e.mask)).toBe(true)
    const caption = postcards.over.find((d) => d.type === 'text')!
    expect(caption.type === 'text' && caption.text).toBe('Good food, happier people')
    if (caption.type === 'text') {
      const outline = textOutline(caption.text, caption.size, caption.maxWidth, caption.align, caption.maxLines)
      const t = (caption.at.rotate * Math.PI) / 180
      const placed = points(outline.d).map(([x, y]): [number, number] => [caption.at.x + x * Math.cos(t) - y * Math.sin(t), caption.at.y + x * Math.sin(t) + y * Math.cos(t)])
      const box = bounds(placed)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(width)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.bottom).toBeLessThanOrEqual(height)
    }

    // Film night: a strip with holes cut through it (even-odd), both frames inside it, side by side or stacked.
    const film = make('pair-film-night', format)
    const strip = film.under[0]!
    expect(strip.type === 'shape' && strip.fillRule).toBe('evenodd')
    if (strip.type === 'shape') {
      expect((strip.d.match(/M/g) ?? []).length).toBeGreaterThan(8) // the strip plus its sprocket holes
      const box = bounds(points(strip.d))
      for (const e of film.elements) {
        expect(e.rect.x).toBeGreaterThan(box.left)
        expect(e.rect.x + e.rect.width).toBeLessThan(box.right)
        expect(e.rect.y).toBeGreaterThan(box.top)
        expect(e.rect.y + e.rect.height).toBeLessThan(box.bottom)
      }
    }

    // Window light: two arches the same size, taller than wide, each outlined.
    const windows = make('pair-window-light', format)
    const [a, b] = windows.elements
    expect(a!.mask).toBe(arch(a!.rect))
    expect([b!.rect.width, b!.rect.height]).toEqual([a!.rect.width, a!.rect.height])
    expect(a!.rect.height).toBeGreaterThan(a!.rect.width)
    expect(windows.under.filter((d) => d.type === 'shape' && d.stroke)).toHaveLength(2)

    // Torn pages: each photo cut to a torn edge inside its rectangle, on a larger torn white sheet; blush by default.
    const tornPages = make('pair-torn-pages', format)
    expect(tornPages.background).toBe('#e8b7b0')
    for (const e of tornPages.elements) {
      const box = bounds(points(e.mask!))
      // Path numbers are rounded to hundredths of a pixel, so a point on the edge may read 0.005 px outside.
      const e2 = 0.01
      expect([box.left >= e.rect.x - e2, box.right <= e.rect.x + e.rect.width + e2, box.top >= e.rect.y - e2, box.bottom <= e.rect.y + e.rect.height + e2]).toEqual([true, true, true, true])
    }
    expect(tornPages.under.filter((d) => d.type === 'shape' && d.fill === '#ffffff')).toHaveLength(2)

    // Love letter: a note of up to four lines, wrapped; both photos on the sheet.
    const letter = make('pair-love-letter', format)
    const note = letter.over.find((d) => d.type === 'text')!
    expect(note.type === 'text' && [note.text, note.maxLines]).toEqual(['Same brunch\nDifferent adventure', 4])
    expect(letter.elements.every((e) => e.frame !== null && e.rotation === 0)).toBe(true)

    // Colorblock: two see-through colour blocks under two upright framed photos.
    const blocks = make('pair-colorblock', format)
    expect(blocks.under.map((d) => d.type === 'shape' && [d.fill, d.opacity! < 1])).toEqual([['#b9a4c8', true], ['#b8bda6', true]])
    expect(blocks.elements.every((e) => e.rotation === 0 && e.frame)).toBe(true)

    // Scrapbook: tilted cards, each with a strip of see-through tape.
    const scrap = make('pair-scrapbook', format)
    expect(scrap.elements.map((e) => e.rotation)).toEqual([-3, 4])
    expect(scrap.over.filter((d) => d.type === 'shape' && d.opacity === 0.85)).toHaveLength(2)

    // Then + now: two photos the same size side by side, each with its own label.
    const thenNow = make('pair-then-now', format)
    const [first, second] = thenNow.elements
    expect([second!.rect.width, second!.rect.height]).toEqual([first!.rect.width, first!.rect.height])
    expect(second!.rect.y).toBe(first!.rect.y)
    expect(thenNow.over.filter((d) => d.type === 'text').map((d) => d.type === 'text' && d.text)).toEqual(['then', 'now'])

    // Gallery ticket: sage by default, photos inside the ticket, a title and a note.
    const ticketLayout = make('pair-gallery-ticket', format)
    expect(ticketLayout.background).toBe('#b8bda6')
    const outline = bounds(points((ticketLayout.under[0] as { d: string }).d))
    for (const e of ticketLayout.elements) {
      expect(e.rect.x).toBeGreaterThan(outline.left)
      expect(e.rect.x + e.rect.width).toBeLessThan(outline.right)
    }
    expect(ticketLayout.over.filter((d) => d.type === 'text')).toHaveLength(2)

    // Circle story: two circles, the second about 62% the size of the first.
    const circles = make('pair-circle-story', format)
    const [big, small] = circles.elements
    expect(big!.mask).toBe(circle(big!.rect))
    expect(small!.rect.width / big!.rect.width).toBeCloseTo(0.62, 6)
  })
})
