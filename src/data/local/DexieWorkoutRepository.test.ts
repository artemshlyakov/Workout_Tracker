import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DexieWorkoutRepository } from './DexieWorkoutRepository'
import { WorkoutDatabase } from './schema'

let db: WorkoutDatabase
let repository: DexieWorkoutRepository
const id = () => crypto.randomUUID()
const owner = '11111111-1111-4111-8111-111111111111'

beforeEach(() => { db = new WorkoutDatabase(`workout-test-${id()}`); repository = new DexieWorkoutRepository(db, { ownerUserId: owner }) })
afterEach(async () => { db.close(); await db.delete() })

async function start(title = 'Спина и бицепс') {
  const workoutId = id()
  await repository.apply({ kind: 'startWorkout', operationId: id(), workoutId, title })
  return workoutId
}
async function add(name: string) {
  const exerciseId = id(), relationId = id()
  await repository.apply({ kind: 'createExercise', operationId: id(), exerciseId, name })
  await repository.apply({ kind: 'addExercise', operationId: id(), exerciseId, relationId })
  return relationId
}
async function set(relationId: string, weight = '80', reps = '10', position = 0) {
  const setId = id()
  await repository.apply({ kind: 'saveSet', operationId: id(), id: setId, relationId, weight, reps, position })
  return setId
}

describe('multi-exercise workout repository', () => {
  it('opens an empty account and creates a named workout without an exercise', async () => {
    expect(await repository.load()).toEqual({ title: '', exercises: [], active: false })
    expect(await db.outbox.count()).toBe(0)
    await start('Ноги')
    expect(await repository.load()).toMatchObject({ title: 'Ноги', exercises: [], active: true })
    expect((await db.outbox.toArray()).map((op) => op.entityType)).toEqual(['workout'])
  })

  it('records three exercises, their independent sets, completion, and reload', async () => {
    const workoutId = await start()
    const first = await add('Приседания'), second = await add('Жим ногами'), third = await add('Подъём на носки')
    await set(first, '80', '8'); await set(first, '85', '6', 1)
    await set(second, '120', '12'); await set(third, '50', '15')
    const before = await repository.load()
    expect(before.exercises.map((exercise) => [exercise.name, exercise.sets.length])).toEqual([
      ['Приседания', 2], ['Жим ногами', 1], ['Подъём на носки', 1],
    ])
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name), { ownerUserId: owner })
    expect(await reopened.load()).toEqual(before)
    await reopened.apply({ kind: 'finishWorkout', operationId: id() })
    expect((await reopened.load()).active).toBe(false)
    const history = await reopened.listJournal()
    expect(history.workouts[0]).toMatchObject({ id: workoutId, title: 'Спина и бицепс' })
    expect(history.workouts[0].completedAt).not.toBeNull()
    expect(history.workouts[0].exercises.map((exercise) => exercise.sets.length)).toEqual([2, 1, 1])
    expect((await reopened.db.outbox.toArray()).map((op) => op.entityType)).toEqual([
      'workout', 'exercise', 'workoutExercise', 'exercise', 'workoutExercise', 'exercise',
      'workoutExercise', 'exerciseSet', 'exerciseSet', 'exerciseSet', 'exerciseSet', 'workout',
    ])
    reopened.db.close()
  })

  it('edits and deletes only the selected exercise set and keeps ordered operations', async () => {
    await start(); const first = await add('Тяга'), second = await add('Жим')
    const firstSet = await set(first), secondSet = await set(second, '60', '12')
    await repository.apply({ kind: 'saveSet', operationId: id(), id: firstSet, relationId: first, weight: '82,5', reps: '8', position: 0 })
    await repository.apply({ kind: 'deleteSet', operationId: id(), id: secondSet, relationId: second })
    expect((await repository.load()).exercises.map((exercise) => exercise.sets.map((item) => item.weight))).toEqual([['82,5'], []])
    expect((await db.exerciseSets.get(secondSet))?.deletedAt).not.toBeNull()
    expect((await db.outbox.toArray()).at(-1)?.action).toBe('delete')
    await expect(repository.apply({ kind: 'saveSet', operationId: id(), id: firstSet, relationId: second, weight: '90', reps: '8', position: 0 })).rejects.toThrow('другой области')
  })

  it('rolls back a set when its outbox write fails', async () => {
    await start(); const relationId = await add('Тяга')
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(set(relationId)).rejects.toThrow('outbox failed')
    expect(await db.exerciseSets.count()).toBe(0)
    expect(await db.outbox.count()).toBe(3)
  })

  it('does not duplicate a replayed operation and refuses empty completion', async () => {
    await start(); const relationId = await add('Тяга')
    await expect(repository.apply({ kind: 'finishWorkout', operationId: id() })).rejects.toThrow('хотя бы один подход')
    const command = { kind: 'saveSet' as const, operationId: id(), id: id(), relationId, weight: '80', reps: '10', position: 0 }
    await repository.apply(command); await repository.apply(command)
    expect(await db.exerciseSets.count()).toBe(1)
    expect(await db.outbox.count()).toBe(4)
  })

  it('preserves the earlier dev-format backup and its pending outbox', async () => {
    const legacy = new DexieWorkoutRepository(new WorkoutDatabase(`legacy-${id()}`))
    const initial = await legacy.load()
    expect(initial.exercises[0].sets).toHaveLength(3)
    const json = await legacy.exportData()
    const restored = new DexieWorkoutRepository(new WorkoutDatabase(`restored-${id()}`))
    expect(await restored.importData(json)).toEqual(initial)
    expect(await restored.db.outbox.count()).toBe(6)
    legacy.db.close(); await legacy.db.delete(); restored.db.close(); await restored.db.delete()
  })
})
