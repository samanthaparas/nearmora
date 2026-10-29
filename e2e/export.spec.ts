/**
 * End-to-end test of export in the built app (AC7, AC8): the panel says what will be made, a destination inside a
 * photo folder is refused with a reason, an export finishes into a fresh folder with the right files, and a second
 * export never overwrites the first. Only the macOS folder pickers are replaced.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { generateBurstFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()

async function pickFolderNextTime(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}

test('export a carousel: explained up front, refused inside a photo folder, then written to fresh folders', async () => {
  const { root } = await generateBurstFolder(join(tempFolder('photos'), 'Burst'), 3)
  const before = fingerprintFolder(root)
  const { app } = await launchApp(tempFolder('profile'))
  const page = await app.firstWindow()

  await pickFolderNextTime(app, root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Burst · 4 photos' })).toBeVisible({ timeout: 20_000 })
  await nav(page, 'Best Moments')
  await page.locator('.moments__card').first().click()
  await page.getByRole('button', { name: 'Favorite all' }).click()
  await page.getByRole('button', { name: 'Save choices' }).click()
  await expect(page.getByText('Saved: 3 favorites.')).toBeVisible()

  await nav(page, 'Favorites')
  const pick = page.getByRole('button', { name: /^Select: / })
  for (let i = 0; i < 3; i++) await pick.nth(i).click()
  await page.getByRole('button', { name: /Carousel/ }).click()
  const panel = page.getByRole('region', { name: 'Export' })
  await expect(panel).toContainText('JPEG, 1080 × 1080 pixels, 3 files')
  await expect(panel).toContainText('doesn’t change your photos, publish or share anything')

  // Choosing the photo folder itself as the destination is refused, and nothing is written there.
  await pickFolderNextTime(app, root)
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel.getByRole('alert')).toContainText('inside one of your photo folders')

  const destination = tempFolder('exports')
  await pickFolderNextTime(app, destination)
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel).toContainText('Exported 3 files to “Nearmora Carousel', { timeout: 30_000 })
  // A second export goes to a new "(2)" folder. Wait for its message: while it runs, its hidden staging folder
  // also sits in the destination, so counting entries would be misleading.
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(panel).toContainText(/Exported 3 files to “Nearmora Carousel .* \(2\)”/, { timeout: 30_000 })
  await app.close()

  const folders = readdirSync(destination).sort()
  expect(folders[0]).toMatch(/^Nearmora Carousel \d{4}-\d{2}-\d{2}$/)
  expect(folders[1]).toMatch(/^Nearmora Carousel \d{4}-\d{2}-\d{2} \(2\)$/)
  const files = readdirSync(join(destination, folders[0]!)).sort()
  expect(files).toEqual(['Carousel 01.jpg', 'Carousel 02.jpg', 'Carousel 03.jpg'])
  for (const file of files) {
    const meta = await sharp(join(destination, folders[0]!, file)).metadata()
    expect({ format: meta.format, width: meta.width, height: meta.height, exif: meta.exif }).toEqual({ format: 'jpeg', width: 1080, height: 1080, exif: undefined })
  }
  expect(fingerprintFolder(root)).toEqual(before)
})
