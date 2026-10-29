/**
 * Entry point of the media worker: a separate process that decodes photos with sharp.
 * If a damaged file hangs or crashes the decoder, only this process dies; the main process kills and restarts it.
 */

import { makePreview, processImage, type PreviewRequest, type ProcessImageRequest } from './media/process-image'
import { renderCanvas, type RenderRequest } from './media/render-export'

type WorkerMessage =
  | { id: number; kind: 'process'; request: ProcessImageRequest }
  | { id: number; kind: 'preview'; request: PreviewRequest }
  | { id: number; kind: 'render'; request: RenderRequest }

// `process.parentPort` exists only inside an Electron utility process.
const port = process.parentPort
port.on('message', (event: { data: WorkerMessage }) => {
  const message = event.data
  const work =
    message.kind === 'preview' ? makePreview(message.request) : message.kind === 'render' ? renderCanvas(message.request) : processImage(message.request)
  void work.then(
    (result) => port.postMessage({ id: message.id, result }),
    () => port.postMessage({ id: message.id, result: { ok: false, reason: 'corrupt' } }),
  )
})
