// Controlled Plan 003B live adapter check. Run only with the two pilot accounts.
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CloudSync } from '../../src/data/cloud/sync'
import { DexieWorkoutRepository } from '../../src/data/local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../../src/data/local/schema'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY
assert.ok(url?.startsWith('https://') && key?.startsWith('sb_publishable_'), 'Нужны публичные URL и publishable key')
const file = process.env.SUPABASE_TEST_CREDENTIALS_FILE ?? '/tmp/workout-tracker-plan003b-auth.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as { project: string; accounts: { email: string; password: string; id: string }[] }
assert.equal(data.project, new URL(url).host)
assert.equal(data.accounts.length, 2)

async function login(entry: typeof data.accounts[number]) {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data: result, error } = await client.auth.signInWithPassword({ email: entry.email, password: entry.password })
  assert.ifError(error)
  assert.equal(result.user?.id, entry.id)
  return client
}

async function apply(client: SupabaseClient, type: string, entityId: string, payload: Record<string, unknown>) {
  const { data: response, error } = await client.rpc('apply_workout_operation', {
    p_operation_id: randomUUID(), p_entity_type: type, p_entity_id: entityId,
    p_action: 'upsert', p_base_revision: null, p_payload: payload,
  })
  assert.ifError(error)
  assert.equal(response?.status, 'applied')
}

const [a, b] = await Promise.all(data.accounts.map(login))
const databases: WorkoutDatabase[] = []
try {
  const repositories = []
  for (const [index, client] of [a, b].entries()) {
    const owner = data.accounts[index].id
    const workoutId = randomUUID(), exerciseId = randomUUID(), relationId = randomUUID()
    const title = `Plan 003B adapter ${index ? 'B' : 'A'} ${workoutId.slice(0, 8)}`
    await apply(client, 'workout', workoutId, { title, started_at: new Date().toISOString(), completed_at: null })
    await apply(client, 'exercise', exerciseId, { name: 'Тестовое упражнение' })
    await apply(client, 'workout_exercise', relationId, { workout_id: workoutId, exercise_id: exerciseId, position: 0 })
    const db = new WorkoutDatabase(`workout-live-${randomUUID()}`)
    databases.push(db)
    const repository = new DexieWorkoutRepository(db, { ownerUserId: owner })
    const sync = new CloudSync(repository, client)
    assert.equal((await sync.prepare()).cloudChecked, true)
    assert.equal((await repository.load()).title, title)
    repositories.push({ repository, client, title, workoutId, owner, sync })
  }
  const first = repositories[0]
  const second = repositories[1]
  await first.repository.apply({ kind: 'rename', operationId: randomUUID(), title: 'Plan 003B synced rename A' })
  const setId = randomUUID()
  await first.repository.apply({ kind: 'saveSet', operationId: randomUUID(), id: setId, position: 0, weight: '82,5', reps: '8' })
  assert.equal(await first.sync.pendingCount(), 2)
  const wrongOwner = new CloudSync(first.repository, b)
  await assert.rejects(wrongOwner.push(), /другого аккаунта/)
  assert.equal(await first.sync.pendingCount(), 2)
  const pushed = await first.sync.push()
  assert.equal(pushed.pending, 0)
  assert.equal(pushed.acknowledged, 2)
  const cloud = await a.from('workouts').select('title').eq('id', first.workoutId).single()
  assert.ifError(cloud.error)
  assert.equal(cloud.data?.title, 'Plan 003B synced rename A')
  const cloudSet = await a.from('exercise_sets').select('weight_kg,reps').eq('id', setId).single()
  assert.ifError(cloudSet.error)
  assert.equal(Number(cloudSet.data?.weight_kg), 82.5)
  assert.equal(cloudSet.data?.reps, 8)
  assert.equal((await second.repository.load()).title, second.title)
  assert.ok(!(await second.repository.exportAccountData()).includes(first.workoutId))

  await first.repository.apply({ kind: 'rename', operationId: randomUUID(), title: 'Plan 003B offline A' })
  assert.equal(await first.sync.pendingCount(), 1)
  first.repository.db.close()
  const reopenedDb = new WorkoutDatabase(first.repository.db.name)
  databases.push(reopenedDb)
  const reopened = new DexieWorkoutRepository(reopenedDb, { ownerUserId: first.owner })
  assert.equal((await reopened.load()).title, 'Plan 003B offline A')
  assert.equal((await new CloudSync(reopened, a).push()).pending, 0)
  const freshDb = new WorkoutDatabase(`workout-live-fresh-${randomUUID()}`)
  databases.push(freshDb)
  const fresh = new DexieWorkoutRepository(freshDb, { ownerUserId: first.owner })
  assert.equal((await new CloudSync(fresh, a).prepare()).cloudChecked, true)
  assert.equal((await fresh.load()).title, 'Plan 003B offline A')
  assert.equal((await fresh.load()).sets.some((set) => set.id === setId), true)
  console.log('Live adapter integration passed: A/B cache isolation, guarded JWT, push, offline queue, reopen and fresh pull')
} finally {
  for (const db of databases) db.close()
  for (const name of new Set(databases.map((db) => db.name))) await new WorkoutDatabase(name).delete()
}
