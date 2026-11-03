/**
 * Unit tests for Memory Studio compositions: every template's photo slots, at every format, stay inside the canvas,
 * don't overlap and keep the template's spacing; settings scale with the canvas; and stored settings are checked
 * against their schema. Preview and export both draw these numbers (AC7).
 */

import { describe, expect, it } from 'vitest'
import type { Rect } from '../../src/shared/layout'
import { compose, UnknownTemplateError, type PhotoElement } from '../../src/shared/studio/compose'
import { FORMAT_IDS, FORMATS } from '../../src/shared/studio/formats'
import { readParams } from '../../src/shared/studio/params'
import { latestTemplates, TEMPLATES, templatesFor } from '../../src/shared/studio/templates'

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width - 1e-9 && b.x < a.x + a.width - 1e-9 && a.y < b.y + b.height - 1e-9 && b.y < a.y + a.height - 1e-9

// The area a photo really takes: its card, if any, turned with it.
function footprint(e: PhotoElement): Rect {
  const pad = e.frame?.pad ?? 0
  const w = e.rect.width + 2 * pad
  const h = e.rect.height + 2 * pad
  const t = (Math.abs(e.rotation) * Math.PI) / 180
  const bw = w * Math.cos(t) + h * Math.sin(t)
  const bh = w * Math.sin(t) + h * Math.cos(t)
  return { x: e.rect.x + e.rect.width / 2 - bw / 2, y: e.rect.y + e.rect.height / 2 - bh / 2, width: bw, height: bh }
}

const circlesOverlap = (a: Rect, b: Rect) =>
  Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2)) < (a.width + b.width) / 2

describe('templates', () => {
  it('each template version is unique, and new projects start from the newest', () => {
    const keys = TEMPLATES.map((t) => `${t.id}@${t.version}`)
    expect(new Set(keys).size).toBe(keys.length)
    // The full everyday catalog: 8 pairs and 10 quartets, plus the carousel; all ten playful pairs (S4a, S4b) and all
    // ten playful quartets (S4c), each in the concept board's order.
    const ids = latestTemplates().map((t) => t.id)
    const everyday = latestTemplates().filter((t) => t.style !== 'playful').map((t) => t.id)
    expect(everyday.filter((id) => id.startsWith('pair-'))).toHaveLength(8)
    expect(everyday.filter((id) => id.startsWith('quartet-'))).toHaveLength(10)
    const playful = (count: number) => latestTemplates().filter((t) => t.style === 'playful' && t.photos.min === count).map((t) => t.name)
    expect(playful(2)).toEqual([
      'Postcards',
      'Film night',
      'Torn pages',
      'Window light',
      'Love letter',
      'Colorblock',
      'Scrapbook',
      'Then + now',
      'Circle story',
      'Gallery ticket',
    ])
    expect(playful(4)).toEqual([
      'Postcard stack',
      'Film weekend',
      'Torn journal',
      'Garden windows',
      'Love notes',
      'Color play',
      'Travel scrapbook',
      'Four seasons',
      'Circle collection',
      'Keepsake ticket',
    ])
    expect(ids).toContain('carousel-full')
    expect(new Set(latestTemplates().map((t) => t.name)).size).toBe(ids.length) // every name is distinct
  })

  it('offers only the templates that fit the number of photos selected', () => {
    expect(templatesFor(2).every((t) => t.id.startsWith('pair-') || t.id === 'carousel-full')).toBe(true)
    expect(templatesFor(2)).toHaveLength(19)
    expect(templatesFor(4).every((t) => t.id.startsWith('quartet-') || t.id === 'carousel-full')).toBe(true)
    expect(templatesFor(4)).toHaveLength(21)
    // Three and five photos: the carousel, and the seamless carousel that takes exactly that many (S5a).
    expect(templatesFor(3).map((t) => t.id)).toEqual(['carousel-full', 'seamless-across-the-seam'])
    expect(templatesFor(5).map((t) => t.id)).toEqual(['carousel-full', 'seamless-story-strip'])
    expect(templatesFor(1)).toEqual([])
  })

  // The acceptance rule: a two-photo template has exactly two independent slots, a four-photo template four.
  // Playful photos may be turned on cards or cut to circles: what must stay inside the canvas is the turned card, and
  // circles must not overlap as circles (their square rectangles may).
  it('every collage has exactly as many separate, non-overlapping slots as photos, inside the canvas, at every format', () => {
    for (const template of latestTemplates().filter((t) => t.mode === 'single')) {
      for (const format of FORMAT_IDS) {
        const photoCount = template.photos.min
        const { elements, width, height, canvasCount } = compose({ templateId: template.id, templateVersion: template.version, format, params: { v: 1 }, photoCount })
        expect(canvasCount).toBe(1)
        expect(elements.map((e) => e.slot)).toEqual(Array.from({ length: photoCount }, (_, i) => i))
        for (const [i, e] of elements.entries()) {
          const box = footprint(e)
          expect(box.x).toBeGreaterThanOrEqual(-1e-9)
          expect(box.y).toBeGreaterThanOrEqual(-1e-9)
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1e-9)
          expect(box.y + box.height).toBeLessThanOrEqual(height + 1e-9)
          for (const other of elements.slice(i + 1)) {
            const round = e.mask?.includes('A') && other.mask?.includes('A') && e.rect.width === e.rect.height && other.rect.width === other.rect.height
            expect(round ? circlesOverlap(e.rect, other.rect) : overlaps(e.rect, other.rect), `${template.id} at ${format}`).toBe(false)
          }
        }
      }
    }
  })
})

describe('each everyday layout keeps its character at every format', () => {
  const rects = (templateId: string, format: (typeof FORMAT_IDS)[number]) => {
    const template = latestTemplates().find((t) => t.id === templateId)!
    return compose({ templateId, templateVersion: template.version, format, params: { v: 1 }, photoCount: template.photos.min }).elements.map((e) => e.rect)
  }
  const area = (r: { width: number; height: number }) => r.width * r.height

  it.each(FORMAT_IDS)('%s', (format) => {
    const { width, height } = FORMATS[format]
    // Four across: portrait cells in one row. Four stories: wide strips in one column.
    for (const r of rects('quartet-four-across', format)) expect(r.width).toBeLessThan(r.height)
    expect(new Set(rects('quartet-four-across', format).map((r) => r.y)).size).toBe(1)
    for (const r of rects('quartet-four-stories', format)) expect(r.width / r.height).toBeGreaterThanOrEqual(2 - 1e-9)
    // Landscape pair: both at least 3:2 wide.
    for (const r of rects('pair-landscape-pair', format)) expect(r.width / r.height).toBeGreaterThanOrEqual(1.5 - 1e-9)
    // The lead photo is the largest; the detail is smaller than the main photo.
    for (const id of ['quartet-lead-three', 'quartet-top-story', 'pair-tall-detail']) {
      const [lead, ...rest] = rects(id, format)
      for (const r of rest) expect(area(lead!)).toBeGreaterThan(area(r))
    }
    // Full bleed and edge to edge: the photos cover the whole canvas exactly, no border.
    for (const id of ['pair-full-bleed', 'quartet-edge-to-edge']) expect(rects(id, format).reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(width * height, 6)
    // Offset layouts really are offset: the second column doesn't line up with the first.
    const offset = rects('quartet-offset-grid', format)
    expect(offset[2]!.y).toBeGreaterThan(offset[0]!.y)
    const pair = rects('pair-offset', format)
    expect(pair[1]!.x).toBeGreaterThan(pair[0]!.x)
    // Quiet columns: more space between the columns than between the rows.
    const quiet = rects('quartet-quiet-columns', format)
    expect(quiet[2]!.x - (quiet[0]!.x + quiet[0]!.width)).toBeGreaterThan(quiet[1]!.y - (quiet[0]!.y + quiet[0]!.height))
    // Mats: Quiet frame and Gallery mat leave a broader border than Stacked and Classic grid.
    expect(rects('pair-quiet-frame', format)[0]!.x).toBeGreaterThan(rects('pair-stacked', format)[0]!.x)
    expect(rects('quartet-gallery-mat', format)[0]!.x).toBeGreaterThan(rects('quartet-classic-grid', format)[0]!.x)
  })
})

describe('composing a project', () => {
  it('keeps Studio Lite’s layouts exactly: 48 px margin and 24 px gap on a 1080 square', () => {
    const grid = compose({ templateId: 'quartet-classic-grid', templateVersion: 1, format: 'square', params: { v: 1 }, photoCount: 4 })
    expect(grid.elements.map((e) => e.rect)).toEqual([
      { x: 48, y: 48, width: 480, height: 480 },
      { x: 552, y: 48, width: 480, height: 480 },
      { x: 48, y: 552, width: 480, height: 480 },
      { x: 552, y: 552, width: 480, height: 480 },
    ])
    expect(grid.background).toBe('#f8f0e8') // cream unless the person chose otherwise
  })

  it('stacks two photos one above the other, and scales spacing with the canvas', () => {
    const stacked = compose({ templateId: 'pair-stacked', templateVersion: 1, format: 'portrait', params: { v: 1 }, photoCount: 2 })
    expect(stacked.elements.map((e) => e.rect)).toEqual([
      { x: 48, y: 48, width: 984, height: 615 },
      { x: 48, y: 687, width: 984, height: 615 },
    ])
    // Spacing is set for a 1080 short side, so a person's 60 px margin stays proportionally the same on any canvas.
    const custom = compose({ templateId: 'pair-stacked', templateVersion: 1, format: 'landscape', params: { v: 1, margin: 60, gutter: 0, background: '#ffffff' }, photoCount: 2 })
    expect(custom.elements[0]!.rect).toMatchObject({ x: 60, y: 60, width: FORMATS.landscape.width - 120 })
    expect(custom.elements[1]!.rect.y).toBeCloseTo(custom.elements[0]!.rect.y + custom.elements[0]!.rect.height, 9) // no gutter
    expect(custom.background).toBe('#ffffff')
  })

  it('gives a carousel one full-canvas photo per slide, in order', () => {
    const slides = compose({ templateId: 'carousel-full', templateVersion: 1, format: 'portrait', params: { v: 1 }, photoCount: 3 })
    expect(slides).toMatchObject({ mode: 'carousel', canvasCount: 3 })
    expect(slides.elements.map((e) => [e.slot, e.canvas, e.rect])).toEqual([0, 1, 2].map((i) => [i, i, { x: 0, y: 0, width: 1080, height: 1350 }]))
  })

  it('refuses a template this version doesn’t know, rather than drawing something else', () => {
    expect(() => compose({ templateId: 'from-the-future', templateVersion: 1, format: 'square', params: { v: 1 }, photoCount: 2 })).toThrow(UnknownTemplateError)
    expect(() => compose({ templateId: 'pair-stacked', templateVersion: 99, format: 'square', params: { v: 1 }, photoCount: 2 })).toThrow(UnknownTemplateError)
  })
})

describe('stored settings', () => {
  it('accepts valid settings and refuses anything else: unknown keys, bad colours, out-of-range sizes, other versions', () => {
    expect(readParams({ v: 1, background: '#AABBCC', margin: 0, gutter: 300 })).toEqual({ v: 1, background: '#AABBCC', margin: 0, gutter: 300 })
    for (const bad of [{}, { v: 2 }, { v: 1, background: 'url(x)' }, { v: 1, margin: 301 }, { v: 1, gutter: -1 }, { v: 1, onload: 'x' }, null, 'v1']) {
      expect(() => readParams(bad)).toThrow()
    }
  })
})
