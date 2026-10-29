/**
 * Scores a similar-photo grouping against a labelled answer key (AC3 evidence).
 * Pairwise precision: of the photo pairs the app grouped, how many really belong together.
 * Pairwise recall: of the pairs that belong together, how many the app grouped.
 */

export interface GroupingScore {
  truePairs: number
  predictedPairs: number
  correctPairs: number
  precision: number
  recall: number
  /** Answer-key groups found whole, found only in pieces, or not found at all. */
  complete: number
  partial: number
  missed: number
  /** Predicted groups that include a photo from outside their answer-key group. */
  impure: number
}

function pairs(groups: readonly (readonly string[])[]): Set<string> {
  const result = new Set<string>()
  for (const group of groups) {
    const sorted = [...group].sort()
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) result.add(`${sorted[i]}|${sorted[j]}`)
  }
  return result
}

export function scoreGrouping(predicted: readonly (readonly string[])[], truth: readonly (readonly string[])[]): GroupingScore {
  const predictedPairs = pairs(predicted)
  const truePairs = pairs(truth)
  const correctPairs = [...predictedPairs].filter((p) => truePairs.has(p)).length

  const truthOf = new Map<string, number>()
  truth.forEach((group, index) => group.forEach((id) => truthOf.set(id, index)))
  let complete = 0
  let partial = 0
  let missed = 0
  for (const group of truth) {
    const best = Math.max(0, ...predicted.map((p) => p.filter((id) => group.includes(id)).length))
    if (best === group.length) complete++
    else if (best >= 2) partial++
    else missed++
  }
  const impure = predicted.filter((group) => new Set(group.map((id) => truthOf.get(id) ?? `alone:${id}`)).size > 1).length

  return {
    truePairs: truePairs.size,
    predictedPairs: predictedPairs.size,
    correctPairs,
    precision: predictedPairs.size === 0 ? 1 : correctPairs / predictedPairs.size,
    recall: truePairs.size === 0 ? 1 : correctPairs / truePairs.size,
    complete,
    partial,
    missed,
    impure,
  }
}
