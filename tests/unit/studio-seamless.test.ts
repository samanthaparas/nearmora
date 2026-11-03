/**
 * Unit tests for seamless carousels (S5a, ADR-0021): the remainder rule that cuts a design into slides whose widths
 * always add up, the cut positions the editor draws, the wide composition, and the notes for photos that meet a cut.
 */

import { describe, expect, it } from 'vitest'
import { compose, UnknownTemplateError, type Composition } from '../../src/shared/studio/compose'
import { FORMATS, type FormatId } from '../../src/shared/studio/formats'
import { cutPositions, seamNotes, sliceWidths } from '../../src/shared/studio/slices'
import { formatFor, formatsFor, latestTemplates } from '../../src/shared/studio/templates'

describe('cutting a design into slides', () => {
  it('gives whole-pixel slices that add up to the full width for every slide count, the first ones a pixel wider', () => {
    for (const width of [2, 1001, 1080, 2160, 3239, 3240, 3241, 21_601]) {
      for (let count = 1; count <= 20 && count <= width; count++) {
        const widths = sliceWidths(width, count)
        expect(widths).toHaveLength(count)
        expect(widths.reduce((a, b) => a + b, 0), `${width} into ${count}`).toBe(width)
        expect(widths.every(Number.isInteger)).toBe(true)
        // Never more than a pixel apart, and any wider ones come first.
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
        expect([...widths].sort((a, b) => b - a)).toEqual(widths)
      }
    }
    expect(sliceWidths(1001, 3)).toEqual([334, 334, 333])
    expect(sliceWidths(2160, 2)).toEqual([1080, 1080])
  })

  it('refuses a cut it can’t make exactly, rather than rounding', () => {
    expect(() => sliceWidths(1080.5, 2)).toThrow()
    expect(() => sliceWidths(2, 3)).toThrow()
    expect(() => sliceWidths(1080, 0)).toThrow()
  })

  it('puts each cut where one slice ends and the next begins', () => {
    expect(cutPositions(3240, 3)).toEqual([1080, 2160])
    expect(cutPositions(1001, 3)).toEqual([334, 668])
    expect(cutPositions(1080, 1)).toEqual([])
  })
})

const seamless = latestTemplates().filter((t) => t.mode === 'seamless')
const make = (templateId: string, format: FormatId, params: Parameters<typeof compose>[0]['params'] = { v: 1 }) => {
  const template = seamless.find((t) => t.id === templateId)!
  return compose({ templateId, templateVersion: template.version, format, params, photoCount: template.photos.min })
}

describe('seamless layouts', () => {
  it('are one wide design, as wide as all their slides, made at sharing shapes only', () => {
    expect(seamless.map((t) => [t.name, t.slides, t.photos.min])).toEqual([
      ['Across the seam', 2, 3],
      ['Story strip', 3, 5],
    ])
    for (const template of seamless) {
      expect(formatsFor(template)).toEqual(['square', 'portrait'])
      for (const format of formatsFor(template)) {
        const c = make(template.id, format)
        expect([c.width, c.height, c.canvasCount, c.slices, c.mode]).toEqual([FORMATS[format].width * template.slides!, FORMATS[format].height, 1, template.slides, 'seamless'])
      }
      expect(() => make(template.id, 'print-8x10')).toThrow(UnknownTemplateError)
      // Switching to it from a print size falls back to its first shape; an allowed size is kept.
      expect([formatFor(template, 'print-8x10'), formatFor(template, 'portrait')]).toEqual(['square', 'portrait'])
    }
  })

  it('Across the seam centres its large photo on the cut; Story strip runs a photo over each of its two cuts', () => {
    for (const format of ['square', 'portrait'] as const) {
      const across = make('seamless-across-the-seam', format)
      const middle = across.elements[1]!.rect
      expect(middle.x + middle.width / 2).toBeCloseTo(across.width / 2, 6)
      expect(seamNotes(across)).toEqual([{ slot: 1, kind: 'crosses', cut: 1 }])

      const strip = make('seamless-story-strip', format)
      expect(seamNotes(strip)).toEqual([
        { slot: 1, kind: 'crosses', cut: 1 },
        { slot: 3, kind: 'crosses', cut: 2 },
      ])
    }
  })

  it('keeps every photo on the design and apart from the others, whatever the spacing', () => {
    for (const template of seamless) {
      for (const params of [{ v: 1 as const }, { v: 1 as const, margin: 0, gutter: 0 }, { v: 1 as const, margin: 200, gutter: 200 }]) {
        const c = make(template.id, 'portrait', params)
        for (const [i, e] of c.elements.entries()) {
          expect(e.rect.x).toBeGreaterThanOrEqual(0)
          expect(e.rect.y).toBeGreaterThanOrEqual(0)
          expect(e.rect.x + e.rect.width).toBeLessThanOrEqual(c.width + 1e-9)
          expect(e.rect.y + e.rect.height).toBeLessThanOrEqual(c.height + 1e-9)
          expect(e.rect.width).toBeGreaterThan(0)
          for (const o of c.elements.slice(i + 1)) expect(e.rect.x + e.rect.width <= o.rect.x + 1e-9 || o.rect.x + o.rect.width <= e.rect.x + 1e-9).toBe(true)
        }
      }
    }
  })
})

describe('notes for photos that meet a cut', () => {
  // A two-slide design with one photo placed by hand, to check each case on its own.
  const withPhoto = (x: number, width: number): Composition => ({
    width: 2160,
    height: 1080,
    background: '#ffffff',
    mode: 'seamless',
    border: { width: 0, color: '#ffffff' },
    canvasCount: 1,
    slices: 2,
    elements: [{ id: 'photo-0', type: 'photo', slot: 0, canvas: 0, rect: { x, y: 0, width, height: 500 }, rotation: 0, mask: null, frame: null }],
    under: [],
    over: [],
  })

  it('names a photo running over a cut, and one whose edge sits within a few pixels of it, and nothing else', () => {
    expect(seamNotes(withPhoto(900, 400))).toEqual([{ slot: 0, kind: 'crosses', cut: 1 }])
    expect(seamNotes(withPhoto(600, 476))).toEqual([{ slot: 0, kind: 'near', cut: 1 }]) // right edge 4 px before the cut
    expect(seamNotes(withPhoto(1088, 300))).toEqual([{ slot: 0, kind: 'near', cut: 1 }]) // left edge 8 px after it
    expect(seamNotes(withPhoto(1100, 300))).toEqual([]) // 20 px clear
    expect(seamNotes({ ...withPhoto(900, 400), slices: 1, mode: 'single' })).toEqual([])
  })
})
