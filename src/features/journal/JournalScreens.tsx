import { useState } from 'react'
import type { JournalEntry, JournalView } from '../../data/ports/WorkoutRepository'
import { localDay } from '../../domain/history'
import { TrendChart, type TrendPoint } from './TrendChart'
import { ProgressExercisePicker, type ProgressChoice } from './ProgressExercisePicker'

const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const dateLabel = (value: string) => date.format(new Date(value))
const setCount = (workout: JournalEntry) => workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)
const volume = (workout: JournalEntry) => workout.exercises.reduce((sum, exercise) => sum + exercise.sets.reduce((total, set) => total + set.weight * set.reps, 0), 0)

export function HistoryScreen({ journal }: { journal: JournalView }) {
  const [selected, setSelected] = useState<string | null>(null)
  const workout = journal.workouts.find((entry) => entry.id === selected)
  if (workout) return <section className="journal-screen">
    <button className="text-action" onClick={() => setSelected(null)}>← История</button>
    <p className="screen-eyebrow">{workout.completedAt ? 'ЗАВЕРШЕНА' : 'ТЕКУЩАЯ ТРЕНИРОВКА'}</p>
    <h1>{workout.title}</h1><p className="date-line">{dateLabel(workout.startedAt)}</p>
    <div className="metric-row"><div><span>Подходы</span><strong>{setCount(workout)}</strong></div><div><span>Объём</span><strong>{number.format(volume(workout))} кг</strong></div></div>
    {workout.exercises.map((exercise) => <section className="journal-card" key={exercise.id}>
      <h2>{exercise.name}</h2>
      {exercise.sets.length ? <ol className="history-sets">{exercise.sets.map((set, index) => <li key={index}><span>{index + 1}</span><strong>{number.format(set.weight)} кг</strong><span>× {set.reps} повт.</span></li>)}</ol> : <p className="empty-note">Подходов пока нет</p>}
    </section>)}
  </section>
  return <section className="journal-screen">
    <p className="screen-eyebrow">ВАШ ДНЕВНИК</p><h1>История</h1><p className="date-line">Тренировки по датам, новые сверху</p>
    {journal.workouts.length ? <div className="journal-list">{journal.workouts.map((entry) => <button className="history-item" key={entry.id} onClick={() => setSelected(entry.id)}>
      <span className="history-date"><strong>{new Date(entry.startedAt).getDate()}</strong><small>{new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(entry.startedAt))}</small></span>
      <span className="history-detail"><strong>{entry.title}</strong><small>{entry.completedAt ? 'Завершена' : 'Текущая'} · {entry.exercises.length} упр. · {setCount(entry)} подх.</small><small>{number.format(volume(entry))} кг объёма</small></span>
      <span className="history-arrow" aria-hidden="true">›</span>
    </button>)}</div> : <div className="empty-panel"><strong>Пока нет тренировок</strong><p>Начните первую тренировку, и она появится здесь.</p></div>}
  </section>
}

export function ExercisesScreen({ journal }: { journal: JournalView }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const exercises = journal.exercises.filter((exercise) => exercise.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
  const exercise = journal.exercises.find((item) => item.id === selected)
  if (exercise) {
    const sessions = journal.workouts.filter((workout) => workout.completedAt).flatMap((workout) => workout.exercises.filter((item) => item.id === exercise.id && item.sets.length > 0).map((item) => ({ workout, sets: item.sets })))
    return <section className="journal-screen"><button className="text-action" onClick={() => setSelected(null)}>← Упражнения</button>
      <p className="screen-eyebrow">ЛИЧНЫЙ КАТАЛОГ</p><h1>{exercise.name}</h1>
      {sessions.length ? <div className="journal-list">{sessions.map(({ workout, sets }) => <div className="journal-card" key={workout.id}><strong>{dateLabel(workout.startedAt)}</strong><p>{sets.length} подх. · лучший вес {number.format(Math.max(...sets.map((set) => set.weight)))} кг</p></div>)}</div> : <div className="empty-panel"><strong>Результатов пока нет</strong><p>Завершите тренировку с этим упражнением, чтобы видеть результаты.</p></div>}
    </section>
  }
  return <section className="journal-screen"><p className="screen-eyebrow">ЛИЧНЫЙ КАТАЛОГ</p><h1>Упражнения</h1><p className="date-line">Упражнения из вашего журнала</p>
    <label className="search-label" htmlFor="exercise-search">Поиск упражнений</label><input id="exercise-search" className="search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название упражнения" type="search" />
    {exercises.length ? <div className="journal-list">{exercises.map((item) => <button className="exercise-item" key={item.id} onClick={() => setSelected(item.id)}><span className="exercise-item__icon" aria-hidden="true">✦</span><span>{item.name}</span><span className="history-arrow" aria-hidden="true">›</span></button>)}</div> : <div className="empty-panel"><strong>{query ? 'Ничего не найдено' : 'Упражнений пока нет'}</strong><p>{query ? 'Попробуйте другое название.' : 'Первое упражнение появится после создания тренировки.'}</p></div>}
  </section>
}

export function ProgressScreen({ journal }: { journal: JournalView }) {
  const [selected, setSelected] = useState('')
  const [period, setPeriod] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - period); cutoff.setHours(0, 0, 0, 0)
  const liveIds = new Set(journal.exercises.map((item) => item.id))
  const completed = journal.workouts.filter((workout) => workout.completedAt && (!period || new Date(workout.startedAt) >= cutoff))
  const loggedIds = new Set(completed.flatMap((workout) => workout.exercises.filter((exercise) => exercise.sets.length).map((exercise) => exercise.id)))
  const choices: ProgressChoice[] = [...new Map([...journal.exercises, ...journal.workouts.flatMap((workout) => workout.exercises.map((exercise) => ({ id: exercise.id, name: exercise.name })))].map((item) => [item.id, item])).values()]
    .map((item) => ({ ...item, archived: !liveIds.has(item.id), hasResults: loggedIds.has(item.id) }))
    .sort((a, b) => Number(b.hasResults) - Number(a.hasResults) || a.name.localeCompare(b.name, 'ru'))
  const exerciseId = choices.some((item) => item.id === selected) ? selected : choices[0]?.id
  const selectedChoice = choices.find((item) => item.id === exerciseId)
  const sessions = completed.flatMap((workout) => workout.exercises.filter((item) => item.id === exerciseId && item.sets.length > 0).map((item) => ({ date: workout.startedAt, best: Math.max(...item.sets.map((set) => set.weight)), volume: item.sets.reduce((sum, set) => sum + set.weight * set.reps, 0) }))).sort((a, b) => a.date.localeCompare(b.date))
  const dailyVolume = new Map<string, number>()
  for (const workout of completed) {
    if (!setCount(workout)) continue
    const day = localDay(workout.startedAt)
    dailyVolume.set(day, (dailyVolume.get(day) ?? 0) + volume(workout))
  }
  const volumePoints: TrendPoint[] = [...dailyVolume].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value }))
  const dailyBest = new Map<string, number>()
  for (const session of sessions) {
    const day = localDay(session.date)
    dailyBest.set(day, Math.max(dailyBest.get(day) ?? 0, session.best))
  }
  const weightPoints: TrendPoint[] = [...dailyBest].sort(([a], [b]) => a.localeCompare(b)).map(([day, value]) => ({ day, value }))
  const best = sessions.length ? Math.max(...sessions.map((session) => session.best)) : 0
  const total = sessions.reduce((sum, session) => sum + session.volume, 0)
  return <section className="journal-screen progress-screen"><p className="screen-eyebrow screen-eyebrow--blue">ТОЛЬКО ВАШИ ДАННЫЕ</p><h1>Прогресс</h1><p className="date-line">Результаты завершённых тренировок</p>
    <div className="segmented" aria-label="Период прогресса">{[[30, "30 дней"], [90, "90 дней"], [0, "Всё время"]].map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => setPeriod(Number(value))}>{label}</button>)}</div>
    {volumePoints.length ? <section className="journal-card chart-card"><div className="chart-card__heading"><div><p className="screen-eyebrow screen-eyebrow--blue">ВСЕ ТРЕНИРОВКИ</p><h2>Объём по дням</h2></div><strong>{volumePoints.length} дн.</strong></div><TrendChart points={volumePoints} unit="кг" label="Общий объём тренировок" /><p className="chart-card__hint">Сумма веса × повторов всех подходов за день.</p></section> : <div className="empty-panel"><strong>График появится после первой тренировки</strong><p>Завершите тренировку с подходами, чтобы увидеть реальные данные.</p></div>}
    {choices.length > 0 && <><h2 className="screen-subtitle">По упражнению</h2><button type="button" className="progress-exercise-trigger" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}><span><small>Упражнение</small><strong>{selectedChoice?.name}{selectedChoice?.archived ? ' · архив' : ''}</strong></span><span aria-hidden="true">⌄</span></button>
      {sessions.length ? <><div className="metric-row"><div><span>Лучший вес</span><strong>{number.format(best)} кг</strong></div><div><span>Объём за период</span><strong>{number.format(total)} кг</strong></div></div><section className="journal-card chart-card"><div className="chart-card__heading"><div><p className="screen-eyebrow screen-eyebrow--blue">РАБОЧИЙ ВЕС</p><h2>Лучший подход</h2></div><strong>{sessions.length} трен.</strong></div><TrendChart points={weightPoints} unit="кг" label={`Лучший вес: ${selectedChoice?.name ?? 'упражнение'}`} tone="action" /><p className="chart-card__hint">Максимальный вес в завершённой тренировке. За один день показан лучший результат.</p></section><h2 className="screen-subtitle">Последние результаты</h2><div className="journal-list">{[...sessions].reverse().slice(0, 6).map((session, index) => <div className="result-item" key={`${session.date}-${index}`}><span>{dateLabel(session.date)}</span><strong>{number.format(session.best)} кг</strong></div>)}</div></> : <div className="empty-panel"><strong>Пока нет результатов этого упражнения</strong><p>Выберите другое упражнение или завершите тренировку с подходами.</p></div>}</>}
    {pickerOpen && <ProgressExercisePicker choices={choices} selectedId={exerciseId ?? ''} onSelect={(id) => { setSelected(id); setPickerOpen(false) }} onClose={() => setPickerOpen(false)} />}
  </section>
}
