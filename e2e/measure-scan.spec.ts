/**
 * Scan timing through the real app and its media worker (`npm run measure:scan`). Skipped in normal test runs.
 * It times the real fixture pack, if present, and 1,000 generated 3-megapixel JPEGs, then a rescan of each.
 * Results are printed for the evidence notes; nothing is asserted about speed.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { launchApp, tempFolder } from './launch'

test.skip(!process.env['NEARMORA_MEASURE'], 'Run with npm run measure:scan')
test.setTimeout(30 * 60_000)

const PACK = resolve('fixtures/private/Nearmora-Real-Photo-Fixtures-88/photos')

// Noise compresses badly, so these files are realistically large (about 1.7 MB) for their pixel count.
async function generateLargePhotos(dir: string, count: number): Promise<void> {
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i++) {
    await sharp({ create: { width: 2016, height: 1512, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 100 + (i % 50), sigma: 40 } } })
      .jpeg({ quality: 85 })
      .toFile(join(dir, `IMG_${String(i).padStart(4, '0')}.jpg`))
  }
}

// Seconds until the scan of the only source reports done.
async function timeScan(page: Page, start: () => Promise<unknown>): Promise<number> {
  const started = performance.now()
  await start()
  await expect
    .poll(async () => page.evaluate(async () => {
      const result = await window.nearmora.listSources()
      const source = result.ok ? result.data[0] : undefined
      return source && !source.scanning ? source.lastScanState : 'running'
    }), { timeout: 25 * 60_000, intervals: [100] })
    .toBe('done')
  return (performance.now() - started) / 1000
}

async function measure(folder: string, label: string): Promise<void> {
  const { app } = await launchApp()
  const page = await app.firstWindow()
  await pickFolder(app, folder)
  const first = await timeScan(page, () => page.getByRole('button', { name: 'Add folder' }).click())
  const sourceId = await page.evaluate(async () => {
    const result = await window.nearmora.listSources()
    return result.ok ? result.data[0]!.id : ''
  })
  const rescan = await timeScan(page, () => page.evaluate((id) => window.nearmora.rescanSource({ sourceId: id }), sourceId))
  const total = await page.evaluate(async () => {
    const result = await window.nearmora.queryLibrary({ offset: 0, limit: 1 })
    return result.ok ? result.data.total : -1
  })
  await app.close()
  console.log(`[measure] ${label}: ${total} pictures · first scan ${first.toFixed(2)} s · rescan ${rescan.toFixed(2)} s`)
}

async function pickFolder(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}

test('scan baseline', async () => {
  console.log(`[measure] ${cpus()[0]?.model ?? 'unknown CPU'} · ${cpus().length} cores · ${Math.round(totalmem() / 2 ** 30)} GB · ${process.platform}`)
  if (existsSync(PACK)) await measure(PACK, 'real fixture pack (88 files)')

  const generated = join(tempFolder('measure'), 'Generated')
  try {
    await generateLargePhotos(generated, 1000)
    await measure(generated, '1,000 generated 3 MP JPEGs')
  } finally {
    rmSync(generated, { recursive: true, force: true })
  }
})
