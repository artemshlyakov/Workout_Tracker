import type { JournalEntry } from '../data/ports/WorkoutRepository'
export const localDay = (value: string | Date) => {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export const workoutVolume = (workout: JournalEntry) => workout.exercises.reduce((sum, exercise) => sum + exercise.sets.reduce((total, set) => total + set.weight * set.reps, 0), 0)
export const workoutSets = (workout: JournalEntry) => workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)
export function monthDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  return [...Array.from({ length: (first.getDay() + 6) % 7 }, () => null), ...Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => new Date(year, month, index + 1))]
}
export function previousExercise(workouts: JournalEntry[], exerciseId: string) {
  return workouts.filter((workout) => workout.completedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .flatMap((workout) => workout.exercises.filter((exercise) => exercise.id === exerciseId && exercise.sets.length).map((exercise) => ({ ...exercise, date: workout.startedAt })))[0]
}
