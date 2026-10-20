import { useRef, useState } from 'react'
import { addSet, initialSets, removeSet, updateSet, type SetField, type WorkoutSet } from '../domain/workout'
import { DemoSaveStatus } from '../features/workout/DemoSaveStatus'
import { ExerciseCard } from '../features/workout/ExerciseCard'
import { Button } from '../shared/Button'

export function App() {
  const [sets, setSets] = useState<WorkoutSet[]>(initialSets)
  const [title, setTitle] = useState('Силовая тренировка')
  const [newestId, setNewestId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ set: WorkoutSet; index: number } | null>(null)
  const nextId = useRef(4)
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date())

  function handleChange(id: string, field: SetField, value: string) {
    setSets((current) => updateSet(current, id, field, value))
  }

  function handleAdd() {
    const id = String(nextId.current++)
    setSets((current) => addSet(current, id))
    setNewestId(id)
    setRemoved(null)
  }

  function handleDelete(id: string) {
    const index = sets.findIndex((set) => set.id === id)
    if (index < 0) return
    setRemoved({ set: sets[index], index })
    setSets((current) => removeSet(current, id))
    if (newestId === id) setNewestId(null)
  }

  function handleUndo() {
    if (!removed) return
    setSets((current) => {
      const restored = [...current]
      restored.splice(Math.min(removed.index, restored.length), 0, removed.set)
      return restored
    })
    setRemoved(null)
  }

  return <main className="app-shell">
    <header className="page-header">
      <div className="header-kicker"><span className="live-dot" aria-hidden="true" /> АКТИВНАЯ ТРЕНИРОВКА</div>
      <h1>Тренировка</h1>
      <p className="date-line">{date}</p>
    </header>
    <DemoSaveStatus />
    <section className="workout-title-card" aria-label="Название тренировки">
      <label htmlFor="workout-title">НАЗВАНИЕ ТРЕНИРОВКИ</label>
      <input id="workout-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} aria-label="Название тренировки" />
    </section>
    <ExerciseCard sets={sets} newestId={newestId} onChange={handleChange} onAdd={handleAdd} onDelete={handleDelete} />
    {removed && <div className="undo-panel" role="status"><span>Подход удалён</span><Button variant="quiet" onClick={handleUndo}>Отменить</Button></div>}
    <p className="footer-note">Изменения существуют только до перезагрузки страницы.</p>
  </main>
}
