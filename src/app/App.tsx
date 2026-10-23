import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { parseReps, parseWeight } from '../domain/workout'
import type { JournalView, WorkoutCommand, WorkoutRepository, WorkoutView } from '../data/ports/WorkoutRepository'
import { Button } from '../shared/Button'
import { ExercisesScreen, HistoryScreen, ProgressScreen } from '../features/journal/JournalScreens'

type Tab = 'workout' | 'history' | 'exercises' | 'progress'
type Draft = { id: string; weight: string; reps: string; position: number; saved: boolean; dirty: boolean }
interface Props { repository: WorkoutRepository; authenticated?: boolean; onLocalWrite?: () => void; onDraftStateChange?: (unsaved: boolean) => void }
const uuid = () => crypto.randomUUID()
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'неизвестная ошибка'
const valid = (set: Draft) => { const weight = parseWeight(set.weight), reps = parseReps(set.reps); return weight !== null && weight <= 2000 && reps !== null && reps >= 1 && reps <= 1000 }
const fromView = (view: WorkoutView): Record<string, Draft[]> => Object.fromEntries(view.exercises.map((exercise) => [exercise.relationId, exercise.sets.map((set) => ({ ...set, saved: true, dirty: false }))]))

export function App({ repository, authenticated = false, onLocalWrite, onDraftStateChange }: Props) {
  const [view, setView] = useState<WorkoutView | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({})
  const [title, setTitle] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [exerciseName, setExerciseName] = useState('')
  const [picker, setPicker] = useState(false)
  const [tab, setTab] = useState<Tab>('workout')
  const [journal, setJournal] = useState<JournalView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [removed, setRemoved] = useState<{ relationId: string; draft: Draft } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date())

  const refresh = useCallback(async (preserveDrafts = false) => {
    const next = await repository.load()
    setView(next)
    setTitle((current) => preserveDrafts && current.trim() ? current : next.title)
    setDrafts((current) => {
      const loaded = fromView(next)
      if (preserveDrafts) for (const relationId of Object.keys(loaded)) {
        const pending = (current[relationId] ?? []).filter((draft) => draft.dirty)
        loaded[relationId] = loaded[relationId].map((item) => pending.find((draft) => draft.id === item.id) ?? item)
          .concat(pending.filter((draft) => !draft.saved && !loaded[relationId].some((item) => item.id === draft.id)))
      }
      return loaded
    })
    setJournal(await repository.listJournal())
  }, [repository])

  useEffect(() => { let active = true; refresh().catch((cause: unknown) => { if (active) setError(message(cause)) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [refresh])
  const unsaved = Boolean(view?.active && (title.trim() !== view.title || Object.values(drafts).some((sets) => sets.some((set) => set.dirty))))
  useEffect(() => { onDraftStateChange?.(unsaved || busy) }, [unsaved, busy, onDraftStateChange])

  async function apply(command: WorkoutCommand, preserveDrafts = false) {
    setBusy(true); setError(null); setNotice(null)
    try { await repository.apply(command); onLocalWrite?.(); await refresh(preserveDrafts); return true }
    catch (cause) { setError(message(cause)); return false }
    finally { setBusy(false) }
  }
  function addDraft(relationId: string) {
    setDrafts((current) => {
      const list = current[relationId] ?? []
      const previous = [...list].reverse().find((set) => parseWeight(set.weight) !== null)
      return { ...current, [relationId]: [...list, { id: uuid(), weight: previous?.weight ?? '', reps: '', position: Math.max(-1, ...list.map((set) => set.position)) + 1, saved: false, dirty: true }] }
    })
  }
  function editDraft(relationId: string, id: string, field: 'weight' | 'reps', value: string) {
    setDrafts((current) => ({ ...current, [relationId]: current[relationId].map((set) => set.id === id ? { ...set, [field]: value, dirty: true } : set) }))
  }
  async function saveDraft(relationId: string, draft: Draft) {
    if (!valid(draft)) { setError('Укажите вес от 0 до 2000 кг и повторы от 1 до 1000'); return }
    const ok = await apply({ kind: 'saveSet', operationId: uuid(), id: draft.id, relationId, weight: draft.weight, reps: draft.reps, position: draft.position }, true)
    if (ok) setDrafts((current) => ({ ...current, [relationId]: current[relationId].map((set) => set.id === draft.id ? { ...set, saved: true, dirty: false } : set) }))
  }
  async function deleteDraft(relationId: string, draft: Draft) {
    if (!draft.saved) { setDrafts((current) => ({ ...current, [relationId]: current[relationId].filter((set) => set.id !== draft.id) })); return }
    if (await apply({ kind: 'deleteSet', operationId: uuid(), id: draft.id, relationId }, true)) setRemoved({ relationId, draft })
  }
  async function addExercise(exerciseId: string) {
    if (await apply({ kind: 'addExercise', operationId: uuid(), relationId: uuid(), exerciseId }, true)) setPicker(false)
  }
  async function createExercise() {
    const name = exerciseName.trim()
    if (!name) { setError('Введите название упражнения'); return }
    const exerciseId = uuid()
    if (await apply({ kind: 'createExercise', operationId: uuid(), exerciseId, name }, true)) {
      setExerciseName('')
      if (view?.active) await addExercise(exerciseId)
    }
  }
  async function exportData() {
    try {
      const json = await repository.exportData()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a'); link.href = url; link.download = 'workout-tracker-dev-backup.json'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Копия скачана')
    } catch (cause) { setError(message(cause)) }
  }
  async function importData(file?: File) {
    if (!file || !window.confirm('Импорт заменит все локальные тестовые данные. Продолжить?')) return
    try { await repository.importData(await file.text()); await refresh(); setNotice('Данные восстановлены') }
    catch (cause) { setError(message(cause)) }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  if (tab !== 'workout') return <><main className="app-shell app-shell--with-nav">
    {!journal ? <p role="status">Загружаем журнал…</p> : tab === 'history' ? <HistoryScreen journal={journal} /> : tab === 'exercises' ? <ExercisesScreen journal={journal} /> : <ProgressScreen journal={journal} />}
  </main><BottomNav tab={tab} onChange={setTab} /></>

  const savedCount = view?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0
  const catalog = (journal?.exercises ?? []).filter((exercise) => !view?.exercises.some((item) => item.exerciseId === exercise.id))
  return <><main className="app-shell app-shell--with-nav">
    <header className="page-header"><div className="header-kicker"><span className="live-dot" aria-hidden="true" /> ЖУРНАЛ ТРЕНИРОВОК</div><h1>Тренировка</h1><p className="date-line">{date}</p></header>
    {loading ? <p role="status">Загружаем тренировку…</p> : <>
      {error && <div role="alert" className="load-error">{error}</div>}
      {notice && <p role="status" className="backup-notice">{notice}</p>}
      {!view?.active ? <section className="empty-panel start-panel"><p className="eyebrow">НОВАЯ ТРЕНИРОВКА</p><h2>Начнём с названия</h2><p>Упражнения и подходы добавите после начала.</p><label htmlFor="new-workout-title">Название тренировки</label><input id="new-workout-title" className="search-input" maxLength={60} placeholder="Например, Спина и бицепс" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} /><Button disabled={busy || !newTitle.trim()} onClick={() => void (async () => { if (await apply({ kind: 'startWorkout', operationId: uuid(), workoutId: uuid(), title: newTitle })) setNewTitle('') })()}>Начать тренировку</Button></section> : <>
        <section className="workout-title-card" aria-label="Название тренировки"><label htmlFor="workout-title">НАЗВАНИЕ ТРЕНИРОВКИ</label><div className="title-edit"><input id="workout-title" maxLength={60} value={title} onChange={(event) => setTitle(event.target.value)} /><Button variant="quiet" disabled={busy || !title.trim() || title === view.title} onClick={() => void apply({ kind: 'rename', operationId: uuid(), title }, true)}>Сохранить</Button></div></section>
        <div className="workout-summary"><span>{view.exercises.length} упр.</span><span>{savedCount} сохранённых подходов</span></div>
        {view.exercises.map((exercise, exerciseIndex) => <section key={exercise.relationId} className="exercise-card multi-exercise-card" aria-labelledby={`exercise-${exercise.relationId}`}>
          <div className="exercise-card__heading"><div className="exercise-icon" aria-hidden="true">✦</div><div><p className="eyebrow">УПРАЖНЕНИЕ {String(exerciseIndex + 1).padStart(2, '0')}</p><h2 id={`exercise-${exercise.relationId}`}>{exercise.name}</h2></div></div>
          <div className="sets-heading"><h3>Подходы</h3><span>Вес × повторы</span></div>
          {(drafts[exercise.relationId] ?? []).length === 0 ? <p className="empty-note">Добавьте первый подход.</p> : <ol className="sets-list">{drafts[exercise.relationId].map((set, index) => <li key={set.id} className="set-row set-row--editable"><span className="set-number">{String(index + 1).padStart(2, '0')}</span><label className="numeric-field"><span>Вес, кг</span><input inputMode="decimal" aria-label={`${exercise.name}, подход ${index + 1}, вес`} value={set.weight} onChange={(event) => editDraft(exercise.relationId, set.id, 'weight', event.target.value)} /></label><label className="numeric-field"><span>Повторы</span><input inputMode="numeric" aria-label={`${exercise.name}, подход ${index + 1}, повторы`} value={set.reps} onChange={(event) => editDraft(exercise.relationId, set.id, 'reps', event.target.value)} /></label><Button variant="quiet" className="delete-button" disabled={busy} aria-label={`Удалить подход ${index + 1} — ${exercise.name}`} onClick={() => void deleteDraft(exercise.relationId, set)}>×</Button>{set.dirty && <Button className="set-save" disabled={busy || !valid(set)} onClick={() => void saveDraft(exercise.relationId, set)}>Сохранить подход</Button>}</li>)}</ol>}
          <Button className="add-button" disabled={busy} onClick={() => addDraft(exercise.relationId)}><span aria-hidden="true">＋</span> Добавить подход</Button>
        </section>)}
        <Button className="add-exercise-button" variant="quiet" onClick={() => setPicker((current) => !current)}>＋ Добавить упражнение</Button>
        {picker && <section className="exercise-picker" aria-label="Выбрать упражнение"><h2>Каталог упражнений</h2>{catalog.length ? <div className="picker-list">{catalog.map((exercise) => <Button key={exercise.id} variant="quiet" disabled={busy} onClick={() => void addExercise(exercise.id)}>{exercise.name} <span aria-hidden="true">＋</span></Button>)}</div> : <p className="empty-note">Свободных упражнений пока нет.</p>}<label htmlFor="custom-exercise">Своё упражнение</label><div className="picker-create"><input id="custom-exercise" className="search-input" maxLength={120} placeholder="Название упражнения" value={exerciseName} onChange={(event) => setExerciseName(event.target.value)} /><Button disabled={busy || !exerciseName.trim()} onClick={() => void createExercise()}>Создать</Button></div></section>}
        {removed && <div className="undo-panel" role="status">Подход удалён <Button variant="quiet" disabled={busy} onClick={() => void (async () => { const { relationId, draft } = removed; if (await apply({ kind: 'saveSet', operationId: uuid(), id: uuid(), relationId, weight: draft.weight, reps: draft.reps, position: draft.position }, true)) setRemoved(null) })()}>Отменить</Button></div>}
        <Button className="finish-button" variant="quiet" disabled={busy || savedCount === 0 || unsaved} onClick={() => void (async () => { if (await apply({ kind: 'finishWorkout', operationId: uuid() })) { setPicker(false); setTab('history') } })()}>Завершить тренировку</Button>
      </>}
      {!authenticated && <section className="backup-panel" aria-label="Резервная копия"><h2>Локальная копия</h2><div className="backup-actions"><Button variant="quiet" onClick={() => void exportData()}>Экспорт JSON</Button><Button variant="quiet" onClick={() => fileRef.current?.click()}>Импорт JSON</Button></div><input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Выбрать файл JSON для импорта" onChange={(event) => void importData(event.target.files?.[0])} /></section>}
    </>}
  </main><BottomNav tab={tab} onChange={setTab} /></>
}

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [{ id: 'workout', label: 'Тренировка' }, { id: 'history', label: 'История' }, { id: 'exercises', label: 'Упражнения' }, { id: 'progress', label: 'Прогресс' }]
  return <nav className="bottom-nav" aria-label="Разделы приложения">{items.map((item) => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}><TabIcon tab={item.id} /><small>{item.label}</small></button>)}</nav>
}
function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    workout: <><path d="M2 10v4m3-7v10m3-12v14m8-14v14m3-12v10m3-7v4M8 12h8" /></>,
    history: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m-11 4h4m-4 3h4" /></>,
    exercises: <><path d="M4 12h16M7 8v8m3-10v12m4-12v12m3-10v8" /></>,
    progress: <><path d="M4 20V12m5 8V8m5 12V4m5 16V10M2 20h20" /></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[tab]}</svg>
}
