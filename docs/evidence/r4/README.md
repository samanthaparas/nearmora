# R4 evidence — Best Moments

## Part 1: finding similar photos

Date: 2026-10-29 · Machine: Apple M1 (8 cores), 16 GB, macOS 27.0.1, Node 24.21.0

Labels: [auto] automated · [int] real SQLite and files · [e2e] built app · [ci] GitHub Actions · [human] person's judgment

| Gate item | Evidence | Label |
|---|---|---|
| Distance and time rules | 0, 10 and 64 bits counted exactly; photos linked only within 10 bits **and** 120 s; a photo 11 bits from one member but 1 bit from another joins through it (connected components) | [auto] |
| Identical copies are not sets | Two locations of the same bytes give 0 sets; on the pack, no set has fewer than 2 pictures | [int] |
| Algorithm version recorded | Every set on the pack carries the current version, `dhash64-t10-w120s-filedate-samefolder@2` | [int] |
| v2 same-folder rule | File-dated look-alikes link only within one folder; EXIF-dated ones link across folders; a file-dated and an EXIF-dated photo need a shared folder. **Control:** without the folder check, this test fails | [auto] |
| Regrouping keeps status (AC13) | Rerun with no change: same id, `reviewed`, revision 1 | [int] |
| A reviewed set that gains a photo is reopened | Status `unreviewed`, revision 2, the favorite kept. **Control:** never reopening fails this test | [int] |
| Corrections survive regrouping (AC4) | A removed photo stays out (still recorded as `removed`), and an added unrelated photo stays in. **Control:** ignoring removals fails this test | [int] |
| Grouping never changes favorites (AC3) | A set whose photos are all missing is deleted, its favorite stays, and a manual set is untouched | [int] |
| Precision and recall on the labelled pack | See the table below | [int] |
| False-match review | **Pending:** the owner reviews the sets in part 2 | [human] |
| Passes on GitHub's macOS runner | Passed on PR #10, [run 40808158200](https://github.com/samanthaparas/nearmora/actions/runs/40808158200) (2026-10-29): 149 unit and integration tests (the 2 private-pack tests skipped as intended), 20 E2E tests, all packaged checks | [ci] |

### Labelled pack results

The pack has 88 files: 8 labelled bursts of 5 frames (40 photos; 4 bursts have EXIF dates and 4 don't), 40 unrelated photos, 3 identical copies and 5 generated app-screen PNGs. Pair precision and recall are measured against the bursts.

| Setting | Sets | Precision | Recall | Bursts complete / partial / missed | Sets with non-burst photos |
|---|---|---|---|---|---|
| v1: ≤ 10 bits, 120 s, EXIF dates only | 4 | 100% | 50% | 4 / 0 / 4 | 0 |
| ≤ 10 bits, 120 s, EXIF **or file** dates (option B) | 9 | 89% | 100% | 8 / 0 / 0 | 1 (the 5 app-screen images, 0–6 bits apart) |
| **v2 (in use): EXIF dates, or file dates within the same folder (option C)** | 9 | 89% | 100% | 8 / 0 / 0 | 1 (the same 5 app-screen images, which share a folder) |

The full sweep (≤ 6, 10, 14 or 18 bits × 120 s or 600 s × EXIF only or EXIF plus file dates) gave exactly these two rows: on this pack only the date source matters. Run it with `npx vitest run tests/integration/similarity-eval.test.ts --silent=false`.

This is 88 photos. It shows the rule behaves as designed; it isn't enough to tune thresholds.

On this pack v2 equals option B, because every burst sits in one folder; how they differ is shown by the unit test above.

Totals: 151 unit and integration tests.

## Part 2: the review screen

Date: 2026-10-29 · Same machine.

| Gate item | Evidence | Label |
|---|---|---|
| Queue order | Undecided first, then decide-later, then reviewed, with favorite counts | [int] |
| Save, Undo, Favorite all | A burst of 3 becomes one set; two favorites saved ("Saved: 2 favorites."), undone, then all three saved | [e2e] |
| Decide later | Keeps the draft and returns the set to "To review" marked "Saved for later" | [e2e] |
| Unsaved-changes guard | Leaving with unsaved picks opens "Save your choices?" with Save focused; Tab stays inside; Escape continues reviewing; Discard leaves and nothing is saved. Component tests cover the dialog's focus trap, Escape and focus return. **Control:** without the focus trap, the Tab test fails | [e2e] [auto] |
| Corrections survive regrouping (AC4, AC13) | Remove (and stale-revision refusal); add a nearby photo, which stays after regrouping; remove down to one dissolves the set; split apart stays split after regrouping. **Control:** without matching on removed photos, the split test fails. In the app: add nearby, remove, split, rescan, and the set stays gone | [int] [e2e] |
| Grouping never changes favorites (AC3) | Removing a favorite from a set keeps it a favorite | [int] |
| Previews | Made once from a reachable original, shared while in flight, then cached; none made while offline; originals' fingerprints unchanged | [int] |
| Offline mid-review (AC5) | The folder disappears mid-review: Save still works ("Saved: 1 favorite."), the Library shows "Not connected", and the choice is there after a restart. Panels fall back to thumbnails (component test) | [e2e] [auto] |
| Narrow window | At 800 px the photos become A/B tabs; switching shows one and hides the other | [e2e] |
| Favorite toggle | `aria-pressed` and the visible text both change ("☆ Favorite" / "★ Favorite") | [auto] |
| Owner's false-match review (AC3) | 2026-10-29: the owner reviewed a contact sheet of the 9 sets found in the pack (kept local, since the photos are CC BY-SA). **Sets 1–8 (the eight real bursts) are correct; set 9 (the 5 generated app-screen images) is a false match.** That's 8 of 9 sets right, consistent with the 89% pair precision measured in part 1 | [human] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

Totals: 166 unit, integration and component tests; 26 E2E tests.

### Screenshots (generated photos)

- `review-compare.png`: a burst of three in compare view, one marked favorite, with the strip, actions and "not saved yet".
- `unsaved-dialog.png`: the dialog shown when leaving with unsaved picks.

### What the owner's review shows

The one false match is a set of text-heavy app screens: different content (a shopping list, a weekend plan…) on the same pale layout. At 9×8 pixels, dHash sees only the layout, so these look identical (0–6 bits apart). Real photos of different scenes didn't do this in the pack. Possible fixes, not made yet and to be measured first:

- a stricter distance for low-detail images
- leaving PNG screenshots without an EXIF date out of grouping
- a second, finer fingerprint for candidates

The rule (v2) is unchanged until then.

### What testing caught

- **The zoom bar and the chosen count broke across lines** in the first screenshot, from a reused text class that forces full width. They now have their own class.
