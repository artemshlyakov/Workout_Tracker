import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { JournalView } from '../../data/ports/WorkoutRepository'
import { ProgressScreen } from './JournalScreens'

const workout = (id: string, weight: number, completed = true): JournalView['workouts'][number] => ({
  id, title: 'Тренировка', startedAt: new Date().toISOString(), completedAt: completed ? new Date().toISOString() : null,
  exercises: [{ id: 'press', name: 'Жим', sets: [{ weight, reps: 10 }] }],
})

describe('real progress charts', () => {
  it('shows a point from the first completed workout and selects an exercise with results', () => {
    const html = renderToStaticMarkup(<ProgressScreen journal={{ exercises: [{ id: 'unused', name: 'Без подходов' }, { id: 'press', name: 'Жим' }], workouts: [workout('one', 80)] }} />)
    expect((html.match(/class="trend-chart /g) ?? [])).toHaveLength(2)
    expect(html).toContain('Жим')
    expect(html).toContain('Первая запись — начало графика')
    expect(html).toContain('800')
  })

  it('keeps active workouts out of charts and combines completed volume for the same day', () => {
    const journal: JournalView = { exercises: [{ id: 'press', name: 'Жим' }], workouts: [workout('one', 80), workout('two', 85), workout('active', 200, false)] }
    const html = renderToStaticMarkup(<ProgressScreen journal={journal} />)
    expect(html).toMatch(/1[^0-9]650/)
    expect(html).not.toContain('2 000')
    expect(html).toContain('85 кг')
    const empty = renderToStaticMarkup(<ProgressScreen journal={{ ...journal, workouts: [workout('active', 200, false)] }} />)
    expect(empty).not.toContain('class="trend-chart ')
    expect(empty).toContain('График появится после первой тренировки')
  })

  it('draws a dated line when completed workouts span multiple days', () => {
    const older = workout('older', 70)
    older.startedAt = new Date(Date.now() - 86400000).toISOString()
    const html = renderToStaticMarkup(<ProgressScreen journal={{ exercises: [{ id: 'press', name: 'Жим' }], workouts: [workout('today', 80), older] }} />)
    expect((html.match(/class="trend-chart__line"/g) ?? [])).toHaveLength(2)
    expect(html).toContain('80 кг')
  })
})
