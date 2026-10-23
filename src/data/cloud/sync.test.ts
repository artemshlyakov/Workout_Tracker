import 'fake-indexeddb/auto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DexieWorkoutRepository } from '../local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../local/schema'
import { CloudSync } from './sync'
import { undoDeletedSet } from '../../domain/undo'

const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
let db: WorkoutDatabase
let repository: DexieWorkoutRepository
let rpc: ReturnType<typeof vi.fn>
let client: SupabaseClient
let currentUser: string

function request<T>(result: T | Promise<T>) {
  let signal: AbortSignal | undefined
  const headers = new Map<string, string>()
  return {
    headers,
    setHeader(name: string, value: string) { headers.set(name, value); return this },
    abortSignal(value: AbortSignal) { signal = value; return this },
    then(resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.race([Promise.resolve(result), new Promise<T>((_done, fail) => {
        if (signal?.aborted) fail(new Error('aborted'))
        else signal?.addEventListener('abort', () => fail(new Error('aborted')), { once: true })
      })]).then(resolve, reject)
    },
  }
}

beforeEach(() => {
  db = new WorkoutDatabase(`sync-test-${crypto.randomUUID()}`)
  repository = new DexieWorkoutRepository(db, { ownerUserId: owner })
  currentUser = owner
  rpc = vi.fn((_name: string, args: Record<string, unknown>) => request({ data: {
    status: 'applied', operation_id: args.p_operation_id, entity_id: args.p_entity_id, revision: 1,
  }, error: null }))
  client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: `token-${currentUser}`, user: { id: currentUser } } }, error: null })),
      getUser: vi.fn(async (token: string) => ({ data: { user: { id: token.slice(6), is_anonymous: false } }, error: null })),
    },
    rpc,
    from: vi.fn(() => ({ select: () => ({ eq: () => request({ data: [], error: null }) }) })),
  } as unknown as SupabaseClient
})
afterEach(async () => { db.close(); await db.delete() })

async function seedAccount(): Promise<string> {
  await repository.load()
  const exerciseId = crypto.randomUUID(), relationId = crypto.randomUUID()
  await repository.apply({ kind: 'startWorkout', operationId: crypto.randomUUID(), workoutId: crypto.randomUUID(), title: 'Силовая тренировка' })
  await repository.apply({ kind: 'createExercise', operationId: crypto.randomUUID(), exerciseId, name: 'Жим штанги лёжа' })
  await repository.apply({ kind: 'addExercise', operationId: crypto.randomUUID(), relationId, exerciseId })
  return relationId
}


describe('initial account sync', () => {
  it('does not promote the Plan 002 sample sets into a new account', async () => {
    expect(await new CloudSync(repository, client).prepare()).toEqual({ cloudChecked: true })
    const view = await repository.load()
    expect(view.exercises).toEqual([])
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
    client = { ...client, from: vi.fn((name: string) => ({ select: () => ({ eq: () => request({ data: rows[name], error: null }) }) })) } as unknown as SupabaseClient
    await new CloudSync(repository, client).prepare()
    expect((await repository.load()).exercises[0]?.sets).toEqual([{ id: setId, weight: '82,5', reps: '8', position: 0 }])
    expect((await db.exerciseSets.get(setId))?.serverRevision).toBe(4)
    expect(await db.outbox.count()).toBe(0)
  })

  it('uploads parents in order and clears only confirmed operations', async () => {
    await seedAccount()
    const sync = new CloudSync(repository, client)
    expect(await sync.push()).toEqual({ acknowledged: 3, pending: 0 })
    expect(rpc.mock.calls.map(([, args]) => args.p_entity_type)).toEqual(['workout', 'exercise', 'workout_exercise'])
    expect(await db.outbox.count()).toBe(0)
    expect((await db.workouts.where('workspaceId').equals(owner).first())?.serverRevision).toBe(1)
  })

  it('retries an unknown acknowledgment with the same operation UUID and CAS revision', async () => {
    await seedAccount()
    const sync = new CloudSync(repository, client)
    rpc.mockImplementationOnce(() => request({ data: null, error: new Error('connection lost') }))
    await expect(sync.push()).rejects.toThrow('connection lost')
    await sync.push()
    expect(rpc.mock.calls[0][1].p_operation_id).toBe(rpc.mock.calls[1][1].p_operation_id)
    expect(rpc.mock.calls[0][1].p_base_revision).toBe(rpc.mock.calls[1][1].p_base_revision)
  })

  it('blocks an operation assigned to another account before calling RPC', async () => {
    await seedAccount()
    const operation = (await db.outbox.toArray())[0]
    await db.outbox.update(operation.sequence!, { ownerUserId: other })
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('другому аккаунту')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not expose A records or A outbox in B local workspace', async () => {
    await seedAccount()
    const b = new DexieWorkoutRepository(db, { ownerUserId: other })
    await b.load()
    await repository.apply({ kind: 'saveSet', operationId: crypto.randomUUID(), relationId: (await repository.load()).exercises[0].relationId, id: crypto.randomUUID(), weight: '80', reps: '10', position: 0 })
    expect((await repository.load()).exercises[0]?.sets).toHaveLength(1)
    expect((await b.load()).exercises).toHaveLength(0)
    expect((await db.outbox.where('workspaceId').equals(other).toArray()).every((op) => op.ownerUserId === other)).toBe(true)
  })

  it('keeps a CAS conflict in the outbox', async () => {
    await seedAccount()
    rpc.mockImplementationOnce((_name: string, args: Record<string, unknown>) => request({ data: {
      status: 'conflict', operation_id: args.p_operation_id, entity_id: args.p_entity_id, server_revision: 2,
    }, error: null }))
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('Конфликт')
    expect((await db.outbox.toArray())[0].status).toBe('conflict')
  })

  it('keeps first login closed on pull failure and succeeds on retry', async () => {
    const failed = { ...client, from: vi.fn(() => ({ select: () => ({ eq: () => request({ data: null, error: new Error('network lost') }) }) })) } as unknown as SupabaseClient
    await expect(new CloudSync(repository, failed).prepare()).rejects.toThrow('network lost')
    expect(await db.workspaces.get(owner)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
    expect(await new CloudSync(repository, client).prepare()).toEqual({ cloudChecked: true })
    expect((await repository.load()).exercises).toEqual([])
  })

  it('rejects foreign rows during initial pull', async () => {
    const foreign = { ...client, from: vi.fn(() => ({ select: () => ({ eq: () => request({ data: [{ user_id: other }], error: null }) }) })) } as unknown as SupabaseClient
    await expect(new CloudSync(repository, foreign).prepare()).rejects.toThrow('другого аккаунта')
    expect(await db.workspaces.get(owner)).toBeUndefined()
  })

  it('does not send A outbox when B owns the current session', async () => {
    await seedAccount()
    currentUser = other
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('другого аккаунта')
    expect(rpc).not.toHaveBeenCalled()
    expect(await db.outbox.count()).toBe(3)
  })

  it('binds an in-flight A request to A token even after B signs in', async () => {
    await seedAccount()
    rpc.mockImplementationOnce((_name: string, args: Record<string, unknown>) => {
      currentUser = other
      return request({ data: { status: 'applied', operation_id: args.p_operation_id, entity_id: args.p_entity_id, revision: 1 }, error: null })
    })
    await expect(new CloudSync(repository, client).push()).rejects.toThrow('другого аккаунта')
    expect(rpc.mock.results[0].value.headers.get('Authorization')).toBe(`Bearer token-${owner}`)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(await db.outbox.count()).toBe(2)
  })

  it('aborts an in-flight request on logout and preserves pending work for retry', async () => {
    await seedAccount()
    rpc.mockImplementationOnce(() => request(new Promise(() => undefined)))
    const sync = new CloudSync(repository, client)
    const pending = sync.push()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    await sync.stop()
    await expect(pending).rejects.toThrow('aborted')
    expect(await db.outbox.count()).toBe(3)
    expect(await new CloudSync(repository, client).push()).toEqual({ acknowledged: 3, pending: 0 })
  })

  it('does not acknowledge an old response after logout even if transport ignores abort', async () => {
    await seedAccount()
    let answer!: (value: unknown) => void
    rpc.mockImplementationOnce(() => ({
      setHeader() { return this }, abortSignal() { return this },
      then(resolve: (value: unknown) => void) { return new Promise((done) => { answer = (value) => { resolve(value); done(value) } }) },
    }))
    const sync = new CloudSync(repository, client)
    const pending = sync.push()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    await sync.stop()
    answer({ data: { status: 'applied', operation_id: rpc.mock.calls[0][1].p_operation_id, entity_id: rpc.mock.calls[0][1].p_entity_id, revision: 1 }, error: null })
    await expect(pending).rejects.toThrow('остановлена')
    expect(await db.outbox.count()).toBe(3)
  })

  it('undoes a confirmed tombstone with a new UUID and retains the original delete', async () => {
    await seedAccount()
    const originalId = crypto.randomUUID()
    await repository.apply({ kind: 'saveSet', operationId: crypto.randomUUID(), relationId: (await repository.load()).exercises[0].relationId, id: originalId, weight: '80', reps: '10', position: 0 })
    const sync = new CloudSync(repository, client)
    await sync.push()
    await repository.apply({ kind: 'deleteSet', operationId: crypto.randomUUID(), relationId: (await repository.load()).exercises[0].relationId, id: originalId })
    await sync.push()
    expect((await db.exerciseSets.get(originalId))?.deletedAt).not.toBeNull()
    const undo = undoDeletedSet({ id: originalId, weight: '80', reps: '10' }, 0, (await repository.load()).exercises[0].relationId)
    expect(undo.set.id).not.toBe(originalId)
    await repository.apply(undo.command)
    await sync.push()
    expect((await repository.load()).exercises[0]?.sets).toEqual([{ id: undo.set.id, weight: '80', reps: '10', position: 0 }])
    expect((await db.exerciseSets.get(originalId))?.deletedAt).not.toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })

  it('keeps quick delete and undo as distinct ordered operations', async () => {
    await seedAccount()
    const originalId = crypto.randomUUID()
    await repository.apply({ kind: 'saveSet', operationId: crypto.randomUUID(), relationId: (await repository.load()).exercises[0].relationId, id: originalId, weight: '80', reps: '10', position: 0 })
    await new CloudSync(repository, client).push()
    await repository.apply({ kind: 'deleteSet', operationId: crypto.randomUUID(), relationId: (await repository.load()).exercises[0].relationId, id: originalId })
    const undo = undoDeletedSet({ id: originalId, weight: '80', reps: '10' }, 0, (await repository.load()).exercises[0].relationId)
    await repository.apply(undo.command)
    await new CloudSync(repository, client).push()
    expect(rpc.mock.calls.slice(-2).map(([, args]) => [args.p_action, args.p_entity_id])).toEqual([
      ['delete', originalId], ['upsert', undo.set.id],
    ])
    expect((await repository.load()).exercises[0]?.sets.map((set) => set.id)).toEqual([undo.set.id])
  })
})
