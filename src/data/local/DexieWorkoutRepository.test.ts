import 'fake-indexeddb/auto'
import Dexie from 'dexie'
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

describe('saved workouts', () => {
  it('upgrades a v1 IndexedDB without losing its workout or pending operation', async () => {
    const name = `upgrade-${id()}`, workoutId = id(), operationId = id(), time = new Date().toISOString()
    const legacy = new Dexie(name)
    legacy.version(1).stores({ workspaces: 'id', workouts: 'id, workspaceId', exercises: 'id, workspaceId', workoutExercises: 'id, workspaceId, workoutId, exerciseId', exerciseSets: 'id, workspaceId, workoutExerciseId', outbox: '++sequence, &operationId, workspaceId, entityId, createdAt', syncState: 'workspaceId' })
    const workout = { id: workoutId, workspaceId: owner, ownerUserId: owner, serverRevision: null, localRevision: 1, createdAt: time, updatedAt: time, deletedAt: null, title: 'Старая запись', startedAt: time, completedAt: null }
    await legacy.table('workspaces').add({ id: owner, mode: 'authenticated', ownerUserId: owner, createdAt: time, lastActiveAt: time })
    await legacy.table('syncState').add({ workspaceId: owner, ownerUserId: owner, cursor: null, lastAckAt: null })
    await legacy.table('workouts').add(workout)
    await legacy.table('outbox').add({ operationId, workspaceId: owner, ownerUserId: owner, entityType: 'workout', entityId: workoutId, action: 'upsert', snapshot: workout, baseServerRevision: null, status: 'pending', attempts: 0, lastError: null, createdAt: time })
    legacy.close()
    const upgraded = new DexieWorkoutRepository(new WorkoutDatabase(name), { ownerUserId: owner })
    expect((await upgraded.load()).title).toBe('Старая запись')
    expect(await upgraded.listPlans()).toEqual([])
    expect((await upgraded.db.outbox.toArray()).map((row) => row.operationId)).toEqual([operationId])
    upgraded.db.close(); await upgraded.db.delete()
  })

  it('keeps an edited plan, starts three exercises without sets, and preserves history after deletion', async () => {
    const planId = id()
    await repository.savePlan({ id: planId, title: 'Мой день', exerciseNames: ['Жим', 'Тяга', 'Присед'] }, id())
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({ entityType: 'trainingPlan', action: 'upsert' })
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name), { ownerUserId: owner })
    expect(await reopened.listPlans()).toEqual([{ id: planId, title: 'Мой день', exerciseNames: ['Жим', 'Тяга', 'Присед'] }])
    await reopened.savePlan({ id: planId, title: 'Новый день', exerciseNames: ['Присед', 'Жим', 'Тяга'] }, id())
    const [plan] = await reopened.listPlans()
    await reopened.apply({ kind: 'startWorkout', operationId: id(), workoutId: id(), title: plan.title, exerciseNames: plan.exerciseNames })
    const active = await reopened.load()
    expect(active.exercises.map((exercise) => [exercise.name, exercise.sets.length])).toEqual([['Присед', 0], ['Жим', 0], ['Тяга', 0]])
    await reopened.apply({ kind: 'saveSet', operationId: id(), id: id(), relationId: active.exercises[0].relationId, weight: '70', reps: '8', position: 0 })
    await reopened.apply({ kind: 'finishWorkout', operationId: id() })
    await reopened.deletePlan(planId, id())
    expect(await reopened.listPlans()).toEqual([])
    expect((await reopened.listJournal()).workouts[0]).toMatchObject({ title: 'Новый день', exercises: [{ name: 'Присед', sets: [{ weight: 70, reps: 8 }] }, { name: 'Жим', sets: [] }, { name: 'Тяга', sets: [] }] })
    expect((await reopened.db.outbox.toArray()).filter((operation) => operation.entityType === 'trainingPlan').map((operation) => operation.action)).toEqual(['upsert', 'upsert', 'delete'])
    reopened.db.close()
  })

  it('restores saved workouts as new copies, including a backup made before this feature', async () => {
    const planId = id()
    await repository.savePlan({ id: planId, title: 'План', exerciseNames: ['Жим'] }, id())
    const backup = await repository.exportAccountData()
    expect(await repository.importAccountData(backup)).toBe(0)
    expect((await repository.listPlans()).map((plan) => plan.title)).toEqual(['План', 'План'])
    expect((await db.outbox.toArray()).filter((operation) => operation.entityType === 'trainingPlan')).toHaveLength(2)
    const oldBackup = JSON.parse(backup)
    delete oldBackup.trainingPlans
    expect(await repository.importAccountData(JSON.stringify(oldBackup))).toBe(0)
    expect((await repository.listPlans()).length).toBe(2)
  })

  it('stores height and body weight for the current workspace', async () => {
    await repository.saveBodyProfile({ heightCm: 180, bodyWeightKg: 79.5 })
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name), { ownerUserId: owner })
    expect(await reopened.loadBodyProfile()).toEqual({ heightCm: 180, bodyWeightKg: 79.5 })
    await expect(reopened.saveBodyProfile({ heightCm: 500, bodyWeightKg: 79.5 })).rejects.toThrow('рост и вес')
    reopened.db.close()
  })
})

describe('personal diary reliability', () => {
  it('persists incomplete input separately without generating fictitious sets or operations', async () => {
    const workoutId = await start(); const relation = await add('Жим')
    const pending = await db.outbox.toArray()
    const draft = { workoutId, title: 'Черновик', dirty: true, rows: { [relation]: [{ id: id(), weight: '80', reps: '', saved: false, dirty: true, position: 0 }] }, restUntil: Date.now() + 90000 }
    await repository.saveDraft(draft)
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name), { ownerUserId: owner })
    expect(await reopened.loadDraft()).toEqual(draft)
    expect((await reopened.load()).exercises[0].sets).toEqual([])
    expect(await reopened.db.outbox.toArray()).toEqual(pending)
    reopened.db.close()
  })

  it('creates a routine atomically, reorders exercises, and deletes children before parents', async () => {
    await repository.apply({ kind: 'startWorkout', operationId: id(), workoutId: id(), title: 'Всё тело', exerciseNames: ['Жим', 'Тяга', 'Присед'] })
    let view = await repository.load()
    expect(view.exercises.map((row) => row.sets)).toEqual([[], [], []])
    await set(view.exercises[0].relationId)
    await repository.apply({ kind: 'moveExercise', operationId: id(), relationId: view.exercises[0].relationId, direction: 1 })
    view = await repository.load()
    expect(view.exercises.map((row) => row.name)).toEqual(['Тяга', 'Жим', 'Присед'])
    await repository.apply({ kind: 'removeExercise', operationId: id(), relationId: view.exercises[1].relationId })
    expect((await db.outbox.toArray()).slice(-2).map((row) => [row.entityType, row.action])).toEqual([['exerciseSet', 'delete'], ['workoutExercise', 'delete']])
    await repository.apply({ kind: 'discardWorkout', operationId: id() })
    expect((await repository.listJournal()).workouts).toEqual([])
    expect((await db.outbox.toArray()).at(-1)?.entityType).toBe('workout')
    expect(await db.exercises.count()).toBe(3)
  })

  it('reopens and completes an old session without moving its completion to today', async () => {
    const workoutId = await start(); const relation = await add('Жим'); await set(relation)
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    const completed = (await repository.listJournal()).workouts[0].completedAt
    await repository.apply({ kind: 'reopenWorkout', operationId: id(), workoutId })
    await set(relation, '85', '8', 1)
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    const result = (await repository.listJournal()).workouts[0]
    expect(result.completedAt).toBe(completed)
    expect(result.exercises[0].sets).toHaveLength(2)
  })

  it('restores as new copies and preserves all original records and pending operations', async () => {
    const original = await start(); const relation = await add('Жим'); await set(relation)
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    const backup = await repository.exportAccountData()
    const pending = await db.outbox.toArray()
    expect(await repository.importAccountData(backup)).toBe(1)
    const journal = await repository.listJournal()
    expect(journal.workouts).toHaveLength(2)
    expect(journal.workouts.find((row) => row.id === original)?.exercises[0].sets).toHaveLength(1)
    expect(journal.workouts.find((row) => row.id !== original)?.exercises[0].sets).toHaveLength(1)
    const after = await db.outbox.toArray()
    expect(after.slice(0, pending.length)).toEqual(pending)
    expect(after.slice(pending.length).map((row) => row.entityType)).toEqual(['workout', 'workoutExercise', 'exerciseSet'])
    await expect(repository.importAccountData(backup)).rejects.toThrow('уже восстановлена')
    const foreign = JSON.parse(backup); foreign.ownerUserId = id()
    await expect(repository.importAccountData(JSON.stringify(foreign))).rejects.toThrow()
    expect(await db.outbox.toArray()).toEqual(after)
  })

  it('rolls back an entire import when its new outbox operation fails', async () => {
    await start(); const relation = await add('Жим'); await set(relation)
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    const backup = await repository.exportAccountData(), before = await db.outbox.toArray()
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('disk full'))
    await expect(repository.importAccountData(backup)).rejects.toThrow('disk full')
    expect((await repository.listJournal()).workouts).toHaveLength(1)
    expect(await db.outbox.toArray()).toEqual(before)
  })
})

describe('personal exercise removal without losing history', () => {
  it('blocks an exercise in the active workout and preserves historical sets after archiving', async () => {
    await start('Архив'); const relation = await add('Старое упражнение'); await set(relation, '45', '12')
    const exerciseId = (await repository.listJournal()).exercises[0].id
    await expect(repository.apply({ kind: 'archiveExercise', operationId: id(), exerciseId })).rejects.toThrow('текущей тренировки')
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    await repository.apply({ kind: 'archiveExercise', operationId: id(), exerciseId })
    expect((await repository.listJournal()).exercises).toEqual([])
    expect((await repository.listJournal()).workouts[0].exercises[0]).toMatchObject({ name: 'Старое упражнение', sets: [{ weight: 45, reps: 12 }] })
    await expect(repository.apply({ kind: 'reopenWorkout', operationId: id(), workoutId: (await repository.listJournal()).workouts[0].id })).rejects.toThrow('архивное упражнение')
    expect((await db.outbox.toArray()).at(-1)).toMatchObject({ entityType: 'exercise', action: 'delete', entityId: exerciseId })
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name), { ownerUserId: owner })
    expect((await reopened.listJournal()).workouts[0].exercises[0].sets).toHaveLength(1)
    const backup = await reopened.exportAccountData()
    expect(await reopened.importAccountData(backup)).toBe(1)
    expect((await reopened.listJournal()).workouts.map((item) => item.exercises[0].name)).toEqual(['Старое упражнение', 'Старое упражнение'])
    reopened.db.close()
  })

  it('removes an unused personal exercise atomically with its outbox operation', async () => {
    await repository.load()
    const exerciseId = id()
    await repository.apply({ kind: 'createExercise', operationId: id(), exerciseId, name: 'Моё движение' })
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(repository.apply({ kind: 'archiveExercise', operationId: id(), exerciseId })).rejects.toThrow('outbox failed')
    expect((await db.exercises.get(exerciseId))?.deletedAt).toBeNull()
    await repository.apply({ kind: 'archiveExercise', operationId: id(), exerciseId })
    expect((await repository.listJournal()).exercises).toEqual([])
  })
})
