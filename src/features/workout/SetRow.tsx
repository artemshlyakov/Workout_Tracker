import type { Ref } from 'react'
import { parseReps, parseWeight, type SetField, type WorkoutSet } from '../../domain/workout'
import { Button } from '../../shared/Button'
import { NumericField } from '../../shared/NumericField'

interface Props {
  set: WorkoutSet
  index: number
  onChange: (id: string, field: SetField, value: string) => void
  onDelete: (id: string) => void
  repsRef?: Ref<HTMLInputElement>
}

export function SetRow({ set, index, onChange, onDelete, repsRef }: Props) {
  return <li className="set-row">
    <span className="set-number" aria-label={`Подход ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
    <NumericField id={`weight-${set.id}`} label="Вес, кг" value={set.weight} kind="weight"
      invalid={set.weight.trim() !== '' && (parseWeight(set.weight) === null || parseWeight(set.weight)! > 2000)}
      onChange={(value) => onChange(set.id, 'weight', value)} />
    <NumericField id={`reps-${set.id}`} label="Повторы" value={set.reps} kind="reps"
      invalid={set.reps.trim() !== '' && (parseReps(set.reps) === null || parseReps(set.reps)! < 1 || parseReps(set.reps)! > 1000)}
      onChange={(value) => onChange(set.id, 'reps', value)} inputRef={repsRef} />
    <Button variant="quiet" className="delete-button" onClick={() => onDelete(set.id)} aria-label={`Удалить подход ${index + 1}`} title="Удалить подход">×</Button>
  </li>
}
