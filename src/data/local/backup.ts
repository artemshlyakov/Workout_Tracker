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
  if (workspace.id !== DEV_WORKSPACE_ID || workspace.mode !== 'dev_test' || workspace.ownerUserId !== null ||
      !timestamp(workspace.createdAt) || !timestamp(workspace.lastActiveAt) ||
      syncState.workspaceId !== DEV_WORKSPACE_ID || syncState.ownerUserId !== null ||
      syncState.cursor !== null || syncState.lastAckAt !== null) throw new Error('Чужая или повреждённая локальная область')
  const validCollections = [workouts, exercises, workoutExercises, exerciseSets].every((items) => items.every(validMeta) && unique(items, 'id'))
  if (!validCollections || workouts.length !== 1 || exercises.length !== 1 || workoutExercises.length !== 1 ||
      !workouts.every((item) => item.deletedAt === null && typeof item.title === 'string' && item.title.trim().length > 0 && item.title.length <= 60 && timestamp(item.startedAt) && item.completedAt === null) ||
      !exercises.every((item) => item.deletedAt === null && item.name === 'Жим штанги лёжа') ||
      !workoutExercises.every((item) => item.deletedAt === null && item.workoutId === workouts[0].id && item.exerciseId === exercises[0].id && item.position === 0) ||
      !exerciseSets.every((item) => item.workoutExerciseId === workoutExercises[0].id && Number.isSafeInteger(item.position) && (item.position as number) >= 0 && Number.isSafeInteger(item.weightCentiKg) && (item.weightCentiKg as number) >= 0 && (item.weightCentiKg as number) <= 200000 && Number.isSafeInteger(item.reps) && (item.reps as number) >= 1 && (item.reps as number) <= 1000) ||
      !unique(exerciseSets.filter((item) => item.deletedAt === null), 'position')) throw new Error('Повреждённые данные тренировки')
  const knownEntities = new Map<string, string>([
    [workouts[0].id as string, 'workout'], [exercises[0].id as string, 'exercise'],
    [workoutExercises[0].id as string, 'workoutExercise'],
    ...exerciseSets.map((item): [string, string] => [item.id as string, 'exerciseSet']),
  ])
  const validSnapshot = (item: Record<string, unknown>): boolean => {
    const snapshot = item.snapshot
    if (!object(snapshot) || snapshot.id !== item.entityId || !validMeta(snapshot)) return false
    if (item.entityType === 'workout') return typeof snapshot.title === 'string' && snapshot.title.trim().length > 0 &&
      snapshot.title.length <= 60 && timestamp(snapshot.startedAt) && snapshot.completedAt === null
    if (item.entityType === 'exercise') return snapshot.name === 'Жим штанги лёжа'
    if (item.entityType === 'workoutExercise') return snapshot.workoutId === workouts[0].id &&
      snapshot.exerciseId === exercises[0].id && snapshot.position === 0
    return snapshot.workoutExerciseId === workoutExercises[0].id &&
      Number.isSafeInteger(snapshot.position) && (snapshot.position as number) >= 0 &&
      Number.isSafeInteger(snapshot.weightCentiKg) && (snapshot.weightCentiKg as number) >= 0 &&
      (snapshot.weightCentiKg as number) <= 200000 && Number.isSafeInteger(snapshot.reps) &&
      (snapshot.reps as number) >= 1 && (snapshot.reps as number) <= 1000
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
