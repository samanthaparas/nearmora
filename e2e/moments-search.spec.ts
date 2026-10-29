/**
 * End-to-end tests for R3b part 2 in the built app: date moments (rename and cover, kept after restart),
 * search and filters with a no-results state, and a virtualized grid that stays small with 1,200 photos.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import sharp from 'sharp'
import { generatePhotoFolder, type GeneratedFolder } from '../tests/support/generate-photos'
import { launchApp, tempFolder } from './launch'

let folder: GeneratedFolder
let profileDir: string

async function pickFolderNextTime(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}

async function addFolder(app: ElectronApplication, page: Page, path: string, photos: number): Promise<void> {
  await pickFolderNextTime(app, path)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('list', { name: `Photos, ${photos} in total` })).toBeVisible({ timeout: 60_000 })
}

test.beforeAll(async () => {
  folder = await generatePhotoFolder(join(tempFolder('photos'), 'Summer'))
  profileDir = tempFolder('profile')
})

test('moments group photos by date, and a renamed title and chosen cover survive a restart', async () => {
  let { app } = await launchApp(profileDir)
  let page = await app.firstWindow()
  await addFolder(app, page, folder.root, folder.expected.distinctPhotos)

  const moments = page.getByRole('region', { name: 'Your moments' })
  await expect(moments).toBeVisible()
  // The generated photos fall on three separate dates: 2 January 2023, 6 May 2024, and today (file dates).
  await expect(moments.getByRole('listitem')).toHaveCount(3)
  await moments.getByRole('button', { name: /2023/ }).click()
  await expect(page.getByRole('list', { name: 'Photos in this moment, 1 in total' })).toBeVisible()

  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Moment title').fill('New Year walk')
  await page.getByRole('button', { name: 'Save title' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'New Year walk' })).toBeVisible()

  await page.getByRole('button', { name: 'Choose cover' }).click()
  await page.getByRole('button', { name: /^Use as cover/ }).first().click()
  await expect(page.getByRole('button', { name: 'Choose cover' })).toHaveAttribute('aria-pressed', 'false')
  await app.close()

  ;({ app } = await launchApp(profileDir))
  page = await app.firstWindow()
  await expect(page.getByRole('region', { name: 'Your moments' }).getByRole('button', { name: /New Year walk/ })).toBeVisible()
  await app.close()
})

test('search finds photos by folder name, explains when nothing matches, and clears', async () => {
  const { app } = await launchApp(profileDir)
  const page = await app.firstWindow()
  const search = page.getByRole('searchbox', { name: 'Search' })

  await search.fill('nested') // matches nested/nested.jpg and nested/deeper/deep.jpg
  await expect(page.getByRole('list', { name: 'Photos, 2 in total' })).toBeVisible()
  await search.fill('no-such-photo')
  await expect(page.getByText('No photos match these filters.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos} in total` })).toBeVisible()
  await app.close()
})

test('a 1,200-photo grid keeps only visible rows in the page and reaches the last photo by scrolling', async () => {
  test.setTimeout(180_000)
  const many = join(tempFolder('many'), 'Many')
  mkdirSync(many)
  for (let i = 0; i < 1200; i++) {
    // A unique colour per photo, saved as PNG: lossless, so all 1,200 stay distinct pictures. (As JPEGs, compression
    // made only 853 of them distinct, and identical bytes rightly count once.)
    await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: i % 256, g: Math.floor(i / 256) * 50, b: 128 } } })
      .png()
      .toFile(join(many, `img-${String(i).padStart(4, '0')}.png`))
  }

  const { app } = await launchApp(tempFolder('profile-many'))
  const page = await app.firstWindow()
  await addFolder(app, page, many, 1200)
  // Wait for the scan to finish: the folder's own status line (not the moment card) shows the final count.
  await expect(page.locator('p', { hasText: 'Many · 1200 photos' })).toBeVisible({ timeout: 120_000 })

  const cells = page.locator('.library__cell')
  expect(await cells.count()).toBeLessThan(200)

  // Scroll to the bottom repeatedly; pages load as the end comes near.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const main = document.getElementById('main')!
          main.scrollTop = main.scrollHeight
        })
        return page.locator('[aria-posinset="1200"]').count()
      },
      { timeout: 30_000 },
    )
    .toBe(1)
  expect(await cells.count()).toBeLessThan(200)
  await app.close()
})
