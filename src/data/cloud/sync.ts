import type { SupabaseClient } from '@supabase/supabase-js'
import type { DexieWorkoutRepository } from '../local/DexieWorkoutRepository'
import type { ExerciseRecord, ExerciseSetRecord, OutboxOperation, WorkoutExerciseRecord, WorkoutRecord } from '../local/schema'
import { supabase } from './client'

const tableFor = { workout: 'workouts', exercise: 'exercises', workoutExercise: 'workoutExercises', exerciseSet: 'exerciseSets' } as const
const entityFor = { workout: 'workout', exercise: 'exercise', workoutExercise: 'workout_exercise', exerciseSet: 'exercise_set' } as const
type LocalEntity = WorkoutRecord | ExerciseRecord | WorkoutExerciseRecord | ExerciseSetRecord

export function operationPayload(operation: OutboxOperation): Record<string, unknown> {
  if (operation.action === 'delete') return {}
  const row = operation.snapshot
  switch (operation.entityType) {
    case 'workout': return { title: (row as WorkoutRecord).title, started_at: (row as WorkoutRecord).startedAt, completed_at: (row as WorkoutRecord).completedAt }
    case 'exercise': return { name: (row as ExerciseRecord).name }
    case 'workoutExercise': {
      const relation = row as WorkoutExerciseRecord
      return { workout_id: relation.workoutId, exercise_id: relation.exerciseId, position: relation.position }
    }
    case 'exerciseSet': {
      const set = row as ExerciseSetRecord
      return { workout_exercise_id: set.workoutExerciseId, position: set.position, weight_kg: set.weightCentiKg / 100, reps: set.reps }
    }
  }
}

export class CloudSync {
  private running: Promise<void> | null = null
  private paused = false
  constructor(private readonly repository: DexieWorkoutRepository, private readonly client: SupabaseClient = supabase) {}

  private get userId(): string {
    const id = this.repository.ownerUserId
    if (!id) throw new Error('Синхронизация доступна только после входа')
    return id
  }

  async prepare(): Promise<void> {
    const { data: { user }, error } = await this.client.auth.getUser()
    if (error || user?.id !== this.userId || user.is_anonymous) throw new Error('Сеанс не подтверждён')
    const db = this.repository.db
    if (await db.workspaces.get(this.userId)) return
    const [workouts, exercises, relations, sets] = await Promise.all([
      this.client.from('workouts').select('*').eq('user_id', this.userId),
      this.client.from('exercises').select('*').eq('user_id', this.userId),
      this.client.from('workout_exercises').select('*').eq('user_id', this.userId),
      this.client.from('exercise_sets').select('*').eq('user_id', this.userId),
    ])
    for (const result of [workouts, exercises, relations, sets]) if (result.error) throw result.error
    for (const result of [workouts, exercises, relations, sets]) {
      if (result.data?.some((row) => row.user_id !== this.userId)) throw new Error('Облако вернуло данные другого аккаунта')
    }
    if (!workouts.data?.length) {
      if (exercises.data?.length || relations.data?.length || sets.data?.length) throw new Error('Облачная история неполная; локальное создание остановлено')
      return // New account: local repository creates its first empty workout.
    }
    const time = new Date().toISOString()
    const meta = (row: Record<string, unknown>) => ({
      id: String(row.id), workspaceId: this.userId, ownerUserId: this.userId,
      serverRevision: Number(row.revision), localRevision: 1,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    })
    await db.transaction('rw', [db.workspaces, db.workouts, db.exercises, db.workoutExercises, db.exerciseSets, db.syncState], async () => {
      if (await db.workspaces.get(this.userId)) return
      await db.workspaces.add({ id: this.userId, mode: 'authenticated', ownerUserId: this.userId, createdAt: time, lastActiveAt: time })
      await db.workouts.bulkAdd((workouts.data ?? []).map((r) => ({ ...meta(r), title: r.title, startedAt: r.started_at, completedAt: r.completed_at })) as WorkoutRecord[])
      await db.exercises.bulkAdd((exercises.data ?? []).map((r) => ({ ...meta(r), name: r.name })) as ExerciseRecord[])
      await db.workoutExercises.bulkAdd((relations.data ?? []).map((r) => ({ ...meta(r), workoutId: r.workout_id, exerciseId: r.exercise_id, position: r.position })) as WorkoutExerciseRecord[])
      await db.exerciseSets.bulkAdd((sets.data ?? []).map((r) => ({ ...meta(r), workoutExerciseId: r.workout_exercise_id, position: r.position, weightCentiKg: Math.round(Number(r.weight_kg) * 100), reps: r.reps })) as ExerciseSetRecord[])
      await db.syncState.add({ workspaceId: this.userId, ownerUserId: this.userId, cursor: null, lastAckAt: time })
    })
  }

  push(): Promise<void> {
    if (this.paused) return Promise.reject(new Error('Синхронизация остановлена'))
    if (this.running) return this.running
    this.running = this.pushAll().finally(() => { this.running = null })
    return this.running
  }

  private async pushAll(): Promise<void> {
    const { data: { user }, error } = await this.client.auth.getUser()
    if (error || user?.id !== this.userId || user.is_anonymous) throw new Error('Сеанс не подтверждён; отправка остановлена')
    const db = this.repository.db
    for (;;) {
      if (this.paused) return
      const operation = await db.outbox.where('workspaceId').equals(this.userId).first()
      if (!operation) break
      if (operation.ownerUserId !== this.userId || operation.snapshot.ownerUserId !== this.userId || operation.snapshot.workspaceId !== this.userId) throw new Error('Операция принадлежит другому аккаунту')
      if (operation.status === 'conflict') throw new Error('Есть конфликт версий. Локальные изменения сохранены; нужна ручная проверка')
      const table = db.table<LocalEntity, string>(tableFor[operation.entityType])
      const record = await table.get(operation.entityId)
      if (!record || record.ownerUserId !== this.userId) throw new Error('Локальная запись не найдена в этом аккаунте')
      // Freeze the CAS revision before the first request. Unknown responses retry unchanged.
      if (operation.attempts === 0) {
        operation.baseServerRevision = record.serverRevision
        operation.attempts = 1
        await db.outbox.put(operation)
      }
      const checked = await this.client.auth.getUser()
      if (this.paused || checked.error || checked.data.user?.id !== this.userId) throw new Error('Аккаунт сменился; отправка остановлена')
      const { data, error: rpcError } = await this.client.rpc('apply_workout_operation', {
        p_operation_id: operation.operationId,
        p_entity_type: entityFor[operation.entityType],
        p_entity_id: operation.entityId,
        p_action: operation.action,
        p_base_revision: operation.baseServerRevision,
        p_payload: operationPayload(operation),
      })
      if (rpcError) throw rpcError
      if (!data || data.operation_id !== operation.operationId || data.entity_id !== operation.entityId) throw new Error('Неожиданное подтверждение сервера')
      if (data.status === 'conflict') {
        operation.status = 'conflict'
        operation.lastError = 'Конфликт версий в облаке'
        await db.outbox.put(operation)
        throw new Error('Конфликт версий. Изменения остались на устройстве')
      }
      if (data.status !== 'applied' || !Number.isSafeInteger(Number(data.revision))) throw new Error('Неожиданный ответ сервера')
      await db.transaction('rw', table, db.outbox, db.syncState, async () => {
        const current = await table.get(operation.entityId)
        if (current && current.ownerUserId === this.userId) await table.put({ ...current, serverRevision: Number(data.revision) })
        await db.outbox.delete(operation.sequence!)
        await db.syncState.update(this.userId, { lastAckAt: new Date().toISOString() })
      })
    }
  }

  async pendingCount(): Promise<number> {
    return this.repository.db.outbox.where('workspaceId').equals(this.userId).count()
  }

  async stop(): Promise<void> {
    this.paused = true
    try { await this.running } catch { /* Pending operations remain in IndexedDB. */ }
  }
}
