import 'fake-indexeddb/auto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DexieWorkoutRepository } from '../local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../local/schema'
import { CloudSync } from './sync'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
let db: WorkoutDatabase
let repository: DexieWorkoutRepository
let rpc: ReturnType<typeof vi.fn>
let client: SupabaseClient

beforeEach(() => {
  db = new WorkoutDatabase(`sync-test-${crypto.randomUUID()}`)
  repository = new DexieWorkoutRepository(db, { ownerUserId: owner })
  rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({ data: {
    status: 'applied', operation_id: args.p_operation_id, entity_id: args.p_entity_id, revision: 1,
  }, error: null }))
  client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: owner, is_anonymous: false } }, error: null })) },
    rpc,
    from: vi.fn(() => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) })),
  } as unknown as SupabaseClient
})
afterEach(async () => { db.close(); await db.delete() })

describe('initial account sync', () => {
  it('does not promote the Plan 002 sample sets into a new account', async () => {
    await new CloudSync(repository, client).prepare()
    const view = await repository.load()
    expect(view.sets).toEqual([])
    expect((await db.workspaces.get(owner))?.ownerUserId).toBe(owner)
    expect((await db.outbox.toArray()).every((op) => op.ownerUserId === owner)).toBe(true)
  })

  it('hydrates the first workspace from cloud UUIDs and revisions', async () => {
    const time = new Date().toISOString()
    const workoutId = crypto.randomUUID(), exerciseId = crypto.randomUUID()
    const relationId = crypto.randomUUID(), setId = crypto.randomUUID()
    const base = (id: string) => ({ id, user_id: owner, revision: 4, created_at: time, updated_at: time, deleted_at: null })
    const rows: Record<string, unknown[]> = {
      workouts: [{ ...base(workoutId), title: 'Облачная тренировка', started_at: time, completed_at: null }],
      exercises: [{ ...base(exerciseId), name: 'Жим штанги лёжа' }],
      workout_exercises: [{ ...base(relationId), workout_id: workoutId, exercise_id: exerciseId, position: 0 }],
      exercise_sets: [{ ...base(setId), workout_exercise_id: relationId, position: 0, weight_kg: 82.5, reps: 8 }],
    }
    client = { ...client, from: vi.fn((name: string) => ({ select: () => ({ eq: async () => ({ data: rows[name], error: null }) }) })) } as unknown as SupabaseClient
    await new CloudSync(repository, client).prepare()
    expect((await repository.load()).sets).toEqual([{ id: setId, weight: '82,5', reps: '8', position: 0 }])
    expect((await db.exerciseSets.get(setId))?.serverRevision).toBe(4)
    expect(await db.outbox.count()).toBe(0)
  })

  it('uploads parents in order and clears only confirmed operations', async () => {
    await repository.load()
    const sync = new CloudSync(repository, client)
    await sync.push()
    expect(rpc.mock.calls.map(([, args]) => args.p_entity_type)).toEqual(['workout', 'exercise', 'workout_exercise'])
    expect(await db.outbox.count()).toBe(0)
    expect((await db.workouts.where('workspaceId').equals(owner).first())?.serverRevision).toBe(1)
  })

  it('retries an unknown acknowledgment with the same operation UUID and CAS revision', async () => {
    await repository.load()
    const sync = new CloudSync(repository, client)
    rpc.mockImplementationOnce(async () => ({ data: null, error: new Error('connection lost') }))
    await expect(sync.push()).rejects.toThrow('connection lost')
    await sync.push()
    expect(rpc.mock.calls[0][1].p_operation_id).toBe(rpc.mock.calls[1][1].p_operation_id)
    expect(rpc.mock.calls[0][1].p_base_revision).toBe(rpc.mock.calls[1][1].p_base_revision)
  })

  it('blocks an operation assigned to another account before calling RPC', async () => {
    await repository.load()
    const operation = (await db.outbox.toArray())[0]
    await db.outbox.update(operation.sequence!, { ownerUserId: other })
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('другому аккаунту')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not expose A records or A outbox in B local workspace', async () => {
    await repository.load()
    const b = new DexieWorkoutRepository(db, { ownerUserId: other })
    await b.load()
    await repository.apply({ kind: 'saveSet', operationId: crypto.randomUUID(), id: crypto.randomUUID(), weight: '80', reps: '10', position: 0 })
    expect((await repository.load()).sets).toHaveLength(1)
    expect((await b.load()).sets).toHaveLength(0)
    expect((await db.outbox.where('workspaceId').equals(other).toArray()).every((op) => op.ownerUserId === other)).toBe(true)
  })

  it('keeps a CAS conflict in the outbox', async () => {
    await repository.load()
    rpc.mockImplementationOnce(async (_name: string, args: Record<string, unknown>) => ({ data: {
      status: 'conflict', operation_id: args.p_operation_id, entity_id: args.p_entity_id, server_revision: 2,
    }, error: null }))
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('Конфликт')
    expect((await db.outbox.toArray())[0].status).toBe('conflict')
  })
})
