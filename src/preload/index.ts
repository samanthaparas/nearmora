import { contextBridge, ipcRenderer } from 'electron'
import type { NearmoraApi } from '@shared/bridge-api'
import { channelFor } from '@shared/ipc-channels'

/**
 * The preload runs in an isolated, sandboxed context before the page loads.
 * It exposes a fixed set of named functions, never `ipcRenderer` itself,
 * so the page can only ask for things we've deliberately allowed.
 */
const api: NearmoraApi = {
  getAppInfo: () => ipcRenderer.invoke(channelFor('app:getInfo')),
}

contextBridge.exposeInMainWorld('nearmora', Object.freeze(api))
