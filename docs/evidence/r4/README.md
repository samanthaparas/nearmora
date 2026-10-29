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
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run. The pack evaluation skips in CI | [ci] |

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
