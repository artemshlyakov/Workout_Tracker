import type { ExerciseRecord, ExerciseSetRecord, WorkoutExerciseRecord, WorkoutRecord } from './schema'
export interface AccountBackup { format: 'workout-tracker-account-export'; version: 1; ownerUserId: string; exportedAt: string; workouts: WorkoutRecord[]; exercises: ExerciseRecord[]; workoutExercises: WorkoutExerciseRecord[]; exerciseSets: ExerciseSetRecord[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
export function parseAccountBackup(json: string, owner: string): AccountBackup {
  if (json.length > 10_000_000) throw new Error('Файл больше 10 МБ')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new Error('Повреждённый JSON') }
  if (!raw || typeof raw !== 'object') throw new Error('Неверный формат копии')
  const value = raw as AccountBackup
  if (value.format !== 'workout-tracker-account-export' || value.version !== 1 || !date(value.exportedAt)) throw new Error('Неподдерживаемая версия копии')
  if (value.ownerUserId !== owner) throw new Error('Копия принадлежит другому аккаунту')
  for (const rows of [value.workouts, value.exercises, value.workoutExercises, value.exerciseSets]) {
    if (!Array.isArray(rows) || rows.length > 50000 || rows.some((row) => !row || typeof row !== 'object' || !uuid.test(row.id) || row.ownerUserId !== owner || row.workspaceId !== owner || !date(row.createdAt) || !date(row.updatedAt) || (row.deletedAt !== null && !date(row.deletedAt))) || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Повреждённые или чужие записи в копии')
  }
  const workoutIds = new Set(value.workouts.map((row) => row.id)), exerciseIds = new Set(value.exercises.map((row) => row.id)), relationIds = new Set(value.workoutExercises.map((row) => row.id))
  if (value.workouts.some((row) => typeof row.title !== 'string' || !row.title.trim() || row.title.length > 60 || !date(row.startedAt) || (row.completedAt !== null && (!date(row.completedAt) || Date.parse(row.completedAt) < Date.parse(row.startedAt)))) ||
    value.exercises.some((row) => typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120) ||
    value.workoutExercises.some((row) => !workoutIds.has(row.workoutId) || !exerciseIds.has(row.exerciseId) || !Number.isSafeInteger(row.position) || row.position < 0) ||
    value.exerciseSets.some((row) => !relationIds.has(row.workoutExerciseId) || !Number.isSafeInteger(row.position) || row.position < 0 || !Number.isSafeInteger(row.weightCentiKg) || row.weightCentiKg < 0 || row.weightCentiKg > 200000 || !Number.isSafeInteger(row.reps) || row.reps < 1 || row.reps > 1000)) throw new Error('Некорректные значения в копии')
  const liveWorkoutIds = new Set(value.workouts.filter((row) => !row.deletedAt).map((row) => row.id))
  const liveExerciseIds = new Set(value.exercises.filter((row) => !row.deletedAt).map((row) => row.id))
  if (value.workoutExercises.some((row) => !row.deletedAt && liveWorkoutIds.has(row.workoutId) && !liveExerciseIds.has(row.exerciseId))) throw new Error('Упражнение из копии удалено: восстановление остановлено')
  return value
}
