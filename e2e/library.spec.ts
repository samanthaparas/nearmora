/**
 * End-to-end test of the R3a slice in the real built app: add a folder, watch it scan, see thumbnails,
 * restart and see them again, with the originals proven unchanged. Only the macOS folder picker is replaced.
 */

import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { generatePhotoFolder, type GeneratedFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

let folder: GeneratedFolder
let profileDir: string

// Replaces the folder picker (an OS dialog Playwright can't click) with one that "chooses" `path`.
async function pickFolderNextTime(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve(chosen ? { canceled: false, filePaths: [chosen] } : { canceled: true, filePaths: [] })
  }, path)
}

async function loadedThumbnails(page: Page): Promise<number> {
  return page.locator('.library__thumb').evaluateAll((images) =>
    images.filter((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0).length,
  )
}

test.beforeAll(async () => {
  folder = await generatePhotoFolder(join(tempFolder('photos'), 'Summer'))
  profileDir = tempFolder('profile')
})

test('adding a folder scans it, shows thumbnails, explains skipped files and changes no originals', async () => {
  const before = fingerprintFolder(folder.root)
  const { app } = await launchApp(profileDir)
  const page = await app.firstWindow()

  // Cancelling the picker changes nothing.
  await pickFolderNextTime(app, null)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a folder to get started.' })).toBeVisible()

  await pickFolderNextTime(app, folder.root)
  await page.getByRole('button', { name: 'Add folder' }).click()

  const grid = page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos} in total` })
  await expect(grid).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(`${folder.expected.distinctPhotos} photos · 1 identical copy`, { exact: false })).toBeVisible()
  await expect(page.getByText('4 files were skipped: 2 aren’t JPEGs or PNGs; 2 are damaged or couldn’t be decoded.', { exact: false })).toBeVisible()
  await expect.poll(() => loadedThumbnails(page)).toBe(folder.expected.distinctPhotos)
  await expect(page.getByRole('img', { name: /Photo from/ }).first()).toBeVisible()

  // The same folder again, or one inside it, is refused with an explanation.
  await pickFolderNextTime(app, join(folder.root, 'nested'))
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('alert')).toContainText('already added')

  await app.close()
  expect(fingerprintFolder(folder.root)).toEqual(before)
})

test('after a restart the photos are still there, without rescanning', async () => {
  const { app } = await launchApp(profileDir)
  const page = await app.firstWindow()
  await expect(page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos} in total` })).toBeVisible()
  await expect.poll(() => loadedThumbnails(page)).toBe(folder.expected.distinctPhotos)
  await app.close()
})
