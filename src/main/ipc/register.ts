import { app, ipcMain } from 'electron'
import { commands, type CommandName } from '@shared/ipc-contract'
import { channelFor } from '@shared/ipc-channels'
import { createRouter, type Handlers } from './router'

const handlers: Handlers = {
  'app:getInfo': () => ({ name: app.getName(), version: app.getVersion() }),
}

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
