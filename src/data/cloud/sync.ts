import type { SupabaseClient } from '@supabase/supabase-js'
import type { DexieWorkoutRepository } from '../local/DexieWorkoutRepository'
import type { ExerciseRecord, ExerciseSetRecord, OutboxOperation, WorkoutExerciseRecord, WorkoutRecord, TrainingPlanRecord } from '../local/schema'
import { supabase } from './client'

const tableFor = { workout: 'workouts', exercise: 'exercises', workoutExercise: 'workoutExercises', exerciseSet: 'exerciseSets', trainingPlan: 'trainingPlans' } as const
const entityFor = { workout: 'workout', exercise: 'exercise', workoutExercise: 'workout_exercise', exerciseSet: 'exercise_set', trainingPlan: 'training_plan' } as const
type LocalEntity = WorkoutRecord | ExerciseRecord | WorkoutExerciseRecord | ExerciseSetRecord | TrainingPlanRecord

export interface PrepareResult { cloudChecked: boolean }
export interface PushResult { acknowledged: number; pending: number }
export interface SyncConflict { operationId: string; entityType: OutboxOperation['entityType']; local: LocalEntity; remote: LocalEntity }

export function operationPayload(operation: OutboxOperation): Record<string, unknown> {
  if (operation.action === 'delete') return {}
  const row = operation.snapshot
  switch (operation.entityType) {
    case 'trainingPlan': return { title: (row as TrainingPlanRecord).title, exercise_names: (row as TrainingPlanRecord).exerciseNames }
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
    // Never replace local work (including an in-flight operation with unknown ack).
    if (await this.pendingCount() || (await this.repository.loadDraft())?.dirty) return { cloudChecked: false }
    const read = async (table: string): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = []
      const pageSize = 500
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await this.client.from(table).select('*').eq('user_id', this.userId)
          .order('id').range(offset, offset + pageSize - 1)
          .setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal)
        if (this.paused) throw new Error('Синхронизация остановлена')
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('Не удалось прочитать облачную историю')
        for (const row of data) {
          if (row.user_id !== this.userId) throw new Error('Облако вернуло данные другого аккаунта')
          if (typeof row.id !== 'string' || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) throw new Error('Некорректная версия облачной записи')
        }
        rows.push(...data)
        if (data.length < pageSize) return rows
      }
    }
    const [workouts, exercises, relations, sets, plans] = await Promise.all([
      read('workouts'), read('exercises'), read('workout_exercises'), read('exercise_sets'), read('training_plans'),
    ])
    const workoutIds = new Set(workouts.map((row) => row.id)), exerciseIds = new Set(exercises.map((row) => row.id))
    const relationIds = new Set(relations.map((row) => row.id))
    if (relations.some((row) => !workoutIds.has(row.workout_id) || !exerciseIds.has(row.exercise_id)) ||
        sets.some((row) => !relationIds.has(row.workout_exercise_id))) throw new Error('Облачная история обновляется. Повторите синхронизацию')
    const time = new Date().toISOString()
    const meta = (row: Record<string, unknown>) => ({
      id: String(row.id), workspaceId: this.userId, ownerUserId: this.userId,
      serverRevision: Number(row.revision), localRevision: 1,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    })
    const changed = await db.transaction('rw', [db.workspaces, db.workouts, db.exercises, db.workoutExercises, db.exerciseSets, db.trainingPlans, db.syncState, db.outbox], async () => {
      if (this.paused) throw new Error('Синхронизация остановлена')
      // A write may have arrived during the network requests.
      if (await this.pendingCount() || (await this.repository.loadDraft())?.dirty) return false
      if (!await db.workspaces.get(this.userId)) await db.workspaces.add({ id: this.userId, mode: 'authenticated', ownerUserId: this.userId, createdAt: time, lastActiveAt: time })
      const merge = async (tableName: string, rows: LocalEntity[]) => {
        const table = db.table<LocalEntity, string>(tableName)
        for (const row of rows) {
          const current = await table.get(row.id)
          if (current && current.ownerUserId !== this.userId) throw new Error('Локальная запись другого аккаунта')
          if (!current || (row.serverRevision ?? 0) > (current.serverRevision ?? 0)) {
            await table.put({ ...row, localRevision: (current?.localRevision ?? 0) + 1 })
          }
        }
      }
      await merge('workouts', workouts.map((r) => ({ ...meta(r), title: String(r.title), startedAt: String(r.started_at), completedAt: r.completed_at ? String(r.completed_at) : null })))
      await merge('exercises', exercises.map((r) => ({ ...meta(r), name: String(r.name) })))
      await merge('workoutExercises', relations.map((r) => ({ ...meta(r), workoutId: String(r.workout_id), exerciseId: String(r.exercise_id), position: Number(r.position) })))
      await merge('exerciseSets', sets.map((r) => ({ ...meta(r), workoutExerciseId: String(r.workout_exercise_id), position: Number(r.position), weightCentiKg: Math.round(Number(r.weight_kg) * 100), reps: Number(r.reps) })))
      await merge('trainingPlans', plans.map((r) => ({ ...meta(r), title: String(r.title), exerciseNames: r.exercise_names as string[] })))
      await db.syncState.put({ workspaceId: this.userId, ownerUserId: this.userId, cursor: null, lastAckAt: time })
      return true
    })
    return { cloudChecked: changed }
  }

  push(): Promise<PushResult> {
    if (this.paused) return Promise.reject(new Error('Синхронизация остановлена'))
    if (this.running) { this.wakeRequested = true; return this.running }
    const send = async () => {
      let total = 0
      let result: PushResult
      do {
        this.wakeRequested = false
        result = await this.pushAll()
        total += result.acknowledged
      } while (this.wakeRequested && !this.paused)
      return { acknowledged: total, pending: result.pending }
    }
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    this.running = Promise.resolve(locks ? locks.request(`workout-sync-${this.userId}`, send) : send()).then((result) => result).finally(() => { this.running = null })
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
      const params = { p_operation_id: operation.operationId, p_entity_id: operation.entityId, p_action: operation.action,
        p_base_revision: operation.baseServerRevision, p_payload: operationPayload(operation) }
      const request = operation.entityType === 'trainingPlan'
        ? this.client.rpc('apply_training_plan_operation', params)
        : this.client.rpc('apply_workout_operation', { ...params, p_entity_type: entityFor[operation.entityType] })
      const { data, error: rpcError } = await request.setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal)
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

  async getConflict(): Promise<SyncConflict | null> {
    const operation = (await this.repository.db.outbox.where('workspaceId').equals(this.userId).toArray()).find((item) => item.status === 'conflict')
    if (!operation) return null
    const local = await this.repository.db.table<LocalEntity, string>(tableFor[operation.entityType]).get(operation.entityId)
    if (!local || local.ownerUserId !== this.userId) throw new Error('Локальная версия не найдена')
    return { operationId: operation.operationId, entityType: operation.entityType, local, remote: await this.conflictRemote(operation) }
  }

  private async conflictRemote(operation: OutboxOperation): Promise<LocalEntity> {
    const token = await this.verifiedToken()
    const names = { workout: 'workouts', exercise: 'exercises', workoutExercise: 'workout_exercises', exerciseSet: 'exercise_sets', trainingPlan: 'training_plans' }
    const { data: row, error } = await this.client.from(names[operation.entityType]).select('*').eq('user_id', this.userId).eq('id', operation.entityId)
      .setHeader('Authorization', `Bearer ${token}`).abortSignal(this.abortController.signal).maybeSingle()
    if (this.paused) throw new Error('Синхронизация остановлена')
    if (error) throw error
    if (!row || row.user_id !== this.userId || row.id !== operation.entityId || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) throw new Error('Облачная версия недоступна. Локальная копия сохранена')
    const base = { id: row.id, workspaceId: this.userId, ownerUserId: this.userId, serverRevision: Number(row.revision), localRevision: 1, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }
    switch (operation.entityType) {
      case 'trainingPlan': return { ...base, title: row.title, exerciseNames: row.exercise_names }
      case 'workout': return { ...base, title: row.title, startedAt: row.started_at, completedAt: row.completed_at }
      case 'exercise': return { ...base, name: row.name }
      case 'workoutExercise': return { ...base, workoutId: row.workout_id, exerciseId: row.exercise_id, position: row.position }
      case 'exerciseSet': return { ...base, workoutExerciseId: row.workout_exercise_id, position: row.position, weightCentiKg: Math.round(Number(row.weight_kg) * 100), reps: row.reps }
    }
  }

  async resolveConflict(conflict: SyncConflict, choice: 'local' | 'cloud'): Promise<void> {
    const db = this.repository.db
    const operation = await db.outbox.where('operationId').equals(conflict.operationId).first()
    if (!operation || operation.ownerUserId !== this.userId || operation.status !== 'conflict') throw new Error('Конфликт уже изменился. Обновите список')
    const remote = await this.conflictRemote(operation)
    if (remote.serverRevision !== conflict.remote.serverRevision) throw new Error('Облачная версия изменилась. Обновите сравнение')
    if (choice === 'local' && remote.deletedAt) throw new Error('Удалённую запись нельзя воскресить. Сначала экспортируйте локальную копию')
    await db.transaction('rw', [db.workspaces, db.workouts, db.exercises, db.workoutExercises, db.exerciseSets, db.trainingPlans, db.outbox], async () => {
      if (this.paused) throw new Error('Синхронизация остановлена')
      const queued = await db.outbox.get(operation.sequence!)
      if (!queued || queued.operationId !== operation.operationId || queued.status !== 'conflict') throw new Error('Конфликт уже изменился. Обновите список')
      if ((await this.repository.loadDraft())?.dirty) throw new Error('Сначала сохраните или удалите незаполненные подходы')
      const table = db.table<LocalEntity, string>(tableFor[operation.entityType])
      const local = await table.get(operation.entityId)
      if (!local || local.ownerUserId !== this.userId || local.localRevision !== conflict.local.localRevision) throw new Error('Локальная версия изменилась. Обновите сравнение')
      const pending = await db.outbox.where('workspaceId').equals(this.userId).toArray()
      if (choice === 'cloud' && remote.deletedAt) {
        const relations = await db.workoutExercises.where('workspaceId').equals(this.userId).toArray()
        const affected = relations.filter((row) => row.workoutId === local.id || row.exerciseId === local.id || row.id === local.id)
        const sets = await db.exerciseSets.where('workspaceId').equals(this.userId).toArray()
        const childIds = new Set([...affected.map((row) => row.id), ...sets.filter((row) => affected.some((relation) => relation.id === row.workoutExerciseId)).map((row) => row.id)])
        if (pending.some((item) => item.entityId !== local.id && childIds.has(item.entityId))) throw new Error('У удалённой записи есть локальные изменения внутри. Экспортируйте копию для безопасного восстановления')
      }
      await db.outbox.bulkDelete(pending.filter((item) => item.entityId === local.id).map((item) => item.sequence!))
      if (choice === 'cloud') await table.put({ ...remote, localRevision: local.localRevision + 1 })
      else {
        const updated = { ...local, serverRevision: remote.serverRevision, localRevision: local.localRevision + 1, updatedAt: new Date().toISOString() }
        await table.put(updated)
        await db.outbox.add({ operationId: crypto.randomUUID(), workspaceId: this.userId, ownerUserId: this.userId, entityType: operation.entityType, entityId: local.id,
          action: local.deletedAt ? 'delete' : 'upsert', snapshot: updated, baseServerRevision: remote.serverRevision, status: 'pending', attempts: 0, lastError: null, createdAt: new Date().toISOString() })
      }
    })
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
