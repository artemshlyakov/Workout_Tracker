import { parseReps, parseWeight } from '../../domain/workout'
import type { WorkoutCommand, WorkoutRepository, WorkoutView } from '../ports/WorkoutRepository'
import { parseBackup } from './backup'
import { DEV_WORKSPACE_ID, WorkoutDatabase, type DevBackup, type ExerciseRecord, type ExerciseSetRecord, type OutboxOperation, type WorkoutExerciseRecord, type WorkoutRecord } from './schema'

const now = () => new Date().toISOString()
const uuid = (): string => crypto.randomUUID()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const meta = (id: string, time: string) => ({
  id, workspaceId: DEV_WORKSPACE_ID, ownerUserId: null as null,
  serverRevision: null as null, localRevision: 1, createdAt: time,
  updatedAt: time, deletedAt: null as string | null,
})

function operation(entityType: OutboxOperation['entityType'], snapshot: OutboxOperation['snapshot'], action: OutboxOperation['action'] = 'upsert', operationId = uuid()): OutboxOperation {
  return { operationId, workspaceId: DEV_WORKSPACE_ID, ownerUserId: null, entityType,
    entityId: snapshot.id, action, snapshot, baseServerRevision: null,
    status: 'pending', attempts: 0, lastError: null, createdAt: now() }
}

function validSet(weight: string, reps: string): { weightCentiKg: number; reps: number } {
  const parsedWeight = parseWeight(weight)
  const parsedReps = parseReps(reps)
  if (parsedWeight === null || parsedWeight > 2000 || parsedReps === null || parsedReps < 1 || parsedReps > 1000) {
    throw new Error('Укажите вес от 0 до 2000 кг и повторы от 1 до 1000')
  }
  return { weightCentiKg: Math.round(parsedWeight * 100), reps: parsedReps }
}

export class DexieWorkoutRepository implements WorkoutRepository {
  constructor(public readonly db = new WorkoutDatabase()) {}

  private async initialize(): Promise<void> {
    await this.db.transaction('rw', [this.db.workspaces, this.db.workouts, this.db.exercises,
      this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, this.db.syncState], async () => {
        if (await this.db.workspaces.get(DEV_WORKSPACE_ID)) return
        const time = now()
        const workout: WorkoutRecord = { ...meta(uuid(), time), title: 'Силовая тренировка', startedAt: time, completedAt: null }
        const exercise: ExerciseRecord = { ...meta(uuid(), time), name: 'Жим штанги лёжа' }
        const workoutExercise: WorkoutExerciseRecord = { ...meta(uuid(), time), workoutId: workout.id, exerciseId: exercise.id, position: 0 }
        const sets: ExerciseSetRecord[] = [[8000, 10], [8000, 9], [7500, 10]].map(([weightCentiKg, reps], position) => ({
          ...meta(uuid(), time), workoutExerciseId: workoutExercise.id, position, weightCentiKg, reps,
        }))
        await this.db.workspaces.add({ id: DEV_WORKSPACE_ID, mode: 'dev_test', ownerUserId: null, createdAt: time, lastActiveAt: time })
        await this.db.workouts.add(workout)
        await this.db.exercises.add(exercise)
        await this.db.workoutExercises.add(workoutExercise)
        await this.db.exerciseSets.bulkAdd(sets)
        await this.db.outbox.bulkAdd([
          operation('workout', workout), operation('exercise', exercise), operation('workoutExercise', workoutExercise),
          ...sets.map((set) => operation('exerciseSet', set)),
        ])
        await this.db.syncState.add({ workspaceId: DEV_WORKSPACE_ID, ownerUserId: null, cursor: null, lastAckAt: null })
      })
  }

  async load(): Promise<WorkoutView> {
    await this.initialize()
    const workout = await this.db.workouts.where('workspaceId').equals(DEV_WORKSPACE_ID).first()
    const workoutExercise = await this.db.workoutExercises.where('workspaceId').equals(DEV_WORKSPACE_ID).first()
    if (!workout || !workoutExercise || workout.deletedAt || workoutExercise.deletedAt) throw new Error('Не удалось загрузить тренировку')
    const records = await this.db.exerciseSets.where('workoutExerciseId').equals(workoutExercise.id).toArray()
    return { title: workout.title, sets: records.filter((set) => !set.deletedAt)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((set) => ({ id: set.id, weight: String(set.weightCentiKg / 100).replace('.', ','), reps: String(set.reps), position: set.position })) }
  }

  async apply(command: WorkoutCommand): Promise<void> {
    if (!uuidPattern.test(command.operationId) || ('id' in command && !uuidPattern.test(command.id))) throw new Error('Неверный идентификатор операции')
    await this.initialize()
    await this.db.transaction('rw', this.db.workouts, this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, async () => {
      if (await this.db.outbox.where('operationId').equals(command.operationId).first()) return
      const time = now()
      if (command.kind === 'rename') {
        const title = command.title.trim()
        if (!title || title.length > 60) throw new Error('Введите название до 60 символов')
        const workout = await this.db.workouts.where('workspaceId').equals(DEV_WORKSPACE_ID).first()
        if (!workout || workout.deletedAt) throw new Error('Тренировка не найдена')
        const updated: WorkoutRecord = { ...workout, title, localRevision: workout.localRevision + 1, updatedAt: time }
        await this.db.workouts.put(updated)
        await this.db.outbox.add(operation('workout', updated, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'saveSet' || command.kind === 'restoreSet') {
        const values = validSet(command.weight, command.reps)
        if (!Number.isSafeInteger(command.position) || command.position < 0) throw new Error('Неверный порядок подхода')
        const workoutExercise = await this.db.workoutExercises.where('workspaceId').equals(DEV_WORKSPACE_ID).first()
        if (!workoutExercise || workoutExercise.deletedAt) throw new Error('Упражнение не найдено')
        const existing = await this.db.exerciseSets.get(command.id)
        if (existing && (existing.workspaceId !== DEV_WORKSPACE_ID || existing.workoutExerciseId !== workoutExercise.id)) throw new Error('Подход из другой области')
        if (command.kind === 'restoreSet' && (!existing || !existing.deletedAt)) throw new Error('Удалённый подход не найден')
        if (command.kind === 'saveSet' && existing?.deletedAt) throw new Error('Подход удалён')
        const updated: ExerciseSetRecord = existing ? {
          ...existing, ...values, position: command.position, localRevision: existing.localRevision + 1,
          updatedAt: time, deletedAt: null,
        } : { ...meta(command.id, time), workoutExerciseId: workoutExercise.id, position: command.position, ...values }
        await this.db.exerciseSets.put(updated)
        await this.db.outbox.add(operation('exerciseSet', updated, 'upsert', command.operationId))
        return
      }
      const existing = await this.db.exerciseSets.get(command.id)
      if (!existing || existing.workspaceId !== DEV_WORKSPACE_ID || existing.deletedAt) throw new Error('Подход не найден')
      const deleted: ExerciseSetRecord = { ...existing, deletedAt: time, updatedAt: time, localRevision: existing.localRevision + 1 }
      await this.db.exerciseSets.put(deleted)
      await this.db.outbox.add(operation('exerciseSet', deleted, 'delete', command.operationId))
    })
  }

  async exportData(): Promise<string> {
    await this.initialize()
    return this.db.transaction('r', [this.db.workspaces, this.db.workouts, this.db.exercises,
      this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, this.db.syncState], async () => {
      const [workspace, syncState, workouts, exercises, workoutExercises, exerciseSets, outbox] = await Promise.all([
        this.db.workspaces.get(DEV_WORKSPACE_ID), this.db.syncState.get(DEV_WORKSPACE_ID),
        this.db.workouts.where('workspaceId').equals(DEV_WORKSPACE_ID).toArray(),
        this.db.exercises.where('workspaceId').equals(DEV_WORKSPACE_ID).toArray(),
        this.db.workoutExercises.where('workspaceId').equals(DEV_WORKSPACE_ID).toArray(),
        this.db.exerciseSets.where('workspaceId').equals(DEV_WORKSPACE_ID).toArray(),
        this.db.outbox.where('workspaceId').equals(DEV_WORKSPACE_ID).toArray(),
      ])
      if (!workspace || !syncState) throw new Error('Локальная область не найдена')
      const backup: DevBackup = { format: 'workout-tracker-dev-backup', version: 1,
        workspace, workouts, exercises, workoutExercises, exerciseSets, outbox, syncState }
      return JSON.stringify(backup, null, 2)
    })
  }

  async importData(json: string): Promise<WorkoutView> {
    const backup = parseBackup(json)
    await this.db.transaction('rw', [this.db.workspaces, this.db.workouts, this.db.exercises,
      this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, this.db.syncState], async () => {
        await Promise.all([
          this.db.workspaces.clear(), this.db.workouts.clear(), this.db.exercises.clear(),
          this.db.workoutExercises.clear(), this.db.exerciseSets.clear(), this.db.outbox.clear(), this.db.syncState.clear(),
        ])
        await this.db.workspaces.add(backup.workspace)
        await this.db.workouts.bulkAdd(backup.workouts)
        await this.db.exercises.bulkAdd(backup.exercises)
        await this.db.workoutExercises.bulkAdd(backup.workoutExercises)
        await this.db.exerciseSets.bulkAdd(backup.exerciseSets)
        await this.db.outbox.bulkAdd(backup.outbox)
        await this.db.syncState.add(backup.syncState)
      })
    return this.load()
  }
}
