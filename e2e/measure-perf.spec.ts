/**
 * Measures the blueprint's proposed performance budgets on a defined 10,000-photo collection (`npm run measure:perf`).
 * Skipped in normal runs: it generates several gigabytes of photos (deleted afterwards). Results are printed for the
 * evidence notes; budgets are reported as met or missed, never tuned to pass.
 * Budgets: first browsable batch ≤ 10 s, no UI-blocking work over 100 ms, warm gallery ≤ 2 s; track scan rate,
 * peak memory and cache size.
 */

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { launchApp, tempFolder } from './launch'

test.skip(!process.env['NEARMORA_PERF'], 'Run with npm run measure:perf')
test.setTimeout(90 * 60_000)

const COUNT = 10_000

// 10,000 distinct 1200×900 JPEGs with noise (realistic file sizes), dated across two years, in 100 subfolders.
async function generateCollection(root: string): Promise<void> {
  const start = Date.UTC(2023, 0, 1)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= COUNT) return
      const folder = join(root, `folder-${String(Math.floor(i / 100)).padStart(3, '0')}`)
      mkdirSync(folder, { recursive: true })
      const date = new Date(start + i * 2 * 60 * 60 * 1000 + (i % 7) * 13_000)
      const exifDate = date.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, ':')
      await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: i % 256, g: (i * 7) % 256, b: (i * 13) % 256 }, noise: { type: 'gaussian', mean: 120, sigma: 30 } } })
        .jpeg({ quality: 85 })
        .withExif({ IFD2: { DateTimeOriginal: exifDate } })
        .toFile(join(folder, `IMG_${String(i).padStart(5, '0')}.jpg`))
    }
  }
  await Promise.all(Array.from({ length: Math.max(2, cpus().length) }, worker))
}

const folderBytes = (dir: string): number => readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0)

// Longest gap in a main-process timer that should tick every 10 ms: how long main was blocked.
async function startMainLagProbe(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as Record<string, unknown>
    g['__lag'] = 0
    let last = performance.now()
    g['__lagTimer'] = setInterval(() => {
      const now = performance.now()
      g['__lag'] = Math.max(g['__lag'] as number, now - last - 10)
      last = now
    }, 10)
  })
}
const readMainLag = (app: ElectronApplication) => app.evaluate(() => (globalThis as Record<string, unknown>)['__lag'] as number)

// Renderer long tasks (the browser's own measure of work over 50 ms that blocks the page).
async function startLongTaskProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __longest: number }
    w.__longest = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__longest = Math.max(w.__longest, entry.duration)
    }).observe({ type: 'longtask', buffered: false })
  })
}
const readLongTask = (page: Page) => page.evaluate(() => (window as unknown as { __longest: number }).__longest)

const firstThumbnailShown = (page: Page) =>
  page.locator('.library__thumb').evaluateAll((images) => images.some((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))

test('performance budgets on 10,000 photos', async () => {
  const work = tempFolder('perf')
  const root = join(work, 'Collection')
  const genStarted = performance.now()
  await generateCollection(root)
  console.log(`[perf] generated ${COUNT} photos in ${((performance.now() - genStarted) / 1000).toFixed(0)} s, ${(readdirSync(root).length)} folders`)
  console.log(`[perf] machine: ${cpus()[0]?.model} · ${cpus().length} cores · ${Math.round(totalmem() / 2 ** 30)} GB`)

  const profile = tempFolder('perf-profile')
  try {
    // --- First scan ---
    let { app } = await launchApp(profile)
    let page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
    await app.evaluate(({ dialog }, chosen) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
    }, root)
    await startMainLagProbe(app)
    await startLongTaskProbe(page)

    let peakMemoryMb = 0
    const sampler = setInterval(() => {
      void app
        .evaluate(({ app: a }) => a.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0))
        .then((kb) => (peakMemoryMb = Math.max(peakMemoryMb, kb / 1024)))
        .catch(() => undefined)
    }, 500)

    const scanStarted = performance.now()
    await page.getByRole('button', { name: 'Add folder' }).click()
    await expect.poll(() => firstThumbnailShown(page), { timeout: 120_000, intervals: [100] }).toBe(true)
    const firstBatch = (performance.now() - scanStarted) / 1000
    await expect(page.locator('p', { hasText: `Collection · ${COUNT} photos` })).toBeVisible({ timeout: 60 * 60_000 })
    const fullScan = (performance.now() - scanStarted) / 1000
    clearInterval(sampler)
    const mainLagScan = await readMainLag(app)
    const longTaskScan = await readLongTask(page)

    // Scrolling the whole grid.
    await startLongTaskProbe(page)
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => document.getElementById('main')!.scrollBy(0, 2000))
      await page.waitForTimeout(50)
    }
    const longTaskScroll = await readLongTask(page)
    // Control: block the page on purpose for 200 ms; the observer must see it, or "0 ms" above would mean nothing.
    await startLongTaskProbe(page)
    await page.evaluate(() => {
      setTimeout(() => {
        const end = performance.now() + 200
        while (performance.now() < end) {
          // deliberately busy
        }
      }, 0)
    })
    await page.waitForTimeout(600)
    const control = await readLongTask(page)
    expect(control).toBeGreaterThanOrEqual(150)
    await app.close()

    const cacheMb = folderBytes(join(profile, 'thumbnails')) / 2 ** 20

    // --- Warm gallery: relaunch with everything catalogued ---
    ;({ app } = await launchApp(profile))
    page = await app.firstWindow()
    const warmStarted = performance.now()
    await expect.poll(() => firstThumbnailShown(page), { timeout: 30_000, intervals: [50] }).toBe(true)
    const warm = (performance.now() - warmStarted) / 1000
    await app.close()

    const verdict = (ok: boolean) => (ok ? 'within budget' : 'OVER budget')
    console.log(`[perf] first browsable photo: ${firstBatch.toFixed(2)} s (budget 10 s, ${verdict(firstBatch <= 10)})`)
    console.log(`[perf] full scan: ${fullScan.toFixed(1)} s, ${(COUNT / fullScan).toFixed(1)} photos/s`)
    console.log(`[perf] main process longest stall during scan: ${mainLagScan.toFixed(0)} ms (budget 100 ms, ${verdict(mainLagScan <= 100)})`)
    console.log(`[perf] UI longest task during scan: ${longTaskScan.toFixed(0)} ms; while scrolling: ${longTaskScroll.toFixed(0)} ms (budget 100 ms, ${verdict(Math.max(longTaskScan, longTaskScroll) <= 100)}; tasks under 50 ms aren't reported, and a deliberate 200 ms block was recorded as ${control.toFixed(0)} ms)`)
    console.log(`[perf] warm gallery (launch to first thumbnail): ${warm.toFixed(2)} s (budget 2 s, ${verdict(warm <= 2)})`)
    console.log(`[perf] peak memory, all processes: ${peakMemoryMb.toFixed(0)} MB; thumbnail cache: ${cacheMb.toFixed(0)} MB`)
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  }
})
