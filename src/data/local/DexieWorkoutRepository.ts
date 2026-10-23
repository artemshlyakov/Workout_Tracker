import { parseReps, parseWeight } from '../../domain/workout'
import type { WorkoutCommand, WorkoutRepository, WorkoutView } from '../ports/WorkoutRepository'
import { parseBackup } from './backup'
import { DEV_WORKSPACE_ID, WorkoutDatabase, type DevBackup, type ExerciseRecord, type ExerciseSetRecord, type OutboxOperation, type WorkoutExerciseRecord, type WorkoutRecord } from './schema'

const now = () => new Date().toISOString()
const uuid = (): string => crypto.randomUUID()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const meta = (id: string, time: string, workspaceId: string, ownerUserId: string | null) => ({
  id, workspaceId, ownerUserId,
  serverRevision: null as number | null, localRevision: 1, createdAt: time,
  updatedAt: time, deletedAt: null as string | null,
})

function operation(entityType: OutboxOperation['entityType'], snapshot: OutboxOperation['snapshot'], action: OutboxOperation['action'] = 'upsert', operationId = uuid()): OutboxOperation {
  return { operationId, workspaceId: snapshot.workspaceId, ownerUserId: snapshot.ownerUserId, entityType,
    entityId: snapshot.id, action, snapshot, baseServerRevision: snapshot.serverRevision,
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
  readonly workspaceId: string
  readonly ownerUserId: string | null
  constructor(public readonly db = new WorkoutDatabase(), options?: { ownerUserId: string }) {
    this.ownerUserId = options?.ownerUserId ?? null
    this.workspaceId = options?.ownerUserId ?? DEV_WORKSPACE_ID
  }

  private async activeWorkout(): Promise<{ workout: WorkoutRecord; workoutExercise: WorkoutExerciseRecord }> {
    const [workouts, relations] = await Promise.all([
      this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray(),
      this.db.workoutExercises.where('workspaceId').equals(this.workspaceId).toArray(),
    ])
    const liveRelations = relations.filter((relation) => !relation.deletedAt)
    const workout = workouts.filter((record) => !record.deletedAt && liveRelations.some((relation) => relation.workoutId === record.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]
    const workoutExercise = liveRelations.find((relation) => relation.workoutId === workout?.id)
    if (!workout || !workoutExercise) throw new Error('Не удалось загрузить тренировку')
    return { workout, workoutExercise }
  }

  private async initialize(): Promise<void> {
    await this.db.transaction('rw', [this.db.workspaces, this.db.workouts, this.db.exercises,
      this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, this.db.syncState], async () => {
        if (await this.db.workspaces.get(this.workspaceId)) return
        const time = now()
        const workout: WorkoutRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), title: 'Силовая тренировка', startedAt: time, completedAt: null }
        const exercise: ExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), name: 'Жим штанги лёжа' }
        const workoutExercise: WorkoutExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutId: workout.id, exerciseId: exercise.id, position: 0 }
        const sets: ExerciseSetRecord[] = (this.ownerUserId ? [] : [[8000, 10], [8000, 9], [7500, 10]]).map(([weightCentiKg, reps], position) => ({
          ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutExerciseId: workoutExercise.id, position, weightCentiKg, reps,
        }))
        await this.db.workspaces.add({ id: this.workspaceId, mode: this.ownerUserId ? 'authenticated' : 'dev_test', ownerUserId: this.ownerUserId, createdAt: time, lastActiveAt: time })
        await this.db.workouts.add(workout)
        await this.db.exercises.add(exercise)
        await this.db.workoutExercises.add(workoutExercise)
        await this.db.exerciseSets.bulkAdd(sets)
        await this.db.outbox.bulkAdd([
          operation('workout', workout), operation('exercise', exercise), operation('workoutExercise', workoutExercise),
          ...sets.map((set) => operation('exerciseSet', set)),
        ])
        await this.db.syncState.add({ workspaceId: this.workspaceId, ownerUserId: this.ownerUserId, cursor: null, lastAckAt: null })
      })
  }

  async load(): Promise<WorkoutView> {
    await this.initialize()
    const { workout, workoutExercise } = await this.activeWorkout()
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
        const { workout } = await this.activeWorkout()
        const updated: WorkoutRecord = { ...workout, title, localRevision: workout.localRevision + 1, updatedAt: time }
        await this.db.workouts.put(updated)
        await this.db.outbox.add(operation('workout', updated, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'saveSet' || command.kind === 'restoreSet') {
        const values = validSet(command.weight, command.reps)
        if (!Number.isSafeInteger(command.position) || command.position < 0) throw new Error('Неверный порядок подхода')
        const { workoutExercise } = await this.activeWorkout()
        const existing = await this.db.exerciseSets.get(command.id)
        if (existing && (existing.workspaceId !== this.workspaceId || existing.workoutExerciseId !== workoutExercise.id)) throw new Error('Подход из другой области')
        if (command.kind === 'restoreSet' && (!existing || !existing.deletedAt)) throw new Error('Удалённый подход не найден')
        if (command.kind === 'saveSet' && existing?.deletedAt) throw new Error('Подход удалён')
        const updated: ExerciseSetRecord = existing ? {
          ...existing, ...values, position: command.position, localRevision: existing.localRevision + 1,
          updatedAt: time, deletedAt: null,
        } : { ...meta(command.id, time, this.workspaceId, this.ownerUserId), workoutExerciseId: workoutExercise.id, position: command.position, ...values }
        await this.db.exerciseSets.put(updated)
        await this.db.outbox.add(operation('exerciseSet', updated, 'upsert', command.operationId))
        return
      }
      const existing = await this.db.exerciseSets.get(command.id)
      if (!existing || existing.workspaceId !== this.workspaceId || existing.deletedAt) throw new Error('Подход не найден')
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
        this.db.workspaces.get(this.workspaceId), this.db.syncState.get(this.workspaceId),
        this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.exercises.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.workoutExercises.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.exerciseSets.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.outbox.where('workspaceId').equals(this.workspaceId).toArray(),
      ])
      if (!workspace || !syncState) throw new Error('Локальная область не найдена')
      const backup: DevBackup = { format: 'workout-tracker-dev-backup', version: 1,
        workspace, workouts, exercises, workoutExercises, exerciseSets, outbox, syncState }
      return JSON.stringify(backup, null, 2)
    })
  }

  async exportAccountData(): Promise<string> {
    if (!this.ownerUserId) throw new Error('Для экспорта аккаунта нужен вход')
    const db = this.db
    const owner = this.ownerUserId
    return db.transaction('r', [db.workspaces, db.workouts, db.exercises, db.workoutExercises, db.exerciseSets, db.outbox, db.syncState], async () => {
      const [workspace, workouts, exercises, workoutExercises, exerciseSets, outbox, syncState] = await Promise.all([
        db.workspaces.get(owner),
        db.workouts.where('workspaceId').equals(owner).toArray(),
        db.exercises.where('workspaceId').equals(owner).toArray(),
        db.workoutExercises.where('workspaceId').equals(owner).toArray(),
        db.exerciseSets.where('workspaceId').equals(owner).toArray(),
        db.outbox.where('workspaceId').equals(owner).toArray(),
        db.syncState.get(owner),
      ])
      if (!workspace || !syncState || [...workouts, ...exercises, ...workoutExercises, ...exerciseSets, ...outbox, workspace, syncState].some((row) => row.ownerUserId !== owner)) throw new Error('Обнаружены данные другого аккаунта или неполная локальная область')
      return JSON.stringify({ format: 'workout-tracker-account-export', version: 1, ownerUserId: owner,
        exportedAt: now(), workouts, exercises, workoutExercises, exerciseSets, outbox, syncState }, null, 2)
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
