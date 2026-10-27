import { useEffect, useRef, useState } from 'react'
import { exerciseInfo } from '../../data/catalog/library'
import { ExerciseImage } from '../library/ExerciseLibrary'

export interface ProgressChoice { id: string; name: string; archived: boolean; hasResults: boolean }

export function ProgressExercisePicker({ choices, selectedId, onSelect, onClose }: { choices: ProgressChoice[]; selectedId: string; onSelect: (id: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close() }, [])
  const matching = choices.filter((choice) => choice.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  return <dialog ref={dialog} className="progress-picker" aria-labelledby="progress-picker-title" onCancel={onClose} onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    <div className="progress-picker__handle" aria-hidden="true" />
    <div className="progress-picker__heading"><div><p className="screen-eyebrow">АНАЛИТИКА УПРАЖНЕНИЙ</p><h2 id="progress-picker-title">Выбрать упражнение</h2></div><button type="button" aria-label="Закрыть список упражнений" onClick={onClose}>×</button></div>
    <input className="search-input" type="search" aria-label="Поиск в списке упражнений" autoFocus placeholder="Поиск упражнения" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="progress-picker__list">{matching.map((choice) => <button type="button" key={choice.id} className="progress-picker__item" aria-current={choice.id === selectedId ? 'true' : undefined} onClick={() => onSelect(choice.id)}><ExerciseImage exercise={exerciseInfo(choice.name)} /><span><strong>{choice.name}</strong><small>{choice.archived ? 'В архиве' : choice.hasResults ? 'Есть результаты' : 'Пока нет записей'}</small></span><b aria-hidden="true">{choice.id === selectedId ? '✓' : '›'}</b></button>)}{!matching.length && <p className="empty-note">Упражнений с таким названием нет</p>}</div>
  </dialog>
}
