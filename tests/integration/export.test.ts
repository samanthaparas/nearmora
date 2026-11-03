/**
 * Integration tests for export (AC7, AC8, AC11): exact output sizes, crops applied pixel-accurately (also on rotated
 * photos), transparency flattened, GPS/EXIF/XMP/IPTC absent, and the safety rules: checks before writing, no
 * overwrites, fresh folders, cancel, a full disk and a crash leaving nothing finished-looking behind.
 */

import { appendFileSync, chmodSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import exifr from 'exifr'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CROP, type Crop, type Fit, type Rect } from '@shared/layout'
import { compose } from '@shared/studio/compose'
import { layers } from '@shared/studio/layers'
import { PLAYFUL_TEMPLATES } from '@shared/studio/playful'
import { PLAYFUL_QUARTETS } from '@shared/studio/playful-quartets'
import { FORMAT_IDS, FORMATS } from '@shared/studio/formats'
import { backupCatalog, restoreCatalogBackup } from '../../src/main/catalog/backup'
import type { Catalog } from '../../src/main/catalog/database'
import { createProject, getProject, setDesign } from '../../src/main/catalog/repositories/projects'
import { designOf, updateItem } from '../../src/shared/studio/design'
import { setSourceStatus } from '../../src/main/catalog/repositories/sources'
import { scanSource } from '../../src/main/library/scan'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { processImage } from '../../src/main/media/process-image'
import { renderCanvas, type RenderLayer, type RenderRequest } from '../../src/main/media/render-export'
import { prepareExport, recoverInterruptedExports, runExport, safeName, type ExportPlan } from '../../src/main/studio/export'
import { createDiskImage } from '../support/disk-image'
import { fingerprintFolder, guardFolder } from '../support/originals-guard'
import { openTestCatalog, tempDir, tempProfile } from './helpers'

const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="Owner"/></rdf:RDF></x:xmpmeta>'

// A photo split in two colours (left/right, or top/bottom when `split` is 'rows'), carrying location and camera data.
async function twoTone(path: string, options: { split: 'columns' | 'rows'; orientation?: number; shade?: number }) {
  const [w, h] = [400, 300]
  // `shade` nudges the blue, so photos made with different shades are different files (and different pictures).
  const blue = { r: 0, g: 0, b: 255 - (options.shade ?? 0) }
  const half = options.split === 'columns' ? { width: w / 2, height: h } : { width: w, height: h / 2 }
  const red = await sharp({ create: { ...half, channels: 3, background: '#ff0000' } }).png().toBuffer()
  let image = sharp({ create: { width: w, height: h, channels: 3, background: blue } })
    .composite([{ input: red, left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .withExif({
      IFD0: { Copyright: 'Owner' },
      IFD2: { DateTimeOriginal: '2024:07:20 10:00:00' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
    })
    .withXmp(XMP)
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation })
  await image.toFile(path)
}

// The colour at a point of an exported file: "red", "blue", "cream", "white", or the raw RGB.
// JPEG compression shifts colours by a few levels, so the named colours allow ±4.
async function colourAt(file: string, x: number, y: number): Promise<string> {
  const [r, g, b] = await sharp(file).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer()
  const near = (target: [number, number, number]) => Math.abs(r! - target[0]) <= 4 && Math.abs(g! - target[1]) <= 4 && Math.abs(b! - target[2]) <= 4
  if (r! > 200 && g! < 60 && b! < 60) return 'red'
  if (b! > 200 && r! < 60 && g! < 60) return 'blue'
  if (near([248, 240, 232])) return 'cream'
  if (near([255, 255, 255])) return 'white'
  return `rgb(${r},${g},${b})`
}

// One upright, unmasked photo for a render request: the original, its crop and fit, and its place on the canvas.
const photoLayer = (sourcePath: string, crop: Crop, cell: Rect, fit: Fit = 'fill'): RenderLayer => ({
  kind: 'photo',
  sourcePath,
  crop,
  fit,
  element: { rect: cell, rotation: 0, mask: null, frame: null },
})

// Most renders here have no photo border; the border tests set their own.
const NO_BORDER = { width: 0, color: '#ffffff' }
const cellCentre = { left: { x: 48 + 480 / 2, y: 540 }, right: { x: 48 + 480 + 24 + 480 / 2, y: 540 } } // two-photo collage, 1:1

describe('rendering an export file', () => {
  it('is exactly 1080 wide, square or portrait, and applies each crop to the right part of the photo', async () => {
    const dir = tempDir()
    const photo = join(dir, 'split.jpg')
    await twoTone(photo, { split: 'columns' }) // left half red, right half blue
    for (const format of ['square', 'portrait'] as const) {
      const out = join(dir, `out-${format}.jpg`)
      const { width, height } = FORMATS[format]
      const cellHeight = height - 96
      const request: RenderRequest = {
        outputPath: out,
        width,
        height,
        background: '#f8f0e8',
        quality: 90,
        border: NO_BORDER, ppi: null,
        layers: [
          photoLayer(photo, { cx: 0.25, cy: 0.5, zoom: 1 }, { x: 48, y: 48, width: 480, height: cellHeight }, 'fill'),
          photoLayer(photo, { cx: 0.75, cy: 0.5, zoom: 1 }, { x: 552, y: 48, width: 480, height: cellHeight }, 'fill'),
        ],
      }
      expect(await renderCanvas(request)).toEqual({ ok: true })
      expect(await sharp(out).metadata()).toMatchObject({ format: 'jpeg', width, height })
      expect(await colourAt(out, cellCentre.left.x, height / 2)).toBe('red')
      expect(await colourAt(out, cellCentre.right.x, height / 2)).toBe('blue')
      expect(await colourAt(out, 10, 10)).toBe('cream') // the margin
    }
  })

  it('crops a rotated photo the way it is displayed (after EXIF orientation)', async () => {
    const dir = tempDir()
    const photo = join(dir, 'rotated.jpg')
    // Stored top half red, bottom half blue, orientation 6 (90° clockwise): displayed, red is on the right.
    await twoTone(photo, { split: 'rows', orientation: 6 })
    const out = join(dir, 'out.jpg')
    const cell = { x: 0, y: 0, width: 1080, height: 1080 }
    await renderCanvas({ outputPath: out, width: 1080, height: 1080, background: '#ffffff', quality: 90, border: NO_BORDER, ppi: null, layers: [photoLayer(photo, { cx: 0.9, cy: 0.5, zoom: 3 }, cell, 'fill')] })
    expect(await colourAt(out, 540, 540)).toBe('red')
    await renderCanvas({ outputPath: out, width: 1080, height: 1080, background: '#ffffff', quality: 90, border: NO_BORDER, ppi: null, layers: [photoLayer(photo, { cx: 0.1, cy: 0.5, zoom: 3 }, cell, 'fill')] })
    expect(await colourAt(out, 540, 540)).toBe('blue')
  })

  it('leaves out all location, camera and other metadata (GPS, EXIF, XMP, IPTC)', async () => {
    const dir = tempDir()
    const photo = join(dir, 'tagged.jpg')
    await twoTone(photo, { split: 'columns' })
    // The source really does carry them, so their absence below means something.
    expect(await exifr.parse(photo, { gps: true, xmp: true })).toMatchObject({ latitude: 51.5, Copyright: 'Owner', creator: 'Owner' })

    const out = join(dir, 'out.jpg')
    const cell = { x: 0, y: 0, width: 1080, height: 1080 }
    await renderCanvas({ outputPath: out, width: 1080, height: 1080, background: '#ffffff', quality: 90, border: NO_BORDER, ppi: null, layers: [photoLayer(photo, { cx: 0.5, cy: 0.5, zoom: 1 }, cell, 'fill')] })
    const meta = await sharp(out).metadata()
    expect({ exif: meta.exif, xmp: meta.xmp, iptc: meta.iptc }).toEqual({ exif: undefined, xmp: undefined, iptc: undefined })
    expect(await exifr.parse(out, { gps: true, xmp: true, iptc: true, tiff: true, exif: true })).toBeUndefined()
  })

  it('a print file records 300 pixels per inch without adding EXIF or anything else that could identify it', async () => {
    const dir = tempDir()
    const photo = join(dir, 'tagged.jpg')
    await twoTone(photo, { split: 'columns' })
    const out = join(dir, 'print.jpg')
    const cell = { x: 0, y: 0, width: 2400, height: 2400 }
    await renderCanvas({ outputPath: out, width: 2400, height: 2400, background: '#ffffff', quality: 90, border: NO_BORDER, ppi: 300, layers: [photoLayer(photo, { cx: 0.5, cy: 0.5, zoom: 1 }, cell, 'fill')] })
    const meta = await sharp(out).metadata()
    expect({ density: meta.density, exif: meta.exif, xmp: meta.xmp, iptc: meta.iptc }).toEqual({ density: 300, exif: undefined, xmp: undefined, iptc: undefined })
    expect(await exifr.parse(out, { gps: true, xmp: true, iptc: true, tiff: true, exif: true })).toBeUndefined()
    expect(await colourAt(out, 600, 1200)).toBe('red') // the image itself still decodes as drawn
  })

  it('keeps colour at full resolution, so fine coloured detail isn’t smeared (owner’s review)', async () => {
    const dir = tempDir()
    // One-pixel stripes of red and blue: half-resolution colour (JPEG's default 4:2:0) would blend them into purple.
    const [w, h] = [480, 616]
    const pixels = Buffer.alloc(w * h * 3)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.set(x % 2 === 0 ? [220, 0, 0] : [0, 0, 220], (y * w + x) * 3)
    const stripes = join(dir, 'stripes.png')
    await sharp(pixels, { raw: { width: w, height: h, channels: 3 } }).png().toFile(stripes)

    const out = join(dir, 'out.jpg')
    // The cell is the photo's own size, so nothing is resampled and every output pixel should match the source.
    await renderCanvas({ outputPath: out, width: w, height: h, background: '#ffffff', quality: 92, border: NO_BORDER, ppi: null, layers: [photoLayer(stripes, { cx: 0.5, cy: 0.5, zoom: 1 }, { x: 0, y: 0, width: w, height: h }, 'fill')] })
    expect((await sharp(out).metadata()).chromaSubsampling).toBe('4:4:4')
    const back = await sharp(out).raw().toBuffer()
    let error = 0
    for (let i = 0; i < pixels.length; i++) error += Math.abs(pixels[i]! - back[i]!)
    expect(error / pixels.length).toBeLessThan(15)
  })

  // Photo borders and fit (S2 Quick edits) come from the same placePhoto() the preview draws with.
  it('draws a photo border inside the photo’s place, and the photo inside the border', async () => {
    const dir = tempDir()
    const photo = join(dir, 'photo.jpg')
    await twoTone(photo, { split: 'columns' })
    const out = join(dir, 'out.jpg')
    const cell = { x: 40, y: 40, width: 1000, height: 1000 }
    const result = await renderCanvas({
      outputPath: out,
      width: 1080,
      height: 1080,
      background: '#ffffff',
      quality: 90,
      border: { width: 60, color: '#f8f0e8' }, ppi: null,
      layers: [photoLayer(photo, { cx: 0.5, cy: 0.5, zoom: 1 }, cell, 'fill')],
    })
    expect(result).toEqual({ ok: true })
    expect(await colourAt(out, 20, 540)).toBe('white') // the margin, outside the place
    expect(await colourAt(out, 70, 540)).toBe('cream') // the border band, 40–100 px
    expect(await colourAt(out, 540, 70)).toBe('cream')
    expect(await colourAt(out, 300, 540)).toBe('red') // the photo, inside the border
    expect(await colourAt(out, 780, 540)).toBe('blue')
  })

  it('fit shows the whole photo centred in its place, with the border hugging the photo', async () => {
    const dir = tempDir()
    const photo = join(dir, 'photo.jpg')
    await twoTone(photo, { split: 'columns' }) // 4:3
    const out = join(dir, 'out.jpg')
    const cell = { x: 40, y: 40, width: 1000, height: 1000 }
    const render = (border: number) =>
      renderCanvas({
        outputPath: out,
        width: 1080,
        height: 1080,
        background: '#ffffff',
        quality: 90,
        border: { width: border, color: '#f8f0e8' }, ppi: null,
        layers: [photoLayer(photo, { cx: 0.9, cy: 0.5, zoom: 3 }, cell, 'fit')],
      })
    // No border: 1000 × 750, centred, so 125 px of background above and below. The crop is ignored.
    await render(0)
    expect(await colourAt(out, 540, 100)).toBe('white')
    expect(await colourAt(out, 60, 540)).toBe('red') // the photo's left edge is the place's left edge
    expect(await colourAt(out, 1020, 540)).toBe('blue')
    // A 20 px border: the photo is 960 × 720 at y 180–900, and the border wraps it at y 160–180.
    await render(20)
    expect(await colourAt(out, 540, 140)).toBe('white')
    expect(await colourAt(out, 540, 170)).toBe('cream')
    expect(await colourAt(out, 300, 540)).toBe('red')
  })

  // S4a: playful layouts are drawn from the same layers the preview draws (ADR-0017); these check the pixels.
  it('draws playful layouts: masks cut photos, film holes show the background, cards and captions are drawn', async () => {
    const dir = tempDir()
    const photo = join(dir, 'photo.jpg')
    await twoTone(photo, { split: 'columns' })
    const render = async (templateId: string, params: Parameters<typeof compose>[0]['params'] = { v: 1 }) => {
      const composition = compose({ templateId, templateVersion: 1, format: 'square', params, photoCount: 2 })
      const out = join(dir, `${templateId}.jpg`)
      const result = await renderCanvas({
        outputPath: out,
        width: 1080,
        height: 1080,
        background: composition.background,
        border: composition.border,
        ppi: null,
        quality: 92,
        layers: layers(composition, 0).map((l): RenderLayer => (l.kind === 'shape' ? l : { kind: 'photo', sourcePath: photo, crop: DEFAULT_CROP, fit: 'fill', element: l.element })),
      })
      expect(result).toEqual({ ok: true })
      return { out, composition }
    }
    const near = async (file: string, x: number, y: number, hex: string) => {
      const [r, g, b] = await sharp(file).extract({ left: Math.round(x), top: Math.round(y), width: 1, height: 1 }).raw().toBuffer()
      const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      return Math.max(Math.abs(r! - want[0]!), Math.abs(g! - want[1]!), Math.abs(b! - want[2]!)) <= 8
    }

    // Circles: a rectangle's corner is outside the circle, so it shows the background; the middle is the photo.
    const circles = await render('pair-circle-story')
    const big = circles.composition.elements[0]!.rect
    expect(await colourAt(circles.out, big.x + 6, big.y + 6)).toBe('cream')
    expect(await colourAt(circles.out, big.x + big.width * 0.25, big.y + big.height / 2)).toBe('red')

    // Arches: the top corners are outside the arch; the bottom is inside.
    const windows = await render('pair-window-light')
    const left = windows.composition.elements[0]!.rect
    expect(await colourAt(windows.out, left.x + 4, left.y + 4)).toBe('cream')
    expect(await colourAt(windows.out, left.x + left.width * 0.25, left.y + left.height - 20)).toBe('red')

    // Film: the strip is film-coloured, and its sprocket holes are cut through, showing the background colour.
    const film = await render('pair-film-night', { v: 1, background: '#123456' })
    // On a square canvas the strip runs down the page; frames are 70% of its width, and its edge bands 12% each.
    const frame = film.composition.elements[0]!.rect
    const across = frame.width / 0.7
    const stripLeft = frame.x - (across - frame.width) / 2
    let [holes, filmColour] = [0, 0]
    for (let y = frame.y; y < film.composition.elements[1]!.rect.y + frame.height; y += 4) {
      const x = stripLeft + 0.06 * across // down the middle of the left edge band
      if (await near(film.out, x, y, '#123456')) holes++
      if (await near(film.out, x, y, '#3a2a30')) filmColour++
    }
    expect(holes).toBeGreaterThan(10) // the background shows through a column of holes
    expect(filmColour).toBeGreaterThan(10) // with film between them

    // Torn pages: the photo's corner is torn away to its white sheet; beyond the sheet is the blush background.
    const tornPages = await render('pair-torn-pages')
    const page = tornPages.composition.elements[0]!.rect
    expect(await near(tornPages.out, page.x - 0.035 * 1080, page.y + page.height / 2, '#e8b7b0')).toBe(true)
    expect(await colourAt(tornPages.out, page.x + page.width / 4, page.y + page.height / 2)).toBe('red')

    // Gallery ticket: its corner notch shows the sage background; just inside the top edge is the paper.
    const ticketed = await render('pair-gallery-ticket')
    const firstPhoto = ticketed.composition.elements[0]!.rect
    const ticketLeft = firstPhoto.x - 0.06 * 1080
    const ticketTop = firstPhoto.y - 0.13 * 1080
    expect(await near(ticketed.out, ticketLeft + 4, ticketTop + 4, '#b8bda6')).toBe(true)
    expect(await near(ticketed.out, ticketLeft + 0.1 * 1080, ticketTop + 8, '#fffaf4')).toBe(true)

    // Colorblock: the lilac block is see-through (55%), so the corner is lilac mixed with the cream background.
    const blocks = await render('pair-colorblock')
    const mix = (a: number, b: number) => Math.round(a * 0.45 + b * 0.55)
    const mixed = `#${[mix(0xf8, 0xb9), mix(0xf0, 0xa4), mix(0xe8, 0xc8)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
    expect(await near(blocks.out, 6, 6, mixed)).toBe(true)

    // Postcards: white card around each tilted photo, and the caption drawn in plum.
    const postcards = await render('pair-postcards')
    const card = postcards.composition.elements[0]!
    const t = (card.rotation * Math.PI) / 180
    const reach = card.rect.height / 2 + card.frame!.pad / 2 // halfway through the card's top edge, turned with the card
    const cx = card.rect.x + card.rect.width / 2
    const cy = card.rect.y + card.rect.height / 2
    expect(await colourAt(postcards.out, cx + reach * Math.sin(t), cy - reach * Math.cos(t))).toBe('white')
    const caption = postcards.composition.over.find((d) => d.type === 'text')
    expect(caption).toBeDefined()
    if (caption?.type === 'text') {
      const { data, info } = await sharp(postcards.out).extract({ left: Math.round(caption.at.x), top: Math.round(caption.at.y - caption.size), width: 300, height: Math.round(caption.size * 1.2) }).raw().toBuffer({ resolveWithObject: true })
      let ink = 0
      for (let i = 0; i < info.width * info.height; i++) if (data[i * 3]! < 140 && data[i * 3 + 2]! < 140) ink++
      expect(ink).toBeGreaterThan(300) // dark plum letter strokes
    }
  })

  it('flattens transparency onto the chosen background, on purpose', async () => {
    const dir = tempDir()
    const clear = join(dir, 'clear.png')
    await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(clear)
    const out = join(dir, 'out.jpg')
    await renderCanvas({
      outputPath: out,
      width: 1080,
      height: 1080,
      background: '#f8f0e8',
      quality: 90,
      border: NO_BORDER, ppi: null,
      layers: [photoLayer(clear, { cx: 0.5, cy: 0.5, zoom: 1 }, { x: 0, y: 0, width: 1080, height: 1080 }, 'fill')],
    })
    expect(await colourAt(out, 540, 540)).toBe('cream')
  })
})

// A scanned folder of two-tone photos and a project, ready to export.
async function exportable(kind: 'collage' | 'carousel' | 'quartet' = 'collage') {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  const thumbnailsDir = join(profile.dir, 'thumbnails')
  mkdirSync(thumbnailsDir)
  const photos = join(tempDir(), 'Photos')
  mkdirSync(photos)
  for (const [i, name] of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].entries()) await twoTone(join(photos, name), { split: i === 1 ? 'rows' : 'columns', shade: i * 10 })
  const added = addSourceFolder(db, photos, profile.dir)
  if (!added.ok) throw new Error(added.reason)
  await scanSource({ db, thumbnailsDir, processImage }, added.source.id)
  const count = { collage: 2, carousel: 3, quartet: 4 }[kind]
  const assets = (db.prepare('SELECT asset_id FROM asset_location ORDER BY relative_path').pluck().all() as string[]).slice(0, count)
  const templateId = { collage: 'pair-equal-split', carousel: 'carousel-full', quartet: 'quartet-classic-grid' }[kind]
  const project = createProject(db, { templateId, format: 'square', assetIds: assets })
  return { db, profile, photos, sourceId: added.source.id, project }
}

const render = (request: RenderRequest) => renderCanvas(request)
async function ready(db: Catalog, projectId: string, destinationDir: string, appDataDir: string): Promise<ExportPlan> {
  const prepared = await prepareExport(db, { projectId, destinationDir, appDataDir })
  if (prepared.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(prepared)}`)
  return prepared.plan
}

describe('exporting a project', () => {
  it('writes into a fresh folder, names carousel slides in order, never overwrites, and leaves originals untouched', async () => {
    const { db, profile, photos, project } = await exportable('carousel')
    const destination = tempDir()
    const before = fingerprintFolder(photos)
    const guard = await guardFolder(photos)
    const now = () => new Date(2026, 9, 29)

    const first = await runExport({ db, render, now }, await ready(db, project.id, destination, profile.dir))
    const second = await runExport({ db, render, now }, await ready(db, project.id, destination, profile.dir))

    expect(first).toMatchObject({ status: 'done', files: ['Carousel 01.jpg', 'Carousel 02.jpg', 'Carousel 03.jpg'] })
    expect(readdirSync(destination).sort()).toEqual(['Nearmora Carousel 2026-10-29', 'Nearmora Carousel 2026-10-29 (2)'])
    expect(second.status === 'done' && second.folder.endsWith('(2)')).toBe(true)
    for (const file of readdirSync(join(destination, 'Nearmora Carousel 2026-10-29'))) {
      expect(await sharp(join(destination, 'Nearmora Carousel 2026-10-29', file)).metadata()).toMatchObject({ width: 1080, height: 1080, format: 'jpeg' })
    }
    expect(await guard.finish()).toEqual([])
    expect(fingerprintFolder(photos)).toEqual(before)
    expect(db.prepare(`SELECT status FROM job WHERE kind = 'export'`).pluck().all()).toEqual(['done', 'done'])
  })

  // S3: print sizes go through the same staged, verified export; the largest is 4800 × 7200 (34.6 megapixels).
  it('exports every sharing and print size at its exact pixel size, verified, with no metadata beyond print density', async () => {
    const { db, profile, project } = await exportable()
    for (const format of FORMAT_IDS) {
      setDesign(db, { projectId: project.id, design: { ...designOf(getProject(db, project.id)), format } })
      const destination = tempDir()
      const outcome = await runExport({ db, render }, await ready(db, project.id, destination, profile.dir))
      if (outcome.status !== 'done') throw new Error(`${format}: ${JSON.stringify(outcome)}`)
      const meta = await sharp(join(outcome.folder, outcome.files[0]!)).metadata()
      const print = FORMATS[format].use === 'print'
      expect({ format, width: meta.width, height: meta.height, chroma: meta.chromaSubsampling, exif: meta.exif, xmp: meta.xmp, density: meta.density }).toEqual({
        format,
        width: FORMATS[format].width,
        height: FORMATS[format].height,
        chroma: '4:4:4',
        exif: undefined,
        xmp: undefined,
        // Print files record 300 pixels per inch (in a JFIF header, not EXIF); sharing files record none (sharp reports 72).
        density: print ? 300 : 72,
      })
    }
  }, 120_000)

  it('exports a playful project through the same staged, verified pipeline', async () => {
    const { db, profile, project } = await exportable()
    for (const templateId of PLAYFUL_TEMPLATES.map((t) => t.id)) {
      setDesign(db, { projectId: project.id, design: { ...designOf(getProject(db, project.id)), templateId, templateVersion: 1, format: 'print-8x10' } })
      const outcome = await runExport({ db, render }, await ready(db, project.id, tempDir(), profile.dir))
      if (outcome.status !== 'done') throw new Error(`${templateId}: ${JSON.stringify(outcome)}`)
      const meta = await sharp(join(outcome.folder, outcome.files[0]!)).metadata()
      expect({ templateId, width: meta.width, height: meta.height, density: meta.density, exif: meta.exif }).toEqual({ templateId, width: 2400, height: 3000, density: 300, exif: undefined })
    }
  }, 60_000)

  // S4c: every playful quartet goes through the full pipeline too, at a print size, with all four photos placed.
  it('exports each playful quartet through the same staged, verified pipeline', async () => {
    const { db, profile, project } = await exportable('quartet')
    for (const templateId of PLAYFUL_QUARTETS.map((t) => t.id)) {
      setDesign(db, { projectId: project.id, design: { ...designOf(getProject(db, project.id)), templateId, templateVersion: 1, format: 'print-8x10' } })
      const outcome = await runExport({ db, render }, await ready(db, project.id, tempDir(), profile.dir))
      if (outcome.status !== 'done') throw new Error(`${templateId}: ${JSON.stringify(outcome)}`)
      const meta = await sharp(join(outcome.folder, outcome.files[0]!)).metadata()
      expect({ templateId, width: meta.width, height: meta.height, density: meta.density, exif: meta.exif }).toEqual({ templateId, width: 2400, height: 3000, density: 300, exif: undefined })
    }
  }, 120_000)

  it('refuses a destination inside a photo folder or inside Nearmora’s data, or one it can’t write to', async () => {
    const { db, profile, photos, project } = await exportable()
    const refusal = async (destinationDir: string) => {
      const result = await prepareExport(db, { projectId: project.id, destinationDir, appDataDir: profile.dir })
      return result.status === 'refused' ? result.reason : result.status
    }
    expect(await refusal(photos)).toBe('inside_source')
    expect(await refusal(profile.dir)).toBe('app_data')
    const locked = tempDir()
    chmodSync(locked, 0o555)
    try {
      expect(await refusal(locked)).toBe('unwritable')
    } finally {
      chmodSync(locked, 0o755)
    }
  })

  it('names offline photos, and photos whose original changed, before writing anything', async () => {
    const { db, profile, photos, sourceId, project } = await exportable()
    appendFileSync(join(photos, 'a.jpg'), Buffer.from([0])) // the test's own photo is edited after scanning
    expect(await prepareExport(db, { projectId: project.id, destinationDir: tempDir(), appDataDir: profile.dir })).toEqual({
      status: 'refused',
      reason: 'changed',
      files: ['a.jpg'],
    })
    setSourceStatus(db, sourceId, 'disconnected')
    expect(await prepareExport(db, { projectId: project.id, destinationDir: tempDir(), appDataDir: profile.dir })).toEqual({
      status: 'refused',
      reason: 'unavailable',
      files: ['a.jpg', 'b.jpg'],
    })
  })

  it('notices an original edited in place, even with the same size and date, by its fingerprint', async () => {
    const { db, profile, photos, project } = await exportable()
    const file = join(photos, 'b.jpg')
    const { mtime, atime } = statSync(file)
    const bytes = readFileSync(file)
    bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 0xff // same length, different content
    writeFileSync(file, bytes)
    utimesSync(file, atime, mtime) // and the same modification time
    expect(await prepareExport(db, { projectId: project.id, destinationDir: tempDir(), appDataDir: profile.dir })).toEqual({
      status: 'refused',
      reason: 'changed',
      files: ['b.jpg'],
    })
  })

  it('a cancelled export leaves nothing behind', async () => {
    const { db, profile, project } = await exportable('carousel')
    const destination = tempDir()
    const controller = new AbortController()
    const cancelling = (request: RenderRequest) => renderCanvas(request).finally(() => controller.abort())
    const outcome = await runExport({ db, render: cancelling }, await ready(db, project.id, destination, profile.dir), { signal: controller.signal })
    expect(outcome.status).toBe('cancelled')
    expect(readdirSync(destination)).toEqual([])
    expect(db.prepare(`SELECT status FROM job WHERE kind = 'export'`).pluck().get()).toBe('cancelled')
  })

  it('a crash mid-export is cleaned up at the next launch; folders that aren’t its own are never touched', async () => {
    const { db } = await exportable()
    const destination = tempDir()
    const jobId = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e'
    const staging = join(destination, `.nearmora-export-${jobId}`)
    mkdirSync(staging)
    writeFileSync(join(staging, 'Collage.jpg'), 'half written')
    mkdirSync(join(destination, 'Someone else’s folder'))
    db.prepare(`INSERT INTO job (id, kind, status, checkpoint, created_at, updated_at) VALUES (?, 'export', 'running', ?, 0, 0)`).run(
      jobId,
      JSON.stringify({ projectId: 'x', staging }),
    )
    // A job that names a folder without the matching id: recovery must not delete it.
    db.prepare(`INSERT INTO job (id, kind, status, checkpoint, created_at, updated_at) VALUES ('other', 'export', 'running', ?, 0, 0)`).run(
      JSON.stringify({ staging: join(destination, 'Someone else’s folder') }),
    )

    expect(recoverInterruptedExports(db)).toBe(2)
    expect(readdirSync(destination)).toEqual(['Someone else’s folder'])
    expect(db.prepare(`SELECT DISTINCT status FROM job WHERE kind = 'export'`).pluck().all()).toEqual(['failed'])
  })
})

describe.skipIf(process.platform !== 'darwin')('a full disk (AC8)', () => {
  it('fails cleanly with nothing left behind, and a retry elsewhere completes', async () => {
    const { db, profile, project } = await exportable('carousel')
    // Big, noisy photos make big JPEGs, so a 2 MB volume fills up partway through.
    const noisy = join(tempDir(), 'noise.jpg')
    await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } })
      .jpeg({ quality: 95 })
      .toFile(noisy)
    const disk = createDiskImage(tempDir(), 2, 'NearmoraFull')
    const { mount } = disk
    disk.attach()
    try {
      const plan = await ready(db, project.id, mount, profile.dir)
      // Swap in the noisy photo so each slide is large; the plan is otherwise the real one.
      const heavy: ExportPlan = { ...plan, outputs: plan.outputs.map((o) => ({ ...o, layers: o.layers.map((l) => (l.kind === 'photo' ? { ...l, sourcePath: noisy } : l)) })) }
      const outcome = await runExport({ db, render }, heavy)
      expect(outcome).toMatchObject({ status: 'failed', reason: 'disk_full' })
      expect(readdirSync(mount).filter((name) => !name.startsWith('.fseventsd') && !name.startsWith('.Trashes'))).toEqual([])

      const retry = await runExport({ db, render }, await ready(db, project.id, tempDir(), profile.dir))
      expect(retry.status).toBe('done')
    } finally {
      await disk.eject()
    }
  }, 120_000)
})

describe('file names and backups', () => {
  it('makes titles safe as file names', () => {
    expect(safeName('Beach: day/night?')).toBe('Beach- day-night-')
    expect(safeName('  ..hidden  ')).toBe('hidden')
    expect(safeName('\u0007')).toBe('-')
    expect(safeName('   ')).toBe('Nearmora export')
  })

  it('a backup restores projects exactly, with order and crops (AC11)', async () => {
    const { db, project } = await exportable('carousel')
    setDesign(db, { projectId: project.id, design: updateItem(designOf(getProject(db, project.id)), 2, { crop: { cx: 0.2, cy: 0.8, zoom: 3 } }) })
    const before = getProject(db, project.id)
    const { folder } = await backupCatalog(db, { destinationDir: tempDir(), appVersion: '0.0.1' })
    const clean = tempProfile()
    const { catalog } = await restoreCatalogBackup(folder, clean.catalogFile)
    expect(getProject(catalog, project.id)).toEqual(before)
    catalog.close()
  })
})
