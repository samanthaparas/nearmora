/**
 * A small real volume for tests: a disk image the test creates, mounts and ejects itself (macOS only).
 * Used to fill a drive up (export) and to unplug one mid-scan, without touching any real disk.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
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
     * Ejects, retrying while macOS reports the volume busy ("resource busy", status 16), which happens when the
     * image library still holds a file open or the system is briefly indexing the new volume.
     */
    eject: async () => {
      sharp.cache(false) // libvips caches open files; release them so nothing keeps the volume busy
      for (let attempt = 1; ; attempt++) {
        try {
          execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' })
          return
        } catch (error: unknown) {
          if (attempt >= 10) throw error
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    },
  }
}
