/**
 * Asked when leaving a set with unsaved choices: Save, Discard changes, or Continue reviewing.
 * A real modal: focus moves into it, Tab stays inside it, Escape means "continue", and focus returns afterwards.
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'

export function UnsavedChangesDialog({ onSave, onDiscard, onContinue }: { onSave: () => void; onDiscard: () => void; onContinue: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    // Give focus back to whatever had it before the dialog opened.
    return () => previous?.focus()
  }, [])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onContinue()
      return
    }
    if (event.key !== 'Tab') return
    // Keep Tab and Shift+Tab cycling inside the dialog.
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const first = buttons[0]
    const last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-body" onKeyDown={onKeyDown}>
        <h2 id="unsaved-title" className="dialog__title">
          Save your choices?
        </h2>
        <p id="unsaved-body">You picked favorites in this set but haven’t saved them.</p>
        <div className="library__source-actions">
          <button type="button" className="button button--primary" onClick={onSave}>
            Save
          </button>
          <button type="button" className="button button--secondary" onClick={onDiscard}>
            Discard changes
          </button>
          <button type="button" className="button button--quiet" onClick={onContinue}>
            Continue reviewing
          </button>
        </div>
      </div>
    </div>
  )
}
