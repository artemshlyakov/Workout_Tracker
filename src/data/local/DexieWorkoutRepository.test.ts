import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DexieWorkoutRepository } from './DexieWorkoutRepository'
import { WorkoutDatabase } from './schema'

let db: WorkoutDatabase
let repository: DexieWorkoutRepository
const id = () => crypto.randomUUID()

beforeEach(() => {
  db = new WorkoutDatabase(`workout-test-${id()}`)
  repository = new DexieWorkoutRepository(db)
})
afterEach(async () => { db.close(); await db.delete() })

describe('local workout repository', () => {
  it('saves seed data and loads it after reopening the database', async () => {
    const initial = await repository.load()
    expect(initial.sets).toHaveLength(3)
    expect(await db.outbox.count()).toBe(6)
    db.close()
    const reopened = new DexieWorkoutRepository(new WorkoutDatabase(db.name))
    expect(await reopened.load()).toEqual(initial)
    reopened.db.close()
  })

  it('edits and soft deletes a set with matching outbox records', async () => {
    const set = (await repository.load()).sets[0]
    await repository.apply({ kind: 'saveSet', operationId: id(), ...set, weight: '82,5' })
    expect((await repository.load()).sets[0].weight).toBe('82,5')
    await repository.apply({ kind: 'deleteSet', operationId: id(), id: set.id })
    expect((await repository.load()).sets).toHaveLength(2)
    const record = await db.exerciseSets.get(set.id)
    expect(record?.deletedAt).not.toBeNull()
    expect(record?.localRevision).toBe(3)
    expect(await db.outbox.count()).toBe(8)
    expect((await db.outbox.toArray()).at(-1)?.action).toBe('delete')
  })

  it('keeps record and outbox changes atomic when writing the outbox fails', async () => {
    const set = (await repository.load()).sets[0]
    const before = await db.exerciseSets.get(set.id)
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('outbox failed'))
    await expect(repository.apply({ kind: 'saveSet', operationId: id(), ...set, weight: '90' })).rejects.toThrow('outbox failed')
    expect(await db.exerciseSets.get(set.id)).toEqual(before)
    expect(await db.outbox.count()).toBe(6)
  })

  it('does not duplicate an operation when the same command is replayed', async () => {
    const set = (await repository.load()).sets[0]
    const command = { kind: 'saveSet' as const, operationId: id(), ...set, reps: '8' }
    await repository.apply(command)
    await repository.apply(command)
    expect((await db.exerciseSets.get(set.id))?.localRevision).toBe(2)
    expect(await db.outbox.count()).toBe(7)
  })

  it('exports and imports a versioned backup including pending changes', async () => {
    const initial = await repository.load()
    await repository.apply({ kind: 'rename', operationId: id(), title: 'Вечерняя тренировка' })
    const json = await repository.exportData()
    const other = new DexieWorkoutRepository(new WorkoutDatabase(`workout-import-${id()}`))
    expect((await other.importData(json)).title).toBe('Вечерняя тренировка')
    expect((await other.load()).sets).toEqual(initial.sets)
    expect(await other.db.outbox.count()).toBe(7)
    other.db.close()
    await other.db.delete()
  })

  it('rejects malformed and invalid backups without changing data', async () => {
    const initial = await repository.load()
    await expect(repository.importData('{broken')).rejects.toThrow('Повреждённый JSON')
    const backup = JSON.parse(await repository.exportData())
    backup.exerciseSets[0].reps = -1
    await expect(repository.importData(JSON.stringify(backup))).rejects.toThrow('Повреждённые данные')
    expect(await repository.load()).toEqual(initial)
  })

  it('rolls back a failed import after clearing the old records', async () => {
    const initial = await repository.load()
    const json = await repository.exportData()
    vi.spyOn(db.exerciseSets, 'bulkAdd').mockRejectedValueOnce(new Error('import failed'))
    await expect(repository.importData(json)).rejects.toThrow('import failed')
    expect(await repository.load()).toEqual(initial)
    expect(await db.outbox.count()).toBe(6)
  })

  it('restores a deleted set using its stable ID', async () => {
    const set = (await repository.load()).sets[0]
    await repository.apply({ kind: 'deleteSet', operationId: id(), id: set.id })
    await repository.apply({ kind: 'restoreSet', operationId: id(), ...set })
    expect((await repository.load()).sets[0]).toEqual(set)
    expect((await db.exerciseSets.get(set.id))?.deletedAt).toBeNull()
  })

  it('loads and edits the live workout when an older workout is tombstoned', async () => {
    await repository.load()
    const old = (await db.workouts.toArray())[0]
    const relation = (await db.workoutExercises.toArray())[0]
    const liveId = id()
    const liveRelationId = id()
    await db.workouts.put({ ...old, deletedAt: new Date().toISOString() })
    await db.workouts.add({ ...old, id: liveId, title: 'Новая тренировка', createdAt: new Date(Date.now() + 1000).toISOString(), deletedAt: null })
    await db.workoutExercises.add({ ...relation, id: liveRelationId, workoutId: liveId })
    expect(await repository.load()).toEqual({ title: 'Новая тренировка', exerciseName: 'Жим штанги лёжа', sets: [] })
    await repository.apply({ kind: 'rename', operationId: id(), title: 'Обновлённая тренировка' })
    await repository.apply({ kind: 'saveSet', operationId: id(), id: id(), position: 0, weight: '70', reps: '8' })
    expect((await db.workouts.get(liveId))?.title).toBe('Обновлённая тренировка')
    expect((await db.workouts.get(old.id))?.title).toBe(old.title)
    expect((await db.exerciseSets.where('workoutExerciseId').equals(liveRelationId).count())).toBe(1)
  })

  it('finishes a workout, keeps its real history, and starts a separate one', async () => {
    const first = await repository.load()
    await repository.apply({ kind: 'finishWorkout', operationId: id() })
    expect(await repository.load()).toEqual({ title: '', sets: [], active: false })
    const history = await repository.listJournal()
    expect(history.workouts).toHaveLength(1)
    expect(history.workouts[0].completedAt).not.toBeNull()
    expect(history.workouts[0].exercises[0].sets).toHaveLength(first.sets.length)

    const newWorkout = id()
    await repository.apply({ kind: 'startWorkout', operationId: id(), relationOperationId: id(), workoutId: newWorkout, relationId: id() })
    expect(await repository.load()).toEqual({ title: 'Силовая тренировка', exerciseName: 'Жим штанги лёжа', sets: [] })
    const nextHistory = await repository.listJournal()
    expect(nextHistory.workouts.map((workout) => workout.id)).toContain(newWorkout)
    expect(nextHistory.workouts).toHaveLength(2)
    expect((await db.outbox.toArray()).slice(-2).map((operation) => operation.entityType)).toEqual(['workout', 'workoutExercise'])
    const backup = await repository.exportData()
    const restored = new DexieWorkoutRepository(new WorkoutDatabase(`workout-history-import-${id()}`))
    await restored.importData(backup)
    expect(await restored.listJournal()).toEqual(nextHistory)
    restored.db.close()
    await restored.db.delete()
  })

  it('omits deleted sets from history and exercise results', async () => {
    const first = await repository.load()
    await repository.apply({ kind: 'deleteSet', operationId: id(), id: first.sets[0].id })
    const journal = await repository.listJournal()
    expect(journal.exercises.map((exercise) => exercise.name)).toEqual(['Жим штанги лёжа'])
    expect(journal.workouts[0].exercises[0].sets).toHaveLength(2)
  })
})
