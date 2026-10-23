import { describe, expect, it } from 'vitest'
import { localDay, monthDays, previousExercise, workoutVolume } from './history'
import type { JournalEntry } from '../data/ports/WorkoutRepository'
describe('calendar and previous performance', () => {
  it('uses local calendar dates and Monday-first leap-year months', () => {
    expect(localDay(new Date(2024, 1, 29, 23, 59))).toBe('2024-02-29')
    const days = monthDays(2024, 1)
    expect(days.slice(0, 3)).toEqual([null, null, null])
    expect(days.filter(Boolean)).toHaveLength(29)
    expect(localDay(monthDays(2027, 0).filter(Boolean)[0]!)).toBe('2027-01-01')
  })
  it('ignores incomplete sessions and does not mutate journal order', () => {
    const row = (date: string, done: boolean, weight: number): JournalEntry => ({ id: date, title: 'Тест', startedAt: date, completedAt: done ? date : null, exercises: [{ id: 'exercise', name: 'Жим', sets: [{ weight, reps: 10 }] }] })
    const journal = [row('2026-03-02', true, 50), row('2026-03-05', false, 80), row('2026-03-04', true, 60)]
    expect(previousExercise(journal, 'exercise')?.sets[0].weight).toBe(60)
    expect(journal[0].startedAt).toBe('2026-03-02')
    expect(workoutVolume(journal[0])).toBe(500)
  })
})
