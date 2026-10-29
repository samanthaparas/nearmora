/**
 * Entry point of the media worker: a separate process that decodes photos with sharp.
 * If a damaged file hangs or crashes the decoder, only this process dies; the main process kills and restarts it.
 */

import { processImage, type ProcessImageRequest } from './media/process-image'

interface WorkerMessage {
  id: number
  request: ProcessImageRequest
}

// `process.parentPort` exists only inside an Electron utility process.
const port = process.parentPort
port.on('message', (event: { data: WorkerMessage }) => {
  const { id, request } = event.data
  void processImage(request).then(
    (result) => port.postMessage({ id, result }),
    () => port.postMessage({ id, result: { ok: false, reason: 'corrupt' } }),
  )
})
