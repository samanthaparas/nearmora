/**
 * Picks a colour for the background or the photo border: one-click named swatches, plus "Other colour" for any colour
 * from the system picker. Swatches are radio buttons with their names, so the choice works by keyboard and VoiceOver.
 */

import { useId } from 'react'

export function ColourChoice({ legend, swatches, value, onPick, onLive, disabled = false }: {
  legend: string
  swatches: Readonly<Record<string, string>>
  value: string
  /** A swatch was chosen: one edit. */
  onPick: (colour: string, name: string) => void
  /** The system colour picker is moving: shown live and saved once it pauses. */
  onLive: (colour: string) => void
  disabled?: boolean
}) {
  const name = useId()
  const named = Object.entries(swatches).find(([, colour]) => colour.toLowerCase() === value.toLowerCase())?.[0]
  return (
    <fieldset className="studio__choice" disabled={disabled}>
      <legend>{legend}</legend>
      {Object.entries(swatches).map(([label, colour]) => (
        <label key={label} className="library__check">
          <input type="radio" name={name} checked={named === label} onChange={() => onPick(colour, label)} />
          <span className="studio__swatch" style={{ background: colour }} aria-hidden="true" />
          <span>{label[0]!.toUpperCase() + label.slice(1)}</span>
        </label>
      ))}
      <label className="library__check">
        <input type="color" value={value} onChange={(e) => onLive(e.target.value)} />
        <span>{named ? 'Other colour' : `Other colour (${value})`}</span>
      </label>
    </fieldset>
  )
}
