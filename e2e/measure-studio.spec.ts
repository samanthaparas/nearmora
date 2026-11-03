/**
 * Measures Memory Studio at its limits (S7, `npm run measure:studio`): dragging a photo on a 10-place collage, drawing
 * a 3-slide seamless design, and exporting at 16 × 24 in and as seamless slides, all with twelve-megapixel photos.
 * Skipped in normal runs. Results are printed for the evidence notes; the blueprint's budget (no UI-blocking work over
 * 100 ms) is reported as met or missed, never tuned to pass.
 */

import { rmSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { launchApp, tempFolder } from './launch'

test.skip(!process.env['NEARMORA_STUDIO_PERF'], 'Run with npm run measure:studio')
test.setTimeout(20 * 60_000)

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

// Ten distinct 4000 × 3000 JPEGs with noise, about the size of a phone photo.
async function generatePhotos(root: string): Promise<void> {
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 30 + i * 20, g: 120, b: 200 - i * 15 }, noise: { type: 'gaussian', mean: 120, sigma: 30 } } })
        .jpeg({ quality: 88 })
        .toFile(join(root, `IMG_${String(i).padStart(2, '0')}.jpg`)),
    ),
  )
}

// Long tasks (work that blocks the page for 50 ms or more), recorded from now on.
const watchLongTasks = (page: Page) =>
  page.evaluate(() => {
    const store = window as unknown as { longTasks: number[] }
    store.longTasks = []
    new PerformanceObserver((list) => list.getEntries().forEach((e) => store.longTasks.push(e.duration))).observe({ type: 'longtask', buffered: false })
  })
const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)

// Exports the open project into a fresh folder, timing it and sampling the app's total memory every 200 ms.
// Everything this run generates (photos, exports) is deleted at the end.
const made: string[] = []
test.afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

async function timedExport(app: ElectronApplication, page: Page): Promise<{ seconds: number; peakMb: number }> {
  const destination = tempFolder('studio-perf-export')
  made.push(destination)
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, destination)
  let peak = 0
  const sample = setInterval(() => {
    void app
      .evaluate(({ app: electronApp }) => electronApp.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0))
      .then((kb) => (peak = Math.max(peak, kb)))
      .catch(() => {})
  }, 200)
  const started = Date.now()
  const panel = page.getByRole('region', { name: 'Export' })
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel).toContainText('Exported', { timeout: 10 * 60_000 })
  const seconds = (Date.now() - started) / 1000
  clearInterval(sample)
  return { seconds, peakMb: Math.round(peak / 1024) }
}

test('Memory Studio at its limits', async () => {
  const photos = tempFolder('studio-perf-photos')
  made.push(photos)
  await generatePhotos(photos)
  const { app } = await launchApp(tempFolder('profile'))
  const page = await app.firstWindow()
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, photos)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('list', { name: 'Photos, 10 in total' })).toBeVisible({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Select photos' }).click()
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: /^Select:/ }).nth(i).click()
  await page.getByRole('button', { name: '★ Add to Favorites' }).click()

  // A Classic grid with six added places: ten twelve-megapixel photos on one canvas.
  await nav(page, 'Favorites')
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: /^Select: / }).nth(i).click()
  await page.getByRole('region', { name: 'Four photos' }).getByRole('button', { name: /^Classic grid/ }).click()
  for (let place = 5; place <= 10; place++) {
    await page.getByRole('button', { name: 'Add a place' }).click()
    await page.getByRole('button', { name: 'Fill with a photo…' }).click()
    await page.getByRole('group', { name: `Replace photo ${place} with a favorite` }).getByRole('button', { name: /^Use / }).first().click()
    await expect(page.getByText(`Replaced photo ${place}. All changes saved.`)).toBeVisible()
  }

  // Drag photo 1 across the canvas in 40 steps, watching for anything that blocks the page.
  const canvas = page.locator('.studio__canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.waitForTimeout(1500) // let every preview image load first
  await watchLongTasks(page)
  const dragStart = Date.now()
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 40 })
  await page.mouse.up()
  await expect(page.getByText('All changes saved.', { exact: false })).toBeVisible()
  const dragMs = Date.now() - dragStart
  const dragTasks = await longTasks(page)

  // Export the ten-photo collage at the largest print size.
  await page.getByLabel('16 × 24 in', { exact: false }).check()
  const print = await timedExport(app, page)

  // A three-slide seamless design at portrait: draw it, then export its slides.
  await nav(page, 'Favorites')
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /^Select: / }).nth(i).click()
  await watchLongTasks(page)
  await page.getByRole('region', { name: 'Seamless carousels', exact: true }).getByRole('button', { name: /^Story strip/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Story strip' })).toBeVisible()
  await page.getByRole('group', { name: 'Shape of each slide' }).getByLabel('Portrait (1080 × 1350)').check()
  await page.waitForTimeout(3000)
  const seamlessTasks = await longTasks(page)
  const seamless = await timedExport(app, page)
  await app.close()

  const worst = (tasks: number[]) => Math.round(Math.max(0, ...tasks))
  const result = {
    machine: `${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
    drag: { steps: 40, totalMs: dragMs, longTasks: dragTasks.length, worstMs: worst(dragTasks), over100: dragTasks.filter((d) => d > 100).length },
    seamlessDraw: { longTasks: seamlessTasks.length, worstMs: worst(seamlessTasks), over100: seamlessTasks.filter((d) => d > 100).length },
    printExport16x24: print,
    seamlessExport3Slides: seamless,
  }
  console.log(`STUDIO-PERF ${JSON.stringify(result)}`)
  console.log(`Budget "no UI-blocking work over 100 ms": drag ${result.drag.over100 === 0 ? 'met' : 'missed'}, seamless drawing ${result.seamlessDraw.over100 === 0 ? 'met' : 'missed'}`)
})
