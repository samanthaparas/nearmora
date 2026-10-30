/**
 * A small real volume for tests: a disk image the test creates, mounts and ejects itself (macOS only).
 * Used to fill a drive up (export) and to unplug one mid-scan, without touching any real disk.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

export function createDiskImage(workDir: string, sizeMb: number, name: string): { image: string; mount: string; attach: () => void; eject: () => Promise<void> } {
  const image = join(workDir, `${name}.dmg`)
  const mount = join(workDir, 'mnt')
  mkdirSync(mount)
  execFileSync('hdiutil', ['create', '-size', `${sizeMb}m`, '-fs', 'HFS+', '-volname', name, image], { stdio: 'ignore' })
  return {
    image,
    mount,
    attach: () => execFileSync('hdiutil', ['attach', image, '-nobrowse', '-mountpoint', mount], { stdio: 'ignore' }),
    /**
     * Ejects, retrying for up to about 30 seconds while macOS reports the volume busy (the image library still holds
     * a file open, or Spotlight is briefly indexing the new volume). Alternates hdiutil with diskutil's forced unmount,
     * and stops as soon as the volume is no longer mounted, even if the command that unmounted it reported an error.
     */
    eject: async () => {
      sharp.cache(false) // libvips caches open files; release them so nothing keeps the volume busy
      const commands: Array<[string, string[]]> = [
        ['hdiutil', ['detach', mount, '-force']],
        ['diskutil', ['unmount', 'force', mount]],
      ]
      let lastError: unknown
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!isMounted(mount)) return
        const [command, args] = commands[attempt % commands.length]!
        try {
          execFileSync(command, args, { stdio: 'ignore' })
        } catch (error: unknown) {
          lastError = error
        }
        if (!isMounted(mount)) return
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      throw new Error(`Could not eject the test volume at ${mount}`, { cause: lastError })
    },
  }
}

// Whether anything is mounted at this folder, read from the system's mount table (the temp folder is a symlink, so
// both its spellings are checked).
function isMounted(mount: string): boolean {
  const table = execFileSync('mount', { encoding: 'utf8' })
  return [mount, realpathSync(mount)].some((path) => table.includes(` on ${path} (`))
}
