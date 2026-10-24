import { useState } from 'react'
import { library, isLoggable } from '../../data/catalog/library'
import type { TrainingPlanView } from '../../data/ports/WorkoutRepository'
import { Button } from '../../shared/Button'

export function TrainingPlanEditor({ initial, busy, onSave, onCancel }: { initial?: TrainingPlanView; busy: boolean; onSave: (plan: TrainingPlanView) => Promise<boolean>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [names, setNames] = useState<string[]>(initial?.exerciseNames ?? [])
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState('')
  const results = library.filter((item) => isLoggable(item) && `${item.name} ${item.originalName}`.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))).slice(0, 20)
  const add = (name: string) => { if (!names.some((value) => value.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))) setNames((current) => [...current, name]); setQuery('') }
  const move = (index: number, direction: number) => setNames((current) => { const next = [...current]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })
  return <section className="plan-editor journal-screen"><button className="text-action" onClick={onCancel}>← Мои тренировки</button><p className="screen-eyebrow">СОСТАВ НА БУДУЩИЕ ТРЕНИРОВКИ</p><h1>{initial ? 'Изменить тренировку' : 'Создать тренировку'}</h1><p className="date-line">Состав сохранится для будущих посещений зала. Подходы запишете при запуске.</p>
    <label className="search-label" htmlFor="plan-title">Название</label><input id="plan-title" className="search-input" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Название вашей тренировки" />
    <h2 className="screen-subtitle">Упражнения · {names.length}</h2><ol className="plan-selected">{names.map((name, index) => <li key={name}><span>{index + 1}. {name}</span><Button variant="quiet" disabled={busy || index === 0} aria-label={`Поднять ${name}`} onClick={() => move(index, -1)}>↑</Button><Button variant="quiet" disabled={busy || index === names.length - 1} aria-label={`Опустить ${name}`} onClick={() => move(index, 1)}>↓</Button><Button variant="quiet" disabled={busy} aria-label={`Убрать ${name}`} onClick={() => setNames((current) => current.filter((item) => item !== name))}>×</Button></li>)}</ol>
    <label className="search-label" htmlFor="plan-search">Добавить из библиотеки</label><input id="plan-search" className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск упражнения" /><div className="plan-results">{results.map((item) => <button key={item.id} disabled={busy || names.includes(item.name)} onClick={() => add(item.name)}>＋ {item.name}</button>)}</div>
    <div className="plan-custom"><input className="search-input" aria-label="Своё упражнение для программы" maxLength={120} value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Или своё упражнение" /><Button variant="quiet" disabled={busy || !custom.trim()} onClick={() => { add(custom.trim()); setCustom('') }}>Добавить</Button></div>
    <Button className="add-button" disabled={busy || !title.trim() || !names.length} onClick={() => void onSave({ id: initial?.id ?? crypto.randomUUID(), title: title.trim(), exerciseNames: names })}>Сохранить тренировку</Button>
  </section>
}
