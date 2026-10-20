// Run only after the reviewed migration is applied and two controlled test users exist.
// Required environment: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEST_USER_A_JWT, TEST_USER_B_JWT.
// Never commit or print the JWTs. This script creates records in those two test accounts.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key,
  TEST_USER_A_JWT: aToken, TEST_USER_B_JWT: bToken } = process.env
if (![url, key, aToken, bToken].every(Boolean) || aToken === bToken) {
  throw new Error('Нужны URL, publishable key и разные JWT двух контролируемых тестовых пользователей')
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = { apikey: key, Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(new URL(path, url), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: response.status, data }
}

async function operation(token, input) {
  return request('/rest/v1/rpc/apply_workout_operation', { token, method: 'POST', body: input })
}

function applied(response) {
  assert.equal(response.status, 200)
  assert.equal(response.data.status, 'applied')
  return response.data
}

function rejected(response) {
  assert.ok(response.status >= 400, `Expected HTTP error; received ${response.status}`)
}

const workoutA = randomUUID()
const workoutB = randomUUID()
const exerciseB = randomUUID()
const timestamp = new Date().toISOString()
const newWorkout = (id, title) => ({
  p_operation_id: randomUUID(), p_entity_type: 'workout', p_entity_id: id,
  p_action: 'upsert', p_base_revision: null,
  p_payload: { title, started_at: timestamp, completed_at: null },
})
const createA = newWorkout(workoutA, 'Plan 003A test A')
const createB = newWorkout(workoutB, 'Plan 003A test B')

applied(await operation(aToken, createA))
applied(await operation(bToken, createB))
const ownA = await request(`/rest/v1/workouts?id=eq.${workoutA}&select=id,title,revision,deleted_at`, { token: aToken })
assert.equal(ownA.status, 200)
assert.equal(ownA.data.length, 1)
const ownB = await request(`/rest/v1/workouts?id=eq.${workoutB}&select=id`, { token: bToken })
assert.equal(ownB.status, 200)
assert.equal(ownB.data.length, 1)
const foreign = await request(`/rest/v1/workouts?id=eq.${workoutA}&select=id`, { token: bToken })
assert.equal(foreign.status, 200)
assert.deepEqual(foreign.data, [])
rejected(await request(`/rest/v1/workouts?id=eq.${workoutA}&select=id`))
rejected(await request(`/rest/v1/workouts?id=eq.${workoutA}`, {
  token: bToken, method: 'PATCH', body: { title: 'forged' },
}))
rejected(await request(`/rest/v1/workouts?id=eq.${workoutA}`, {
  token: aToken, method: 'PATCH', body: { revision: 999 },
}))
rejected(await request('/rest/v1/workouts', {
  token: aToken, method: 'POST', body: {
    id: randomUUID(), title: 'direct write', started_at: timestamp,
  },
}))
rejected(await request(`/rest/v1/workouts?id=eq.${workoutA}`, {
  token: aToken, method: 'DELETE',
}))
const foreignRpc = await operation(bToken, { ...createA, p_operation_id: randomUUID(),
  p_base_revision: 1, p_payload: { ...createA.p_payload, title: 'foreign RPC' } })
assert.equal(foreignRpc.status, 200)
assert.equal(foreignRpc.data.status, 'conflict')
assert.equal(foreignRpc.data.server_revision, null)
rejected(await operation(undefined, newWorkout(randomUUID(), 'anonymous')))

const replay = applied(await operation(aToken, createA))
assert.equal(replay.revision, 1)
rejected(await operation(aToken, { ...createA, p_payload: { ...createA.p_payload, title: 'changed replay' } }))
const duplicate = await operation(aToken, { ...createA, p_operation_id: randomUUID() })
assert.equal(duplicate.status, 200)
assert.equal(duplicate.data.status, 'conflict')
assert.equal(duplicate.data.server_revision, 1)

const update = { ...createA, p_operation_id: randomUUID(), p_base_revision: 1,
  p_payload: { ...createA.p_payload, title: 'Plan 003A updated A' } }
assert.equal(applied(await operation(aToken, update)).revision, 2)
const stale = { ...update, p_operation_id: randomUUID(), p_payload: { ...update.p_payload, title: 'stale write' } }
const conflict = await operation(aToken, stale)
assert.equal(conflict.status, 200)
assert.equal(conflict.data.status, 'conflict')
assert.equal(conflict.data.server_revision, 2)
assert.deepEqual((await operation(aToken, stale)).data, conflict.data)
const unchanged = await request(`/rest/v1/workouts?id=eq.${workoutA}&select=title,revision`, { token: aToken })
assert.equal(unchanged.data[0].title, 'Plan 003A updated A')
assert.equal(unchanged.data[0].revision, 2)

applied(await operation(bToken, {
  p_operation_id: randomUUID(), p_entity_type: 'exercise', p_entity_id: exerciseB,
  p_action: 'upsert', p_base_revision: null, p_payload: { name: 'Plan 003A exercise B' },
}))
rejected(await operation(bToken, {
  p_operation_id: randomUUID(), p_entity_type: 'workout_exercise', p_entity_id: randomUUID(),
  p_action: 'upsert', p_base_revision: null,
  p_payload: { workout_id: workoutA, exercise_id: exerciseB, position: 0 },
}))
const deleted = applied(await operation(aToken, {
  p_operation_id: randomUUID(), p_entity_type: 'workout', p_entity_id: workoutA,
  p_action: 'delete', p_base_revision: 2, p_payload: {},
}))
assert.equal(deleted.revision, 3)
const tombstone = await request(`/rest/v1/workouts?id=eq.${workoutA}&select=deleted_at,revision`, { token: aToken })
assert.equal(tombstone.data[0].revision, 3)
assert.ok(tombstone.data[0].deleted_at)
console.log('Security integration checks passed for A, B, anon, FK, replay, CAS and tombstone')
