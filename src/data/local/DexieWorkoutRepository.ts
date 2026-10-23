import { parseReps, parseWeight } from '../../domain/workout'
import type { JournalView, WorkoutCommand, WorkoutRepository, WorkoutView, WorkoutDraftState } from '../ports/WorkoutRepository'
import { parseBackup } from './backup'
import { parseAccountBackup } from './accountBackup'
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

  private async activeWorkout(): Promise<WorkoutRecord> {
    const workouts = await this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray()
    const workout = workouts.filter((record) => !record.deletedAt && !record.completedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]
    if (!workout || workout.ownerUserId !== this.ownerUserId) throw new Error('Не удалось загрузить тренировку')
    return workout
  }

  private async initialize(): Promise<void> {
    await this.db.transaction('rw', [this.db.workspaces, this.db.workouts, this.db.exercises,
      this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, this.db.syncState], async () => {
        if (await this.db.workspaces.get(this.workspaceId)) return
        const time = now()
        await this.db.workspaces.add({ id: this.workspaceId, mode: this.ownerUserId ? 'authenticated' : 'dev_test', ownerUserId: this.ownerUserId, createdAt: time, lastActiveAt: time })
        await this.db.syncState.add({ workspaceId: this.workspaceId, ownerUserId: this.ownerUserId, cursor: null, lastAckAt: null })
        if (this.ownerUserId) return
        const workout: WorkoutRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), title: 'Силовая тренировка', startedAt: time, completedAt: null }
        const exercise: ExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), name: 'Жим штанги лёжа' }
        const workoutExercise: WorkoutExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutId: workout.id, exerciseId: exercise.id, position: 0 }
        const sets: ExerciseSetRecord[] = (this.ownerUserId ? [] : [[8000, 10], [8000, 9], [7500, 10]]).map(([weightCentiKg, reps], position) => ({
          ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutExerciseId: workoutExercise.id, position, weightCentiKg, reps,
        }))
        await this.db.workouts.add(workout)
        await this.db.exercises.add(exercise)
        await this.db.workoutExercises.add(workoutExercise)
        await this.db.exerciseSets.bulkAdd(sets)
        await this.db.outbox.bulkAdd([
          operation('workout', workout), operation('exercise', exercise), operation('workoutExercise', workoutExercise),
          ...sets.map((set) => operation('exerciseSet', set)),
        ])
      })
  }

  async load(): Promise<WorkoutView> {
    await this.initialize()
    const workouts = await this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray()
    if (!workouts.some((record) => !record.deletedAt && !record.completedAt)) return { title: '', exercises: [], active: false }
    const workout = await this.activeWorkout()
    const relations = (await this.db.workoutExercises.where('workoutId').equals(workout.id).toArray())
      .filter((relation) => !relation.deletedAt).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    const exercises = await Promise.all(relations.map(async (relation) => {
      const exercise = await this.db.exercises.get(relation.exerciseId)
      if (!exercise || exercise.deletedAt || exercise.ownerUserId !== this.ownerUserId || relation.ownerUserId !== this.ownerUserId) throw new Error('Упражнение тренировки не найдено')
      const records = await this.db.exerciseSets.where('workoutExerciseId').equals(relation.id).toArray()
      if (records.some((set) => set.ownerUserId !== this.ownerUserId)) throw new Error('Подход другого аккаунта')
      return { relationId: relation.id, exerciseId: exercise.id, name: exercise.name,
        sets: records.filter((set) => !set.deletedAt).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((set) => ({ id: set.id, weight: String(set.weightCentiKg / 100).replace('.', ','), reps: String(set.reps), position: set.position })) }
    }))
    return { title: workout.title, workoutId: workout.id, startedAt: workout.startedAt, exercises, active: true }
  }

  async listJournal(): Promise<JournalView> {
    await this.initialize()
    return this.db.transaction('r', [this.db.workouts, this.db.exercises, this.db.workoutExercises, this.db.exerciseSets], async () => {
      const [workouts, exercises, relations, sets] = await Promise.all([
        this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.exercises.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.workoutExercises.where('workspaceId').equals(this.workspaceId).toArray(),
        this.db.exerciseSets.where('workspaceId').equals(this.workspaceId).toArray(),
      ])
      if ([...workouts, ...exercises, ...relations, ...sets].some((row) => row.ownerUserId !== this.ownerUserId)) throw new Error('Данные другого аккаунта в локальном журнале')
      const liveExercises = exercises.filter((item) => !item.deletedAt)
      return {
        exercises: liveExercises.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        workouts: workouts.filter((workout) => !workout.deletedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)).map((workout) => ({
          id: workout.id, title: workout.title, startedAt: workout.startedAt, completedAt: workout.completedAt,
          exercises: relations.filter((relation) => !relation.deletedAt && relation.workoutId === workout.id)
            .sort((a, b) => a.position - b.position)
            .flatMap((relation) => {
              const exercise = liveExercises.find((item) => item.id === relation.exerciseId)
              return exercise ? [{ id: exercise.id, name: exercise.name,
                sets: sets.filter((set) => !set.deletedAt && set.workoutExerciseId === relation.id)
                  .sort((a, b) => a.position - b.position).map((set) => ({ weight: set.weightCentiKg / 100, reps: set.reps })) }] : []
            }),
        })),
      }
    })
  }

  async apply(command: WorkoutCommand): Promise<void> {
    if (!uuidPattern.test(command.operationId) || ('id' in command && !uuidPattern.test(command.id)) ||
      ('relationId' in command && !uuidPattern.test(command.relationId)) ||
      ('exerciseId' in command && !uuidPattern.test(command.exerciseId)) ||
      ('workoutId' in command && !uuidPattern.test(command.workoutId))) throw new Error('Неверный идентификатор операции')
    await this.initialize()
    await this.db.transaction('rw', this.db.workouts, this.db.exercises, this.db.workoutExercises, this.db.exerciseSets, this.db.outbox, async () => {
      if (await this.db.outbox.where('operationId').equals(command.operationId).first()) return
      const time = now()
      if (command.kind === 'startWorkout') {
        const title = command.title.trim()
        if (!title || title.length > 60) throw new Error('Введите название до 60 символов')
        const active = await this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray()
        if (active.some((item) => !item.deletedAt && !item.completedAt)) throw new Error('Сначала завершите текущую тренировку')
        const startedAt = command.startedAt ?? time
        if (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) > Date.now()) throw new Error('Выберите сегодняшнюю или прошедшую дату')
        const workout: WorkoutRecord = { ...meta(command.workoutId, time, this.workspaceId, this.ownerUserId), title, startedAt, completedAt: null }
        await this.db.workouts.add(workout)
        await this.db.outbox.add(operation('workout', workout, 'upsert', command.operationId))
        const names = [...new Set(command.exerciseNames ?? [])]
        if (names.length > 50 || names.some((name) => !name.trim() || name.length > 120)) throw new Error('Некорректный состав тренировки')
        const existing = await this.db.exercises.where('workspaceId').equals(this.workspaceId).toArray()
        for (const [position, name] of names.entries()) {
          let exercise = existing.find((item) => !item.deletedAt && item.name.toLocaleLowerCase('ru') === name.trim().toLocaleLowerCase('ru'))
          if (!exercise) {
            exercise = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), name: name.trim() }
            await this.db.exercises.add(exercise)
            await this.db.outbox.add(operation('exercise', exercise))
            existing.push(exercise)
          }
          const relation: WorkoutExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutId: workout.id, exerciseId: exercise.id, position }
          await this.db.workoutExercises.add(relation)
          await this.db.outbox.add(operation('workoutExercise', relation))
        }
        return
      }
      if (command.kind === 'reopenWorkout') {
        const all = await this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray()
        if (all.some((item) => !item.deletedAt && !item.completedAt)) throw new Error('Сначала завершите текущую тренировку')
        const workout = all.find((item) => item.id === command.workoutId && !item.deletedAt)
        if (!workout) throw new Error('Тренировка не найдена')
        const updated = { ...workout, editingCompletedAt: workout.completedAt ?? undefined, completedAt: null, updatedAt: time, localRevision: workout.localRevision + 1 }
        await this.db.workouts.put(updated)
        await this.db.outbox.add(operation('workout', updated, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'changeDate') {
        if (!Number.isFinite(Date.parse(command.startedAt)) || Date.parse(command.startedAt) > Date.now()) throw new Error('Выберите сегодняшнюю или прошедшую дату')
        const workout = await this.activeWorkout()
        const updated = { ...workout, startedAt: command.startedAt, editingCompletedAt: workout.editingCompletedAt && workout.editingCompletedAt < command.startedAt ? command.startedAt : workout.editingCompletedAt, updatedAt: time, localRevision: workout.localRevision + 1 }
        await this.db.workouts.put(updated)
        await this.db.outbox.add(operation('workout', updated, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'discardWorkout' || command.kind === 'removeExercise' || command.kind === 'moveExercise') {
        const workout = await this.activeWorkout()
        const relations = (await this.db.workoutExercises.where('workoutId').equals(workout.id).toArray()).filter((item) => !item.deletedAt).sort((a, b) => a.position - b.position)
        if (command.kind === 'moveExercise') {
          const index = relations.findIndex((item) => item.id === command.relationId)
          const other = relations[index + command.direction]
          if (index < 0 || !other) throw new Error('Нельзя переместить упражнение')
          const selected = relations[index]
          const updated = [ { ...selected, position: other.position, updatedAt: time, localRevision: selected.localRevision + 1 }, { ...other, position: selected.position, updatedAt: time, localRevision: other.localRevision + 1 } ]
          await this.db.workoutExercises.bulkPut(updated)
          await this.db.outbox.bulkAdd(updated.map((row, i) => operation('workoutExercise', row, 'upsert', i === 0 ? command.operationId : uuid())))
          return
        }
        const targets = command.kind === 'removeExercise' ? relations.filter((item) => item.id === command.relationId) : relations
        if (command.kind === 'removeExercise' && !targets.length) throw new Error('Упражнение не найдено')
        for (const relation of targets) {
          const sets = (await this.db.exerciseSets.where('workoutExerciseId').equals(relation.id).toArray()).filter((item) => !item.deletedAt)
          for (const set of sets) {
            const deleted = { ...set, deletedAt: time, updatedAt: time, localRevision: set.localRevision + 1 }
            await this.db.exerciseSets.put(deleted)
            await this.db.outbox.add(operation('exerciseSet', deleted, 'delete'))
          }
          const deleted = { ...relation, deletedAt: time, updatedAt: time, localRevision: relation.localRevision + 1 }
          await this.db.workoutExercises.put(deleted)
          await this.db.outbox.add(operation('workoutExercise', deleted, 'delete', command.kind === 'removeExercise' ? command.operationId : uuid()))
        }
        if (command.kind === 'discardWorkout') {
          const deleted = { ...workout, deletedAt: time, updatedAt: time, localRevision: workout.localRevision + 1 }
          await this.db.workouts.put(deleted)
          await this.db.outbox.add(operation('workout', deleted, 'delete', command.operationId))
        }
        return
      }
      if (command.kind === 'createExercise') {
        const name = command.name.trim()
        if (!name || name.length > 120) throw new Error('Введите название упражнения до 120 символов')
        const existing = (await this.db.exercises.where('workspaceId').equals(this.workspaceId).toArray())
          .find((item) => !item.deletedAt && item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))
        if (existing) throw new Error('Такое упражнение уже есть в каталоге')
        const exercise: ExerciseRecord = { ...meta(command.exerciseId, time, this.workspaceId, this.ownerUserId), name }
        await this.db.exercises.add(exercise)
        await this.db.outbox.add(operation('exercise', exercise, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'addExercise') {
        const workout = await this.activeWorkout()
        const exercise = await this.db.exercises.get(command.exerciseId)
        if (!exercise || exercise.deletedAt || exercise.workspaceId !== this.workspaceId || exercise.ownerUserId !== this.ownerUserId) throw new Error('Упражнение не найдено')
        const relations = (await this.db.workoutExercises.where('workoutId').equals(workout.id).toArray()).filter((item) => !item.deletedAt)
        if (relations.some((item) => item.exerciseId === exercise.id)) throw new Error('Упражнение уже добавлено')
        const relation: WorkoutExerciseRecord = { ...meta(command.relationId, time, this.workspaceId, this.ownerUserId), workoutId: workout.id, exerciseId: exercise.id,
          position: Math.max(-1, ...relations.map((item) => item.position)) + 1 }
        await this.db.workoutExercises.add(relation)
        await this.db.outbox.add(operation('workoutExercise', relation, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'finishWorkout') {
        const workout = await this.activeWorkout()
        const relations = (await this.db.workoutExercises.where('workoutId').equals(workout.id).toArray()).filter((item) => !item.deletedAt)
        const sets = await this.db.exerciseSets.where('workspaceId').equals(this.workspaceId).toArray()
        if (!sets.some((set) => !set.deletedAt && relations.some((item) => item.id === set.workoutExerciseId))) throw new Error('Добавьте хотя бы один подход')
        const completed: WorkoutRecord = { ...workout, completedAt: workout.editingCompletedAt ?? time, updatedAt: time, localRevision: workout.localRevision + 1 }
        await this.db.workouts.put(completed)
        await this.db.outbox.add(operation('workout', completed, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'rename') {
        const title = command.title.trim()
        if (!title || title.length > 60) throw new Error('Введите название до 60 символов')
        const workout = await this.activeWorkout()
        const updated: WorkoutRecord = { ...workout, title, localRevision: workout.localRevision + 1, updatedAt: time }
        await this.db.workouts.put(updated)
        await this.db.outbox.add(operation('workout', updated, 'upsert', command.operationId))
        return
      }
      if (command.kind === 'saveSet' || command.kind === 'restoreSet') {
        const values = validSet(command.weight, command.reps)
        if (!Number.isSafeInteger(command.position) || command.position < 0) throw new Error('Неверный порядок подхода')
        const workout = await this.activeWorkout()
        const workoutExercise = await this.db.workoutExercises.get(command.relationId)
        if (!workoutExercise || workoutExercise.deletedAt || workoutExercise.workoutId !== workout.id || workoutExercise.ownerUserId !== this.ownerUserId) throw new Error('Упражнение не входит в тренировку')
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
      if (!existing || existing.workspaceId !== this.workspaceId || existing.ownerUserId !== this.ownerUserId || existing.workoutExerciseId !== command.relationId || existing.deletedAt) throw new Error('Подход не найден')
      const workout = await this.activeWorkout()
      const relation = await this.db.workoutExercises.get(command.relationId)
      if (!relation || relation.workoutId !== workout.id || relation.deletedAt) throw new Error('Упражнение не входит в тренировку')
      const deleted: ExerciseSetRecord = { ...existing, deletedAt: time, updatedAt: time, localRevision: existing.localRevision + 1 }
      await this.db.exerciseSets.put(deleted)
      await this.db.outbox.add(operation('exerciseSet', deleted, 'delete', command.operationId))
    })
  }

  async loadDraft(): Promise<WorkoutDraftState | null> {
    return (await this.db.workspaces.get(this.workspaceId))?.draft ?? null
  }

  async saveDraft(draft: WorkoutDraftState | null): Promise<void> {
    await this.db.workspaces.update(this.workspaceId, { draft })
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

  async importAccountData(json: string): Promise<number> {
    if (!this.ownerUserId) throw new Error('Для восстановления нужен вход')
    const backup = parseAccountBackup(json, this.ownerUserId)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    await this.initialize()
    return this.db.transaction('rw', [this.db.workspaces, this.db.workouts, this.db.exercises, this.db.workoutExercises, this.db.exerciseSets, this.db.outbox], async () => {
      const workspace = await this.db.workspaces.get(this.workspaceId)
      if (workspace?.importedCopies?.includes(digest)) throw new Error('Эта копия уже восстановлена на устройстве')
      const source = backup.workouts.filter((row) => !row.deletedAt)
      const current = await this.db.workouts.where('workspaceId').equals(this.workspaceId).toArray()
      const activeCount = source.filter((row) => !row.completedAt).length
      if (activeCount > 1 || activeCount && current.some((row) => !row.deletedAt && !row.completedAt)) throw new Error('Сначала завершите текущую тренировку; в копии есть незавершённая')
      const time = now()
      const exerciseMap = new Map<string, string>()
      const catalog = await this.db.exercises.where('workspaceId').equals(this.workspaceId).toArray()
      for (const exercise of backup.exercises.filter((row) => !row.deletedAt)) {
        const existing = catalog.find((row) => !row.deletedAt && row.name.toLocaleLowerCase('ru') === exercise.name.toLocaleLowerCase('ru'))
        if (existing) { exerciseMap.set(exercise.id, existing.id); continue }
        const copy: ExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), name: exercise.name }
        await this.db.exercises.add(copy); await this.db.outbox.add(operation('exercise', copy))
        catalog.push(copy); exerciseMap.set(exercise.id, copy.id)
      }
      for (const workout of source) {
        const copy: WorkoutRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), title: `${workout.title.slice(0, 52)} (копия)`, startedAt: workout.startedAt, completedAt: workout.completedAt }
        await this.db.workouts.add(copy); await this.db.outbox.add(operation('workout', copy))
        for (const relation of backup.workoutExercises.filter((row) => !row.deletedAt && row.workoutId === workout.id)) {
          const exerciseId = exerciseMap.get(relation.exerciseId)
          if (!exerciseId) throw new Error('Упражнение не найдено в копии')
          const newRelation: WorkoutExerciseRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutId: copy.id, exerciseId, position: relation.position }
          await this.db.workoutExercises.add(newRelation); await this.db.outbox.add(operation('workoutExercise', newRelation))
          for (const set of backup.exerciseSets.filter((row) => !row.deletedAt && row.workoutExerciseId === relation.id)) {
            const newSet: ExerciseSetRecord = { ...meta(uuid(), time, this.workspaceId, this.ownerUserId), workoutExerciseId: newRelation.id, position: set.position, weightCentiKg: set.weightCentiKg, reps: set.reps }
            await this.db.exerciseSets.add(newSet); await this.db.outbox.add(operation('exerciseSet', newSet))
          }
        }
      }
      await this.db.workspaces.update(this.workspaceId, { importedCopies: [...(workspace?.importedCopies ?? []), digest].slice(-100) })
      return source.length
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
