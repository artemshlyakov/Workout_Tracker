export interface WorkoutSet {
  id: string
  weight: string
  reps: string
}

export type SetField = 'weight' | 'reps'

export const initialSets: WorkoutSet[] = [
  { id: '1', weight: '80', reps: '10' },
  { id: '2', weight: '80', reps: '9' },
  { id: '3', weight: '75', reps: '10' },
]

/** Invalid or incomplete entries contribute nothing until corrected. */
export function parseWeight(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null
  const weight = Number(normalized)
  return Number.isSafeInteger(Math.round(weight * 100)) && weight >= 0 ? weight : null
}

export function parseReps(value: string): number | null {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return null
  const reps = Number(normalized)
  return Number.isSafeInteger(reps) ? reps : null
}

export function setVolume(set: WorkoutSet): number {
  const weight = parseWeight(set.weight)
  const reps = parseReps(set.reps)
  return weight === null || reps === null ? 0 : Math.round(weight * 100) * reps / 100
}

export function totalVolume(sets: WorkoutSet[]): number {
  return sets.reduce((sum, set) => sum + setVolume(set), 0)
}

export function updateSet(sets: WorkoutSet[], id: string, field: SetField, value: string): WorkoutSet[] {
  return sets.map((set) => set.id === id ? { ...set, [field]: value } : set)
}

export function addSet(sets: WorkoutSet[], id: string): WorkoutSet[] {
  const previousValidWeight = [...sets].reverse().find((set) => parseWeight(set.weight) !== null)?.weight ?? ''
  return [...sets, { id, weight: previousValidWeight, reps: '' }]
}

export function removeSet(sets: WorkoutSet[], id: string): WorkoutSet[] {
  return sets.filter((set) => set.id !== id)
}
