/**
 * The main process's side of the media worker: sends it photos to process and enforces a time limit on each.
 * A photo that takes too long is counted as unreadable and the worker is restarted, so one bad file can't stall a scan.
 */

import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { PreviewRequest, ProcessImageRequest, ProcessImageResult } from './process-image'

const TIMEOUT_MS = 30_000

interface Pending {
  resolve: (result: ProcessImageResult | { ok: boolean }) => void
  timer: NodeJS.Timeout
}

export class MediaWorker {
  private child: UtilityProcess | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  // Starts the worker on first use. It's a separate process with no access to the UI.
  private ensureChild(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(join(__dirname, 'media-worker.js'), [], { serviceName: 'Nearmora Media Worker' })
    child.on('message', (message: { id: number; result: ProcessImageResult | { ok: boolean } }) => {
      const entry = this.pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer)
      this.pending.delete(message.id)
      entry.resolve(message.result)
    })
    // If the worker dies, everything it was working on fails as unreadable and the next request starts a new one.
    child.on('exit', () => {
      if (this.child === child) this.child = undefined
      this.failAll()
    })
    this.child = child
    return child
  }

  private failAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, reason: 'corrupt' })
      this.pending.delete(id)
    }
  }

  process(request: ProcessImageRequest): Promise<ProcessImageResult> {
    return this.send('process', request) as Promise<ProcessImageResult>
  }

  /** Makes a larger preview for comparing photos. Resolves { ok: false } on any failure, including a timeout. */
  preview(request: PreviewRequest): Promise<{ ok: boolean }> {
    return this.send('preview', request)
  }

  private send(kind: 'process' | 'preview', request: ProcessImageRequest | PreviewRequest): Promise<ProcessImageResult | { ok: boolean }> {
    const child = this.ensureChild()
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Killing the process also fails any other photo it was processing; they'll be retried on the next scan.
        this.pending.delete(id)
        resolve({ ok: false, reason: 'corrupt' })
        child.kill()
      }, TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      child.postMessage({ id, kind, request })
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = undefined
    this.failAll()
  }
}
