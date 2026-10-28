/**
 * Connects the router to Electron's IPC system and holds the handler for each command.
 * When a new capability is added, its handler goes here.
 */

import { app, ipcMain } from 'electron'
import { commands, type CommandName } from '@shared/ipc-contract'
import { channelFor } from '@shared/ipc-channels'
import { createRouter, type Handlers } from './router'

// One handler per command in ipc-contract.ts. The Handlers type makes a missing one a compile error.
const handlers: Handlers = {
  'app:getInfo': () => ({ name: app.getName(), version: app.getVersion() }),
}

// Wires each command to an IPC channel. Every call goes through the router's checks first.
export function registerIpc(isTrustedSender: (url: string | undefined) => boolean): void {
  const dispatch = createRouter({
    handlers,
    isTrustedSender,
    logError: (command, code) => console.warn(`[ipc] ${command} rejected: ${code}`),
  })

  for (const command of Object.keys(commands) as CommandName[]) {
    // senderFrame is the frame that sent the message; it can be null if that
    // frame has already navigated away or been destroyed.
    ipcMain.handle(channelFor(command), (event, payload: unknown) =>
      dispatch(command, event.senderFrame?.url, payload),
    )
  }
}
