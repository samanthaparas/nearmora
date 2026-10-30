/**
 * The editor's undo and redo list. Each entry is a whole project design plus the name of the edit that produced it,
 * so undo can say what it undid. Pure functions with no React, so the rules are unit-tested on their own.
 */

import { sameDesign, type Design } from '@shared/studio/design'

export interface Entry {
  design: Design
  /** What made this state, such as "Background changed"; shown when it's undone or redone. */
  label: string
}

export interface History {
  past: Entry[]
  present: Entry
  future: Entry[]
}

/** Enough to step back through a long session without the list growing forever. */
export const HISTORY_LIMIT = 100

export const startHistory = (design: Design): History => ({ past: [], present: { design, label: 'Opened' }, future: [] })

/**
 * Adds an edit. `base` is the state before the edit: the current one, or where a drag or pinch began. An edit that
 * ends where it started adds nothing, and any new edit clears the redo list, as in every editor.
 */
export function record(history: History, next: Design, label: string, base: Entry = history.present): History {
  if (sameDesign(base.design, next)) return { ...history, present: base }
  return { past: [...history.past, base].slice(-HISTORY_LIMIT), present: { design: next, label }, future: [] }
}

/** Shows a design while a drag or pinch is still going, without adding to the list yet. */
export const preview = (history: History, next: Design): History => ({ ...history, present: { ...history.present, design: next } })

export function undo(history: History): History {
  const previous = history.past.at(-1)
  if (!previous) return history
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
}

export function redo(history: History): History {
  const [next, ...rest] = history.future
  if (!next) return history
  return { past: [...history.past, history.present], present: next, future: rest }
}
