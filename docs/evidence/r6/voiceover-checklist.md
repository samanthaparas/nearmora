# VoiceOver and offline checklist (R6, AC9 and AC10)

Automated checks (axe, keyboard tests, 200% zoom) can't tell whether Nearmora is actually usable with a screen reader. This walk-through is the human check AC10 asks for. It takes about 20–30 minutes.

**Setup**
- Use a folder of a few test photos, such as the fixture pack's `photos/` folder or a generated folder.
- Turn VoiceOver on and off with **⌘ F5**.
- Move with **VO = Control + Option**: **VO + →/←** moves item by item, **VO + Space** activates, and **Tab** moves between controls.

For each step, note **pass**, or what was confusing, missing or wrong. Note the exact words VoiceOver said if they didn't make sense.

## 1. Library and folders
- [ ] Launch the app. VoiceOver announces the window and the "Library" heading.
- [ ] Tab to "Skip to content", activate it, and focus moves to the page content.
- [ ] Add a folder. Scan progress is announced politely, without interrupting every second.
- [ ] Each photo in the grid is announced with its date, and as "offline" if it is. You hear its position ("photo 3 of 85").
- [ ] Skipped files are explained in words.

## 2. Best Moments
- [ ] Open a set. Its heading ("5 similar photos") and status are announced.
- [ ] The favorite button announces "Favorite, toggle button, not pressed", and the state changes when pressed.
- [ ] Zoom in and out using only the keyboard.
- [ ] Save. "Saved: N favorites" is announced, and Undo is reachable.
- [ ] Mark a favorite, then choose another sidebar section. The dialog is announced, focus is on "Save", Tab stays inside it, and Escape returns you to the set.

## 3. Favorites and Memory Studio
- [ ] Select photos. Each is announced as selected, with its number.
- [ ] Create a collage. The preview is announced with its layout, shape and background.
- [ ] Choose a photo, move it with "Move later", and adjust its crop with the arrow keys. Each change is announced ("Crop: 55% across…").
- [ ] Export. Progress and the result are announced, and "Show in Finder" works.

## 4. Albums
- [ ] Add photos to a new album, then rearrange it with Arrange. Focus stays on the photo you moved.
- [ ] Undo is announced and works.

## 5. Sources and Settings
- [ ] Remove a folder. The impact summary is read before anything happens, and "Keep folder" has focus.
- [ ] Settings reads the storage sizes and the privacy statement.

## 6. Without a mouse at all
- [ ] Repeat one full journey with VoiceOver **off**, using only Tab, Return, Space, arrows and Escape: add a folder, review a set, make a collage and export it. Focus is always visible.

## 7. Offline (AC9), on the packaged app
Do this with the packaged `release/mac-arm64/Nearmora.app`, not the development build.
- [ ] Turn Wi-Fi off (and unplug Ethernet).
- [ ] Open the app, add a folder, review a set, make a collage and export it. Everything works, and nothing mentions a connection.
- [ ] Turn Wi-Fi back on.

## Results

| Section | Result | Notes |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

Reviewer: ____ · Date: ____ · macOS version: ____
