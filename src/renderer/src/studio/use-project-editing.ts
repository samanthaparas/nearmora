/**
 * Loads a Memory Studio project and keeps its design, undo list and saving in step. Every edit is shown and saved at
 * once as a whole design, including each moment of a drag, pinch or typing, so quitting never loses an edit; a whole
 * gesture still becomes one undo step once it pauses. If a save fails, the project is reloaded as saved, so the screen
 * never shows unsaved work as safe.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { designOf, sameDesign, type Design } from '@shared/studio/design'
import * as History from './design-history'

export type Project = CommandOutput<'projects:get'>

/** How long a drag, pinch or burst of typing must pause before it becomes one undo step. */
const SETTLE_MS = 300

// Text fields keep ⌘Z for their own typing; everywhere else on the editor screen it undoes the last edit.
const typing = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && ['text', 'search', 'number'].includes(target.type))

export function useProjectEditing(projectId: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [history, setHistoryState] = useState<History.History | null>(null)
  const [status, setStatus] = useState('All changes saved')
  // Mirrors of state for timers and the unmount flush, which run outside a render.
  const historyRef = useRef<History.History | null>(null)
  const gesture = useRef<{ base: History.Entry; label: string; timer: number } | null>(null)
  const latestSave = useRef(0)
  // True while a drag, pinch or typing burst hasn't yet become an undo step: Undo is still offered (it closes it first).
  const [gesturing, setGesturing] = useState(false)

  const setHistory = (next: History.History) => {
    historyRef.current = next
    setHistoryState(next)
  }

  // State is set in the promise callback, after main replies, never synchronously inside an effect.
  const load = useCallback(
    () =>
      window.nearmora.getProject({ projectId }).then((result) => {
        if (!result.ok) return setStatus('This project couldn’t be opened.')
        setProject(result.data)
        const fresh = History.startHistory(designOf(result.data))
        historyRef.current = fresh
        setHistoryState(fresh)
      }),
    [projectId],
  )
  useEffect(() => {
    void load()
  }, [load])

  // ⌘Z undoes and ⇧⌘Z redoes (Ctrl on other systems) while the editor is open, wherever the focus is.
  const shortcuts = useRef({ undo: () => {}, redo: () => {} })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || typing(event.target)) return
      event.preventDefault()
      if (event.shiftKey) shortcuts.current.redo()
      else shortcuts.current.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Saves run in order in main; only the newest reply refreshes the photo details (sizes, offline names).
  async function save(design: Design, message: string) {
    const ticket = ++latestSave.current
    const result = await window.nearmora.setProjectDesign({ projectId, design })
    if (!result.ok) {
      setStatus('That change couldn’t be saved, so the project is shown as it was last saved.')
      return void load()
    }
    if (ticket === latestSave.current) setProject(result.data)
    setStatus(`${message}. All changes saved.`)
  }

  // Ends a drag, pinch or burst of typing: it becomes one undo step. (Each change in it was already saved.)
  function settle() {
    const pending = gesture.current
    const current = historyRef.current
    if (!pending || !current) return
    window.clearTimeout(pending.timer)
    gesture.current = null
    setGesturing(false)
    setHistory(History.record(current, current.present.design, pending.label, pending.base))
  }

  /** An edit made in one step (a button or choice): shown, added to undo and saved. */
  function change(next: Design, label: string) {
    settle()
    const current = historyRef.current
    if (!current || sameDesign(current.present.design, next)) return
    setHistory(History.record(current, next, label))
    void save(next, label)
  }

  /**
   * Part of a drag, pinch or typing: shown and saved at once, so quitting mid-gesture never loses it. The whole gesture
   * becomes one undo step once it pauses.
   */
  function live(next: Design, label: string) {
    const current = historyRef.current
    if (!current) return
    if (gesture.current && gesture.current.label !== label) settle()
    const base = gesture.current?.base ?? historyRef.current!.present
    if (gesture.current) window.clearTimeout(gesture.current.timer)
    gesture.current = { base, label, timer: window.setTimeout(settle, SETTLE_MS) }
    if (sameDesign(historyRef.current!.present.design, next)) return
    setGesturing(true)
    setHistory(History.preview(historyRef.current!, next))
    void save(next, label)
  }

  function undo() {
    settle()
    const current = historyRef.current
    if (!current || current.past.length === 0) return
    const next = History.undo(current)
    setHistory(next)
    void save(next.present.design, `Undone: ${current.present.label.toLowerCase()}`)
  }

  function redo() {
    settle()
    const current = historyRef.current
    if (!current || current.future.length === 0) return
    const next = History.redo(current)
    setHistory(next)
    void save(next.present.design, `Redone: ${next.present.label.toLowerCase()}`)
  }

  useEffect(() => {
    shortcuts.current = { undo, redo }
  })

  return {
    project,
    setProject,
    design: history?.present.design ?? null,
    canUndo: (history?.past.length ?? 0) > 0 || gesturing,
    canRedo: (history?.future.length ?? 0) > 0,
    status,
    setStatus,
    change,
    live,
    undo,
    redo,
  }
}
