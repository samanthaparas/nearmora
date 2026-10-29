# ADR-0009: Finding similar photos

Date: 2026-10-29 · Status: accepted (R4 part 1). Rule v2 is in use, by the owner's decision.

## Context

Best Moments offers groups of photos that are *possibly* the same moment, so the person can pick favorites (AC3). The roadmap's starting rule (§6.6) is dHash distance ≤ 10 **and** capture times within 120 s, using EXIF dates only, recorded as an algorithm version. Exact copies are shown separately, and grouping must never change favorites or imply deletion.

## Decision

- **Rule v2 in use (`dhash64-t10-w120s-filedate-samefolder@2`, owner's decision):** v1, plus photos without an EXIF date, using their file date. A photo dated only by its file date is linked **only with photos in the same folder** (any of its locations), while EXIF-dated photos are matched across folders.
- **Rule v1 (`dhash64-t10-w120s@1`), the roadmap's starting point, kept for comparison:**
  - Two photos are linked when their 64-bit dHashes differ by at most 10 bits and both have an EXIF capture time no more than 120 s apart.
  - Linked photos form a set (connected components, via union-find). Sorting by time means each photo is only compared with neighbours inside the window.
  - The version is stored on every set.
- **Identical copies are never a set.** Identical bytes are already one picture (asset) with several locations (decision D3), so they appear once and need no choosing.
- **Regrouping runs after every scan and folder removal,** like moments:
  - Each new group is matched one-to-one to the old set with the most overlapping photos, keeping its id, review status and corrections. Photos the person removed stay out (still recorded as `removed`), and photos they added stay in.
  - **A reviewed set that gains photos goes back to the queue,** so the new photo gets a look; its favorites stay. A set that only loses photos keeps its status.
  - **Any membership change increases the set's revision,** so a review screen showing old membership can't save over it.
  - Sets with no matching group are deleted. Favorites are per picture and stay.
  - `manual` sets (made by the person) are never rebuilt.
- **Measured on the owner's labelled pack** (88 files: 8 bursts of 5, plus unrelated photos), with `tests/integration/similarity-eval.test.ts`:
  - v1 finds the 4 bursts that have EXIF dates whole, with 100% pair precision and nothing wrongly grouped.
  - The other 4 bursts have no EXIF date, so v1 can't consider them: 50% recall.
  - Counting file dates as well finds all 8 bursts (100% recall), and also groups the pack's 5 generated app-screen images (dHashes 0–6 bits apart), which the answer key doesn't label as a group (89% precision).
  - Thresholds from 6 to 18 bits and windows of 2 or 10 minutes made no difference on this pack.

## The owner's decision: file dates, within the same folder

Options considered:
- **A.** EXIF dates only (v1): safest, but photos without a date taken never get suggestions.
- **B.** File dates everywhere: finds the most, with the most risk.
- **C.** File dates only within the same folder.

File dates are often copy dates, so under B "taken within 2 minutes" weakens to "copied within 2 minutes" across a whole copied library. The owner chose **C**: bursts almost always sit in one folder, and the folder limit stops a bulk copy from linking unrelated photos across folders.

Measured on the pack, v2 gives 9 sets, 100% recall (all 8 bursts complete) and 89% precision. The one set outside the answer key is the 5 generated app-screen images (dHashes 0–6 bits apart) in one folder. That matches option B on this pack, as expected, since every burst sits in a single folder. The cases where C and B differ (look-alike, file-dated photos in different folders) are covered by a unit test instead.

The owner's review of sets in part 2 decides whether look-alike images like those app screens count as false matches.

## Consequences

- **Photos without an EXIF date are only matched within their own folder.** A burst split across folders with no EXIF dates won't be found.
- **Existing sets are re-stamped with the current version** at the next regroup, and their status and corrections carry over as usual.
- **88 photos are a sanity check, not a tuning set.** The same numbers across all thresholds say this pack's bursts are near-identical and its other photos are far apart; real libraries will have harder cases. The thresholds aren't tuned to this pack.
- **dHash is a coarse 9×8 fingerprint.** Photos that look similar at thumbnail size but aren't the same moment (two days at the same beach) can be linked only if their times are within the window, which is why the time rule matters.
