import { useEffect, useRef } from 'react'
import { parseReps, parseWeight, totalVolume, type SetField, type WorkoutSet } from '../../domain/workout'
import { Button } from '../../shared/Button'
import { SetRow } from './SetRow'

interface Props {
  sets: WorkoutSet[]
  newestId: string | null
  onChange: (id: string, field: SetField, value: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
}

const volumeFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function ExerciseCard({ sets, newestId, onChange, onAdd, onDelete }: Props) {
  const newRepsRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (newestId) newRepsRef.current?.focus() }, [newestId])
  const incomplete = sets.some((set) => parseWeight(set.weight) === null || parseReps(set.reps) === null || parseReps(set.reps)! < 1 || parseReps(set.reps)! > 1000 || parseWeight(set.weight)! > 2000)

  return <section className="exercise-card" aria-labelledby="exercise-title">
    <div className="exercise-card__heading">
      <div className="exercise-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
          <path d="M8 24h32M12 16v16M17 13v22M31 13v22M36 16v16" />
        </svg>
      </div>
      <div><p className="eyebrow">СИЛОВОЕ УПРАЖНЕНИЕ</p><h2 id="exercise-title">Жим штанги лёжа</h2></div>
    </div>
    <div className="exercise-card__summary">
      <div><span>Подходы</span><strong>{sets.length}</strong></div>
      <div><span>Общий объём</span><strong>{volumeFormatter.format(totalVolume(sets))} <small>кг</small></strong></div>
    </div>
    <div className="sets-heading"><h3>Подходы</h3><span>Вес × повторы</span></div>
    {sets.length === 0 ? <p className="empty-note">Подходов пока нет. Добавьте первый.</p> :
      <ol className="sets-list">{sets.map((set, index) => <SetRow key={set.id} set={set} index={index} onChange={onChange} onDelete={onDelete} repsRef={set.id === newestId ? newRepsRef : undefined} />)}</ol>}
    {incomplete && <p className="volume-note">Пустые и некорректные подходы не входят в объём.</p>}
    <Button className="add-button" onClick={onAdd}><span aria-hidden="true">＋</span> Добавить подход</Button>
  </section>
}
