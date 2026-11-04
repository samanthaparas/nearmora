/**
 * End-to-end test of Settings → Backup (AC11) in the built app: back up the catalog, change it, restore the backup
 * (the app restarts and restores before the catalog opens), find the change undone and a missing photo folder named,
 * then undo the restore. Also: a damaged backup is refused with nothing changed. Only the macOS dialogs are replaced,
 * and the app quits instead of relaunching itself, so the test starts it again.
 */

import { readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { generatePhotoFolder } from '../tests/support/generate-photos'
import { launchApp, tempFolder } from './launch'

const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name }).click()
const settings = (page: Page) => page.getByRole('button', { name: 'Settings', exact: true }).click()
async function pickFolderNextTime(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] })
  }, path)
}
const start = (profile: string) => launchApp(profile, [], { NEARMORA_NO_RELAUNCH: '1' })

test('back up, change, restore and restart, then undo the restore; a damaged backup changes nothing', async () => {
  const folder = await generatePhotoFolder(join(tempFolder('photos'), 'Summer'))
  const backups = tempFolder('backups')
  const profile = tempFolder('profile')
  let { app } = await start(profile)
  let page = await app.firstWindow()
  await pickFolderNextTime(app, folder.root)
  await page.getByRole('button', { name: 'Add folder' }).click()
  await expect(page.getByRole('list', { name: `Photos, ${folder.expected.distinctPhotos} in total` })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('New album name').fill('In the backup')
  await page.getByRole('button', { name: 'Create album' }).click()

  // Back up. It says what it kept, and that photos aren't in it.
  await settings(page)
  // Found again in each new window, since the app restarts during the test.
  const section = page.getByRole('region', { name: 'Backup' })
  await expect(section).toContainText('It doesn’t include your photos')
  await expect(section).toContainText('No backup made from this Mac yet.')
  await pickFolderNextTime(app, backups)
  await section.getByRole('button', { name: 'Back up the catalog…' }).click()
  await expect(section).toContainText('Backed up to “Nearmora catalog backup')
  await expect(section).toContainText('1 photo folder')
  await expect(section).toContainText('Last backup:')

  // Change the catalog after the backup.
  await nav(page, 'Library')
  await page.getByLabel('New album name').fill('Made afterwards')
  await page.getByRole('button', { name: 'Create album' }).click()
  await expect(page.getByText('Made afterwards')).toBeVisible()

  // Choose the backup: it's described first, and the photo folder that's gone is named. Cancel changes nothing.
  const [backup] = readdirSync(backups)
  renameSync(folder.root, `${folder.root}-away`) // the test's own folder, moved away for a moment
  await settings(page)
  await pickFolderNextTime(app, join(backups, backup!))
  await section.getByRole('button', { name: 'Restore from a backup…' }).click()
  const confirm = section.getByRole('group', { name: /^Restore the backup made on/ })
  await expect(confirm).toContainText('These photo folders from it aren’t on this Mac: Summer.')
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  renameSync(`${folder.root}-away`, folder.root)

  // Restore: the app restarts (here it quits, and the test starts it again) and restores before opening the catalog.
  await section.getByRole('button', { name: 'Restore from a backup…' }).click()
  const closed = app.waitForEvent('close')
  await confirm.getByRole('button', { name: 'Restore and restart' }).click()
  await closed
  ;({ app } = await start(profile))
  page = await app.firstWindow()
  await expect(page.getByText('In the backup')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Made afterwards')).toHaveCount(0)
  await settings(page)
  const restored = page.getByRole('region', { name: 'Backup' })
  await expect(restored).toContainText('Restored the catalog from the backup made on')

  // Undo the restore: the catalog from just before it comes back.
  const closedAgain = app.waitForEvent('close')
  await restored.getByRole('button', { name: 'Undo restore…' }).click()
  await closedAgain
  ;({ app } = await start(profile))
  page = await app.firstWindow()
  await expect(page.getByText('Made afterwards')).toBeVisible({ timeout: 20_000 })
  await settings(page)
  const undone = page.getByRole('region', { name: 'Backup' })
  await expect(undone).toContainText('The restore was undone.')
  await expect(undone.getByRole('button', { name: 'Undo restore…' })).toHaveCount(0)

  // A damaged backup is refused before anything changes.
  writeFileSync(join(backups, backup!, 'catalog.sqlite'), 'damaged') // the test's own backup
  await pickFolderNextTime(app, join(backups, backup!))
  await undone.getByRole('button', { name: 'Restore from a backup…' }).click()
  await expect(undone).toContainText('isn’t a Nearmora catalog backup, or the backup is damaged. Nothing was changed.')
  await expect(undone.getByRole('group', { name: /^Restore the backup/ })).toHaveCount(0)
  await app.close()
})
