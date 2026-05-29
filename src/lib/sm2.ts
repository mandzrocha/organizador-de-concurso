// SM-2 spaced repetition algorithm
// quality: 0-5 (0-2 = fail, 3-5 = pass)

export interface SM2Result {
  interval_days: number
  ease_factor: number
  repetitions: number
  next_review: string
}

export function sm2(
  quality: number,
  repetitions: number,
  ease_factor: number,
  interval_days: number
): SM2Result {
  let newRepetitions = repetitions
  let newEaseFactor = ease_factor
  let newInterval = interval_days

  if (quality >= 3) {
    if (repetitions === 0) newInterval = 1
    else if (repetitions === 1) newInterval = 6
    else newInterval = Math.round(interval_days * ease_factor)

    newRepetitions = repetitions + 1
    newEaseFactor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if (newEaseFactor < 1.3) newEaseFactor = 1.3
  } else {
    newRepetitions = 0
    newInterval = 1
  }

  const nextDate = new Date()
  nextDate.setDate(nextDate.getDate() + newInterval)

  return {
    interval_days: newInterval,
    ease_factor: newEaseFactor,
    repetitions: newRepetitions,
    next_review: nextDate.toISOString().split('T')[0],
  }
}

export function getQualityFromActivities(completedCount: number, totalActivities: number): number {
  const ratio = completedCount / totalActivities
  if (ratio >= 0.9) return 5
  if (ratio >= 0.75) return 4
  if (ratio >= 0.5) return 3
  if (ratio >= 0.25) return 2
  return 1
}
