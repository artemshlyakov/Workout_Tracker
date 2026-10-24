import { BACKUP_VERSION, DEV_WORKSPACE_ID, type DevBackup } from './schema'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const timestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
const array = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.every(object)
const unique = (items: Record<string, unknown>[], field: string) => new Set(items.map((item) => item[field])).size === items.length

function validMeta(item: Record<string, unknown>): boolean {
  return id(item.id) && item.workspaceId === DEV_WORKSPACE_ID && item.ownerUserId === null &&
    item.serverRevision === null && Number.isSafeInteger(item.localRevision) && (item.localRevision as number) >= 1 &&
    timestamp(item.createdAt) && timestamp(item.updatedAt) && (item.deletedAt === null || timestamp(item.deletedAt))
}

export function parseBackup(json: string): DevBackup {
  if (json.length > 5_000_000) throw new Error('Файл слишком большой')
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new Error('Повреждённый JSON') }
  if (!object(value) || value.format !== 'workout-tracker-dev-backup' || value.version !== BACKUP_VERSION ||
      !object(value.workspace) || !object(value.syncState) ||
      !array(value.workouts) || !array(value.exercises) || !array(value.workoutExercises) || !array(value.exerciseSets) || !array(value.outbox)) {
    throw new Error('Неподдерживаемый формат резервной копии')
  }
  const { workspace, syncState, workouts, exercises, workoutExercises, exerciseSets, outbox } = value
  const trainingPlans = value.trainingPlans ?? []
  if (!array(trainingPlans)) throw new Error('Повреждённые программы тренировок')
  if (workspace.id !== DEV_WORKSPACE_ID || workspace.mode !== 'dev_test' || workspace.ownerUserId !== null ||
      !timestamp(workspace.createdAt) || !timestamp(workspace.lastActiveAt) ||
      syncState.workspaceId !== DEV_WORKSPACE_ID || syncState.ownerUserId !== null ||
      syncState.cursor !== null || syncState.lastAckAt !== null) throw new Error('Чужая или повреждённая локальная область')
  const validCollections = [workouts, exercises, workoutExercises, exerciseSets, trainingPlans].every((items) => items.every(validMeta) && unique(items, 'id'))
  const workoutIds = new Set(workouts.map((item) => item.id))
  const exerciseIds = new Set(exercises.map((item) => item.id))
  const relationIds = new Set(workoutExercises.map((item) => item.id))
  const validWorkout = (item: Record<string, unknown>) => item.deletedAt === null && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 60 && timestamp(item.startedAt) && (item.completedAt === null || timestamp(item.completedAt) && Date.parse(item.completedAt) >= Date.parse(item.startedAt))
  const validExercise = (item: Record<string, unknown>) => item.deletedAt === null && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120
  const validRelation = (item: Record<string, unknown>) => item.deletedAt === null && workoutIds.has(item.workoutId) && exerciseIds.has(item.exerciseId) && Number.isSafeInteger(item.position) && (item.position as number) >= 0
  const validSet = (item: Record<string, unknown>) => relationIds.has(item.workoutExerciseId) && Number.isSafeInteger(item.position) && (item.position as number) >= 0 && Number.isSafeInteger(item.weightCentiKg) && (item.weightCentiKg as number) >= 0 && (item.weightCentiKg as number) <= 200000 && Number.isSafeInteger(item.reps) && (item.reps as number) >= 1 && (item.reps as number) <= 1000
  const validPlan = (item: Record<string, unknown>) => typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 60 && Array.isArray(item.exerciseNames) && item.exerciseNames.length >= 1 && item.exerciseNames.length <= 50 && item.exerciseNames.every((name: unknown) => typeof name === 'string' && name.trim().length > 0 && name.length <= 120)
  if (!validCollections || !workouts.length || !exercises.length || !workoutExercises.length ||
      workouts.filter((item) => item.completedAt === null).length > 1 || !workouts.every(validWorkout) ||
      !exercises.every(validExercise) || !workoutExercises.every(validRelation) || !exerciseSets.every(validSet) || !trainingPlans.every(validPlan) ||
      new Set(exerciseSets.filter((item) => item.deletedAt === null).map((item) => `${item.workoutExerciseId}:${item.position}`)).size !== exerciseSets.filter((item) => item.deletedAt === null).length) throw new Error('Повреждённые данные тренировки')
  const knownEntities = new Map<string, string>([
    ...workouts.map((item): [string, string] => [item.id as string, 'workout']),
    ...exercises.map((item): [string, string] => [item.id as string, 'exercise']),
    ...workoutExercises.map((item): [string, string] => [item.id as string, 'workoutExercise']),
    ...exerciseSets.map((item): [string, string] => [item.id as string, 'exerciseSet']),
    ...trainingPlans.map((item): [string, string] => [item.id as string, 'trainingPlan']),
  ])
  const validSnapshot = (item: Record<string, unknown>): boolean => {
    const snapshot = item.snapshot
    if (!object(snapshot) || snapshot.id !== item.entityId || !validMeta(snapshot)) return false
    if (item.entityType === 'workout') return validWorkout(snapshot)
    if (item.entityType === 'exercise') return validExercise(snapshot)
    if (item.entityType === 'workoutExercise') return validRelation(snapshot)
    if (item.entityType === 'trainingPlan') return validPlan(snapshot)
    return validSet(snapshot)
  }
  if (!unique(outbox, 'operationId') || !unique(outbox, 'sequence') || !outbox.every((item) =>
    Number.isSafeInteger(item.sequence) && (item.sequence as number) > 0 &&
    id(item.operationId) && item.workspaceId === DEV_WORKSPACE_ID && item.ownerUserId === null &&
    knownEntities.get(item.entityId as string) === item.entityType &&
    (item.action === 'upsert' || item.action === 'delete') && item.baseServerRevision === null &&
    item.status === 'pending' && Number.isSafeInteger(item.attempts) && item.attempts === 0 &&
    item.lastError === null && timestamp(item.createdAt) && validSnapshot(item) &&
    (item.action === 'delete' ? object(item.snapshot) && timestamp(item.snapshot.deletedAt) :
      object(item.snapshot) && item.snapshot.deletedAt === null))) {
    throw new Error('Повреждённая очередь изменений')
  }
  return value as unknown as DevBackup
}
