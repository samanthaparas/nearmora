/**
 * Chooses a different favorite to put in one photo's place. Photos already in the project aren't offered, because
 * each photo appears once. The new photo starts centred; its place keeps its fit.
 */

import { useEffect, useState } from 'react'
import { altFor, type Photo } from '../library/PhotoGrid'

// Enough for choosing a replacement; the full list lives on the Favorites screen.
const LIMIT = 200

export function ReplacePhoto({ position, exclude, onChoose, onCancel }: {
  position: number
  exclude: readonly string[]
  onChoose: (assetId: string) => void
  onCancel: () => void
}) {
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void window.nearmora.queryLibrary({ limit: LIMIT, filters: { favoritesOnly: true } }).then((result) => {
      if (result.ok) setPhotos(result.data.items)
      else setFailed(true)
    })
  }, [])

  const choices = photos?.filter((p) => !exclude.includes(p.id)) ?? []
  return (
    <div className="library__confirm" role="group" aria-labelledby="replace-title">
      <p id="replace-title" className="library__confirm-title">
        Replace photo {position + 1} with a favorite
      </p>
      {failed ? <p className="review__note">Favorites couldn’t be loaded.</p> : null}
      {photos && choices.length === 0 ? <p className="review__note">Every favorite is already in this project. Mark more favorites to have more to choose from.</p> : null}
      <ul className="studio__replace">
        {choices.map((photo) => (
          <li key={photo.id}>
            <button type="button" className="strip__item" aria-label={`Use ${altFor(photo).replace(/^Photo/, 'photo')}`} onClick={() => onChoose(photo.id)}>
              <img src={`nm-media://thumb/${photo.id}`} alt="" />
            </button>
          </li>
        ))}
      </ul>
      <div className="library__source-actions">
        <button type="button" className="button button--secondary" autoFocus onClick={onCancel}>
          Keep this photo
        </button>
      </div>
    </div>
  )
}
