import type { SupabaseClient } from '@supabase/supabase-js'
import type { DexieWorkoutRepository } from '../local/DexieWorkoutRepository'
import type { ExerciseRecord, ExerciseSetRecord, OutboxOperation, WorkoutExerciseRecord, WorkoutRecord } from '../local/schema'
import { supabase } from './client'

const tableFor = { workout: 'workouts', exercise: 'exercises', workoutExercise: 'workoutExercises', exerciseSet: 'exerciseSets' } as const
const entityFor = { workout: 'workout', exercise: 'exercise', workoutExercise: 'workout_exercise', exerciseSet: 'exercise_set' } as const
type LocalEntity = WorkoutRecord | ExerciseRecord | WorkoutExerciseRecord | ExerciseSetRecord

export interface PrepareResult { cloudChecked: boolean }
export interface PushResult { acknowledged: number; pending: number }

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
  private running: Promise<PushResult> | null = null
  private paused = false
  private wakeRequested = false
  private readonly abortController = new AbortController()
  constructor(private readonly repository: DexieWorkoutRepository, private readonly client: SupabaseClient = supabase) {}

  private get userId(): string {
    const id = this.repository.ownerUserId
    if (!id) throw new Error('Синхронизация доступна только после входа')
    return id
  }

  private async verifiedToken(): Promise<string> {
    if (this.paused) throw new Error('Синхронизация остановлена')
    const { data: { session }, error: sessionError } = await this.client.auth.getSession()
    if (sessionError || !session?.access_token || session.user.id !== this.userId) throw new Error('Сеанс другого аккаунта или не подтверждён')
    // Verify the exact token that will be attached to this request. A later
    // account switch cannot make A's queued operation run with B's JWT.
    const { data: { user }, error } = await this.client.auth.getUser(session.access_token)
    if (this.paused || error || user?.id !== this.userId || user.is_anonymous) throw new Error('Сеанс не подтверждён')
    return session.access_token
  }

  async prepare(): Promise<PrepareResult> {
    const token = await this.verifiedToken()
    const db = this.repository.db
    if (await db.workspaces.get(this.userId)) return { cloudChecked: false }
    const [workouts, exercises, relations, sets] = await Promise.all([
      this.client.from('workouts').select('*').eq('user_id', this.userId).setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal),
      this.client.from('exercises').select('*').eq('user_id', this.userId).setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal),
      this.client.from('workout_exercises').select('*').eq('user_id', this.userId).setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal),
      this.client.from('exercise_sets').select('*').eq('user_id', this.userId).setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal),
    ])
    if (this.paused) throw new Error('Синхронизация остановлена')
    for (const result of [workouts, exercises, relations, sets]) if (result.error) throw result.error
    for (const result of [workouts, exercises, relations, sets]) {
      if (result.data?.some((row) => row.user_id !== this.userId)) throw new Error('Облако вернуло данные другого аккаунта')
    }
    if (!workouts.data?.length) {
      if (exercises.data?.length || relations.data?.length || sets.data?.length) throw new Error('Облачная история неполная; локальное создание остановлено')
      return { cloudChecked: true } // New account: local repository creates its first empty workout.
    }
    const time = new Date().toISOString()
    const meta = (row: Record<string, unknown>) => ({
      id: String(row.id), workspaceId: this.userId, ownerUserId: this.userId,
      serverRevision: Number(row.revision), localRevision: 1,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    })
    await db.transaction('rw', [db.workspaces, db.workouts, db.exercises, db.workoutExercises, db.exerciseSets, db.syncState], async () => {
      if (this.paused) throw new Error('Синхронизация остановлена')
      if (await db.workspaces.get(this.userId)) return
      await db.workspaces.add({ id: this.userId, mode: 'authenticated', ownerUserId: this.userId, createdAt: time, lastActiveAt: time })
      await db.workouts.bulkAdd((workouts.data ?? []).map((r) => ({ ...meta(r), title: r.title, startedAt: r.started_at, completedAt: r.completed_at })) as WorkoutRecord[])
      await db.exercises.bulkAdd((exercises.data ?? []).map((r) => ({ ...meta(r), name: r.name })) as ExerciseRecord[])
      await db.workoutExercises.bulkAdd((relations.data ?? []).map((r) => ({ ...meta(r), workoutId: r.workout_id, exerciseId: r.exercise_id, position: r.position })) as WorkoutExerciseRecord[])
      await db.exerciseSets.bulkAdd((sets.data ?? []).map((r) => ({ ...meta(r), workoutExerciseId: r.workout_exercise_id, position: r.position, weightCentiKg: Math.round(Number(r.weight_kg) * 100), reps: r.reps })) as ExerciseSetRecord[])
      await db.syncState.add({ workspaceId: this.userId, ownerUserId: this.userId, cursor: null, lastAckAt: time })
    })
    return { cloudChecked: true }
  }

  push(): Promise<PushResult> {
    if (this.paused) return Promise.reject(new Error('Синхронизация остановлена'))
    if (this.running) { this.wakeRequested = true; return this.running }
    this.running = (async () => {
      let total = 0
      let result: PushResult
      do {
        this.wakeRequested = false
        result = await this.pushAll()
        total += result.acknowledged
      } while (this.wakeRequested && !this.paused)
      return { acknowledged: total, pending: result.pending }
    })().finally(() => { this.running = null })
    return this.running
  }

  private async pushAll(): Promise<PushResult> {
    const db = this.repository.db
    let acknowledged = 0
    for (;;) {
      if (this.paused) break
      const operation = await db.outbox.where('workspaceId').equals(this.userId).first()
      if (!operation) break
      if (operation.ownerUserId !== this.userId || operation.snapshot.ownerUserId !== this.userId || operation.snapshot.workspaceId !== this.userId) throw new Error('Операция принадлежит другому аккаунту')
      if (operation.status === 'conflict') throw new Error('Есть конфликт версий. Локальные изменения сохранены; нужна ручная проверка')
      const table = db.table<LocalEntity, string>(tableFor[operation.entityType])
      const record = await table.get(operation.entityId)
      if (!record || record.ownerUserId !== this.userId) throw new Error('Локальная запись не найдена в этом аккаунте')
      const token = await this.verifiedToken()
      if (this.paused) break
      // Freeze the CAS revision before the first request. Unknown responses retry unchanged.
      if (operation.attempts === 0) {
        operation.baseServerRevision = record.serverRevision
        operation.attempts = 1
        await db.outbox.put(operation)
      }
      if (this.paused) break
      const { data, error: rpcError } = await this.client.rpc('apply_workout_operation', {
        p_operation_id: operation.operationId,
        p_entity_type: entityFor[operation.entityType],
        p_entity_id: operation.entityId,
        p_action: operation.action,
        p_base_revision: operation.baseServerRevision,
        p_payload: operationPayload(operation),
      }).setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal)
      if (this.paused) throw new Error('Синхронизация остановлена')
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
      acknowledged++
    }
    return { acknowledged, pending: await this.pendingCount() }
  }

  async pendingCount(): Promise<number> {
    return this.repository.db.outbox.where('workspaceId').equals(this.userId).count()
  }

  async stop(): Promise<void> {
    this.paused = true
    this.abortController.abort()
    // Logout must not wait forever for a server that never answers.
    void this.running?.catch(() => { /* The owner-specific outbox stays in IndexedDB. */ })
  }
}
