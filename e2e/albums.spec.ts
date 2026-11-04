/**
 * End-to-end test of albums (AC12) in the built app: select photos, add them to a new album, rearrange it with
 * the keyboard only, undo, rename, restart, leave an album or moment from the sidebar, delete and undo the delete, with every original photo unchanged.
 */

import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { generatePhotoFolder } from '../tests/support/generate-photos'
import { fingerprintFolder } from '../tests/support/originals-guard'
import { launchApp, tempFolder } from './launch'

// Picture ids in the order the album grid shows them (by aria-posinset, since cells are positioned absolutely).
async function albumOrder(page: Page): Promise<string[]> {
  return page.locator('.library__cell').evaluateAll((cells) =>
    cells
      .map((cell) => ({
        position: Number(cell.getAttribute('aria-posinset')),
        id: (cell.querySelector('img')?.getAttribute('src') ?? '').replace('nm-media://thumb/', ''),
      }))
      .sort((a, b) => a.position - b.position)
      .map((cell) => cell.id),
  )
}

const focusedKey = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('data-focus-key') ?? null)

test('albums: add, rearrange by keyboard, undo, rename, restart, delete and undo, with originals untouched', async () => {
  const folder = await generatePhotoFolder(join(tempFolder('photos'), 'Summer'))
  const before = fingerprintFolder(folder.root)
  const profile = tempFolder('profile')

  let { app } = await launchApp(profile)
  let page = await app.firstWindow()
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, folder.root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.locator('p', { hasText: 'Summer · 5 photos' })).toBeVisible({ timeout: 20_000 })

  // Select three photos and put them in a new album.
  await page.getByRole('button', { name: 'Select photos' }).click()
  const selectable = page.getByRole('button', { name: /^Select: / })
  for (let i = 0; i < 3; i++) await selectable.nth(i).click()
  await expect(page.getByText('3 photos selected')).toBeVisible()
  await expect(selectable.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Add to album…' }).click()
  const panel = page.getByRole('group', { name: 'Add 3 photos to an album' })
  await panel.getByLabel('Or a new album').fill('Beach day')
  await panel.getByRole('button', { name: 'Create album' }).click()
  await expect(page.getByText('Added 3 photos to “Beach day”.')).toBeVisible()

  const albums = page.getByRole('region', { name: 'Albums' })
  await albums.getByRole('button', { name: /Beach day/ }).click()
  await expect(page.getByRole('list', { name: 'Photos in Beach day, 3 in total' })).toBeVisible()
  const original = await albumOrder(page)
  expect(original).toHaveLength(3)

  // Choosing Library in the sidebar from an open album, or an open moment, goes back to all photos.
  const library = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Library' })
  const back = page.getByRole('button', { name: '← All photos' })
  await expect(back).toBeVisible()
  await library.click()
  await expect(back).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Photos, 5 in total' })).toBeVisible()
  await page.getByRole('region', { name: 'Your moments' }).getByRole('button').first().click()
  await expect(back).toBeVisible()
  await library.click()
  await expect(back).toHaveCount(0)
  await albums.getByRole('button', { name: /Beach day/ }).click()
  await expect(page.getByRole('list', { name: 'Photos in Beach day, 3 in total' })).toBeVisible()

  // Rearrange with the keyboard only: focus the first photo's "Move later" and press Return twice.
  await page.getByRole('button', { name: 'Arrange' }).click()
  await page.locator(`[data-focus-key="${original[0]}:later"]`).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => albumOrder(page)).toEqual([original[1], original[0], original[2]])
  // Focus follows the photo, so pressing Return again keeps moving the same one.
  await expect.poll(() => focusedKey(page)).toBe(`${original[0]}:later`)
  await page.keyboard.press('Enter')
  await expect.poll(() => albumOrder(page)).toEqual([original[1], original[2], original[0]])

  // Undo the last move.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => albumOrder(page)).toEqual([original[1], original[0], original[2]])

  // Rename.
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByLabel('Album name').fill('Beach weekend')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Beach weekend' })).toBeVisible()
  await app.close()

  // After a restart: same name, same order.
  ;({ app } = await launchApp(profile))
  page = await app.firstWindow()
  await page.getByRole('region', { name: 'Albums' }).getByRole('button', { name: /Beach weekend/ }).click()
  await expect.poll(() => albumOrder(page)).toEqual([original[1], original[0], original[2]])

  // Delete asks first ("Keep album" is the default), then can be undone.
  await page.getByRole('button', { name: 'Delete album…' }).click()
  await expect(page.getByRole('button', { name: 'Keep album' })).toBeFocused()
  await page.getByRole('button', { name: 'Delete album', exact: true }).click()
  await expect(page.getByText('Deleted the album “Beach weekend”.', { exact: false })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Albums' }).getByRole('button', { name: /Beach weekend/ })).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Photos, 5 in total' })).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('region', { name: 'Albums' }).getByRole('button', { name: /Beach weekend/ }).click()
  await expect.poll(() => albumOrder(page)).toEqual([original[1], original[0], original[2]])
  await app.close()

  expect(fingerprintFolder(folder.root)).toEqual(before)
})
