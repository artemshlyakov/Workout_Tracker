import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { parseReps, parseWeight } from '../domain/workout'
import { localDay, previousExercise } from '../domain/history'
import type { JournalView, WorkoutCommand, WorkoutRepository, WorkoutView, TrainingPlanView } from '../data/ports/WorkoutRepository'
import { Button } from '../shared/Button'
import { ProgressScreen } from '../features/journal/JournalScreens'
import { CalendarHistory } from '../features/journal/CalendarHistory'
import { ExerciseImage, ExerciseLibrary } from '../features/library/ExerciseLibrary'
import { exerciseInfo } from '../data/catalog/library'
import { RestTimer } from '../features/workout/RestTimer'
import { TrainingPlanEditor } from '../features/workout/TrainingPlanEditor'

type Tab = 'workout' | 'history' | 'exercises' | 'progress'
type Draft = { id: string; weight: string; reps: string; position: number; saved: boolean; dirty: boolean }
interface Props { repository: WorkoutRepository; authenticated?: boolean; onLocalWrite?: () => void; onDraftStateChange?: (unsaved: boolean) => void; refreshToken?: number }
const uuid = () => crypto.randomUUID()
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Неизвестная ошибка'
const valid = (set: Draft) => { const weight = parseWeight(set.weight), reps = parseReps(set.reps); return weight !== null && weight <= 2000 && reps !== null && reps >= 1 && reps <= 1000 }
function rowsFrom(view: WorkoutView, existing: Record<string, Draft[]> = {}): Record<string, Draft[]> {
  return Object.fromEntries(view.exercises.map((exercise) => {
    const pending = (existing[exercise.relationId] ?? []).filter((set) => set.dirty)
    const saved = exercise.sets.map((set) => {
      const draft = pending.find((item) => item.id === set.id)
      return draft && (draft.weight !== set.weight || draft.reps !== set.reps) ? { ...draft, saved: true } : { ...set, saved: true, dirty: false }
    })
    return [exercise.relationId, [...saved, ...pending.filter((set) => !set.saved && !saved.some((item) => item.id === set.id))]]
  }))
}
const initialTab = (): Tab => { const value = location.hash.slice(2); return ['history', 'exercises', 'progress'].includes(value) ? value as Tab : 'workout' }

export function App({ repository, authenticated = false, onLocalWrite, onDraftStateChange, refreshToken = 0 }: Props) {
  const [view, setView] = useState<WorkoutView | null>(null)
  const viewRef = useRef<WorkoutView | null>(null)
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { window.dispatchEvent(new CustomEvent('workout-active', { detail: Boolean(view?.active) })); return () => { window.dispatchEvent(new CustomEvent('workout-active', { detail: false })) } }, [view?.active])
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({})
  const [title, setTitle] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [picker, setPicker] = useState(false)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [plans, setPlans] = useState<TrainingPlanView[]>([])
  const [editingPlan, setEditingPlan] = useState<TrainingPlanView | 'new' | null>(null)
  const [journal, setJournal] = useState<JournalView>({ workouts: [], exercises: [] })
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [restUntil, setRestUntil] = useState<number | null>(null)
  const [removed, setRemoved] = useState<{ relationId: string; draft: Draft } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const unsaved = Boolean(view?.active && (title !== view.title || Object.values(drafts).some((rows) => rows.some((row) => row.dirty))))
  const changeTab = (next: Tab) => { setPicker(false); setEditingPlan(null); setTab(next); history.replaceState(null, '', `#/${next}`); window.scrollTo({ top: 0 }) }

  const refresh = useCallback(async (preserve = true) => {
    const next = await repository.load()
    setView(next)
    setTitle((current) => preserve && viewRef.current?.workoutId === next.workoutId && current !== viewRef.current?.title ? current : next.title)
    setDrafts((current) => rowsFrom(next, preserve ? current : {}))
    if (!preserve) { setRemoved(null); setRestUntil(null) }
    setJournal(await repository.listJournal())
    setPlans(await repository.listPlans())
  }, [repository])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const next = await repository.load(), savedDraft = await repository.loadDraft(), nextJournal = await repository.listJournal()
        if (!active) return
        const draft = savedDraft?.workoutId === next.workoutId ? savedDraft : null
        setView(next); setTitle(draft?.titleDirty ? draft.title : next.title); setDrafts(rowsFrom(next, draft?.rows)); setRestUntil(draft?.restUntil ?? null); setJournal(nextJournal); setPlans(await repository.listPlans())
      } catch (cause) { if (active) setError(message(cause)) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [repository])
  useEffect(() => { if (refreshToken > 0) void refresh(true).catch((cause: unknown) => setError(message(cause))) }, [refreshToken, refresh])
  useEffect(() => { onDraftStateChange?.(unsaved || busy) }, [unsaved, busy, onDraftStateChange])
  useEffect(() => {
    if (loading || !view) return
    void repository.saveDraft(view.active && view.workoutId ? { workoutId: view.workoutId, title, titleDirty: title !== view.title, dirty: unsaved, rows: drafts, restUntil } : null)
      .catch(() => setError('Не удалось сохранить черновик. Не закрывайте приложение до сохранения подходов.'))
  }, [drafts, title, restUntil, view, loading, repository, unsaved])

  async function apply(command: WorkoutCommand, preserve = true) {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(null); setNotice(null)
    try {
      await repository.apply(command)
      await refresh(preserve)
      if (command.kind === 'rename') setTitle(command.title.trim())
      onLocalWrite?.()
      return true
    } catch (cause) { setError(message(cause)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  async function start(name: string, exerciseNames: readonly string[] = []) {
    if (await apply({ kind: 'startWorkout', operationId: uuid(), workoutId: uuid(), title: name, exerciseNames: [...exerciseNames] }, false)) { setNewTitle(''); changeTab('workout') }
  }
  async function savePlan(plan: TrainingPlanView) {
    try { setBusy(true); setError(null); await repository.savePlan(plan, uuid()); setPlans(await repository.listPlans()); setEditingPlan(null); onLocalWrite?.(); return true }
    catch (cause) { setError(message(cause)); return false } finally { setBusy(false) }
  }
  async function deletePlan(plan: TrainingPlanView) {
    if (!window.confirm(`Удалить тренировку «${plan.title}»? Уже записанные тренировки сохранятся.`)) return
    try { setBusy(true); setError(null); await repository.deletePlan(plan.id, uuid()); setPlans(await repository.listPlans()); onLocalWrite?.() }
    catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  function addDraft(relationId: string, exerciseId: string) {
    const last = previousExercise(journal.workouts, exerciseId)
    setDrafts((current) => {
      const rows = current[relationId] ?? []
      if (rows.some((row) => !row.saved && !row.weight && !row.reps)) return current
      const previous = [...rows].reverse().find((set) => parseWeight(set.weight) !== null)
      const previousWeight = last?.sets[rows.length]?.weight ?? last?.sets.at(-1)?.weight
      return { ...current, [relationId]: [...rows, { id: uuid(), weight: previous?.weight ?? (previousWeight === undefined ? '' : String(previousWeight).replace('.', ',')), reps: '', position: Math.max(-1, ...rows.map((set) => set.position)) + 1, saved: false, dirty: true }] }
    })
    setRemoved(null)
  }
  function editDraft(relationId: string, id: string, field: 'weight' | 'reps', value: string) {
    setDrafts((current) => ({ ...current, [relationId]: current[relationId].map((set) => set.id === id ? { ...set, [field]: value, dirty: true } : set) }))
  }
  async function saveRow(relationId: string, draft: Draft) {
    if (!valid(draft)) return
    if (await apply({ kind: 'saveSet', operationId: uuid(), id: draft.id, relationId, weight: draft.weight, reps: draft.reps, position: draft.position })) {
      setDrafts((current) => ({ ...current, [relationId]: current[relationId].map((set) => set.id === draft.id ? { ...set, saved: true, dirty: false } : set) }))
      if (!draft.saved) setRestUntil(Date.now() + 90000)
    }
  }
  async function deleteRow(relationId: string, draft: Draft) {
    if (!draft.saved) { setDrafts((current) => ({ ...current, [relationId]: current[relationId].filter((set) => set.id !== draft.id) })); return }
    const saved = view?.exercises.find((item) => item.relationId === relationId)?.sets.find((item) => item.id === draft.id)
    if (await apply({ kind: 'deleteSet', operationId: uuid(), id: draft.id, relationId })) setRemoved({ relationId, draft: { ...draft, ...saved } })
  }
  async function chooseExercise(name: string) {
    let exerciseId = journal.exercises.find((item) => item.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'))?.id
    const alreadyPersonal = Boolean(exerciseId)
    if (!exerciseId) {
      exerciseId = uuid()
      if (!await apply({ kind: 'createExercise', operationId: uuid(), exerciseId, name })) return false
    }
    if (view?.active) {
      if (view.exercises.some((item) => item.exerciseId === exerciseId)) { setNotice('Упражнение уже в тренировке'); setPicker(false); changeTab('workout'); return true }
      if (!await apply({ kind: 'addExercise', operationId: uuid(), relationId: uuid(), exerciseId })) return false
      setPicker(false); changeTab('workout')
    } else setNotice(alreadyPersonal ? 'Упражнение уже в личном каталоге' : 'Упражнение добавлено в личный каталог')
    return true
  }
  async function archiveExercise(exerciseId: string, name: string) {
    if (!window.confirm(`Убрать «${name}» из личного каталога? Записи прошлых тренировок сохранятся.`)) return
    if (await apply({ kind: 'archiveExercise', operationId: uuid(), exerciseId })) setNotice('Упражнение убрано из личного каталога. История сохранена.')
  }
  async function exportDev() {
    try { const url = URL.createObjectURL(new Blob([await repository.exportData()], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'workout-tracker-dev-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
    catch (cause) { setError(message(cause)) }
  }
  async function importDev(file?: File) {
    if (!file || !window.confirm('Заменить локальные тестовые данные резервной копией?')) return
    try { await repository.importData(await file.text()); await refresh(false) } catch (cause) { setError(message(cause)) }
  }
  const savedCount = view?.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) ?? 0
  const volume = view?.exercises.reduce((sum, exercise) => sum + exercise.sets.reduce((total, set) => total + (parseWeight(set.weight) ?? 0) * (parseReps(set.reps) ?? 0), 0), 0) ?? 0
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date(view?.startedAt ?? Date.now()))
  return <><main className="app-shell app-shell--with-nav">
    {error && <div role="alert" className="load-error">{error} {!view && <Button onClick={() => void refresh(false)}>Повторить</Button>}</div>}
    {notice && <p role="status" className="backup-notice">{notice}</p>}
    {loading ? <p role="status">Открываем ваш журнал…</p> : editingPlan ? <TrainingPlanEditor key={editingPlan === 'new' ? 'new' : editingPlan.id} initial={editingPlan === 'new' ? undefined : editingPlan} busy={busy} onSave={savePlan} onCancel={() => setEditingPlan(null)} /> : picker || tab === 'exercises' ? <ExerciseLibrary journal={journal} busy={busy} canAttach={Boolean(view?.active)} onChoose={chooseExercise} onArchive={archiveExercise} onClose={picker ? () => setPicker(false) : undefined} /> : tab === 'history' ? <CalendarHistory journal={journal} busy={busy} canStart={!view?.active} onRepeat={(workout) => void start(workout.title, workout.exercises.map((item) => item.name))} onEdit={(workoutId) => void (async () => { if (await apply({ kind: 'reopenWorkout', operationId: uuid(), workoutId }, false)) changeTab('workout') })()} /> : tab === 'progress' ? <ProgressScreen journal={journal} /> : <>
      <header className="page-header"><div className="header-kicker"><span className="live-dot" /> ВАШ ЛИЧНЫЙ ПРОГРЕСС</div><h1>Тренировка</h1><p className="date-line">{date}</p></header>
      {!view?.active ? <>
        <section className="saved-plans"><div className="section-heading"><div><p className="screen-eyebrow">ВАШ ПЛАН</p><h2>Мои тренировки</h2></div><Button variant="quiet" onClick={() => setEditingPlan('new')}>＋ Создать</Button></div><p className="empty-note">Заранее добавьте нужные упражнения, а подходы запишите в зале.</p>{plans.map((plan) => <article className="saved-plan-card" key={plan.id}><div><strong>{plan.title}</strong><span>{plan.exerciseNames.length} упражнений · {plan.exerciseNames.join(' · ')}</span></div><div className="saved-plan-actions"><Button disabled={busy} onClick={() => void start(plan.title, plan.exerciseNames)}>Начать</Button><Button variant="quiet" onClick={() => setEditingPlan(plan)}>Изменить</Button><Button variant="quiet" aria-label={`Удалить ${plan.title}`} onClick={() => void deletePlan(plan)}>×</Button></div></article>)}</section>
        <section className="start-hero"><p className="eyebrow">РАЗОВАЯ ТРЕНИРОВКА</p><h2>Начать с чистого листа.</h2><p>Состав добавите уже во время тренировки.</p><form onSubmit={(event) => { event.preventDefault(); void start(newTitle) }}><label htmlFor="new-workout-title">Название тренировки</label><input id="new-workout-title" className="search-input" maxLength={60} placeholder="Название тренировки" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required /><Button disabled={busy || !newTitle.trim()} className="add-button">＋ Начать тренировку</Button></form></section>
        {journal.workouts.find((item) => item.completedAt) && <section className="recent-workout"><p className="eyebrow">ПОВТОРИТЬ ПОСЛЕДНЮЮ</p><h2>{journal.workouts.find((item) => item.completedAt)!.title}</h2><p>Состав сохранён. Подходы запишете заново.</p><Button variant="quiet" disabled={busy} onClick={() => { const last = journal.workouts.find((item) => item.completedAt)!; void start(last.title, last.exercises.map((exercise) => exercise.name)) }}>Начать с этим составом →</Button></section>}
      </> : <>
        <section className="workout-title-card"><label htmlFor="workout-title">СЕГОДНЯШНЯЯ ЦЕЛЬ</label><div className="title-edit"><input id="workout-title" maxLength={60} aria-label="Название тренировки" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} />{title !== view.title && <Button variant="quiet" disabled={busy || !title.trim()} onClick={() => void apply({ kind: 'rename', operationId: uuid(), title })}>Готово</Button>}</div><div className="workout-summary"><span>{view.exercises.length} упр.</span><span>{savedCount} подх.</span><span>{new Intl.NumberFormat('ru-RU').format(volume)} кг</span></div></section>
        <RestTimer until={restUntil} onChange={setRestUntil} />
        {!view.exercises.length && <div className="empty-panel"><strong>Добавьте первое упражнение</strong><p>Выберите движение из библиотеки или создайте своё.</p></div>}
        {view.exercises.map((exercise, exerciseIndex) => {
          const previous = previousExercise(journal.workouts, exercise.exerciseId)
          return <section key={exercise.relationId} className="exercise-card multi-exercise-card" aria-labelledby={`exercise-${exercise.relationId}`}>
            <div className="exercise-card__heading"><ExerciseImage exercise={exerciseInfo(exercise.name)} /><div><p className="eyebrow">УПРАЖНЕНИЕ {String(exerciseIndex + 1).padStart(2, '0')}</p><h2 id={`exercise-${exercise.relationId}`}>{exercise.name}</h2></div>
              <details className="exercise-options"><summary aria-label={`Действия — ${exercise.name}`}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg></summary><div><Button variant="quiet" disabled={busy || exerciseIndex === 0} onClick={() => void apply({ kind: 'moveExercise', operationId: uuid(), relationId: exercise.relationId, direction: -1 })}>↑ Выше</Button><Button variant="quiet" disabled={busy || exerciseIndex === view.exercises.length - 1} onClick={() => void apply({ kind: 'moveExercise', operationId: uuid(), relationId: exercise.relationId, direction: 1 })}>↓ Ниже</Button><Button variant="quiet" disabled={busy} onClick={() => { if (window.confirm(`Удалить «${exercise.name}» и его подходы из этой тренировки?`)) void apply({ kind: 'removeExercise', operationId: uuid(), relationId: exercise.relationId }) }}>Удалить</Button></div></details>
            </div>
            {previous && <p className="previous-performance">В прошлый раз: {previous.sets.map((set) => `${set.weight} × ${set.reps}`).join(' · ')}</p>}
            <div className="sets-heading"><h3>Подходы</h3><span>Вес × повторы</span></div>
            <ol className="sets-list">{(drafts[exercise.relationId] ?? []).map((set, index) => <li className={`training-set ${set.dirty ? 'training-set--draft' : ''}`} key={set.id}><span className="set-number">{index + 1}</span><label className="numeric-field"><span>Вес, кг</span><input inputMode="decimal" disabled={busy} aria-label={`${exercise.name}, подход ${index + 1}, вес`} value={set.weight} placeholder="0" onChange={(event) => editDraft(exercise.relationId, set.id, 'weight', event.target.value)} /></label><label className="numeric-field"><span>Повторы</span><input inputMode="numeric" disabled={busy} aria-label={`${exercise.name}, подход ${index + 1}, повторы`} value={set.reps} placeholder={String(previous?.sets[index]?.reps ?? '—')} onChange={(event) => editDraft(exercise.relationId, set.id, 'reps', event.target.value)} /></label><Button className={`set-check ${set.dirty ? '' : 'set-check--saved'}`} variant="quiet" disabled={busy || !set.dirty || !valid(set)} aria-label={set.dirty ? `Сохранить подход ${index + 1} — ${exercise.name}` : `Подход ${index + 1} сохранён на устройстве`} onClick={() => void saveRow(exercise.relationId, set)}>{set.dirty ? '○' : '✓'}</Button><Button className="delete-button" variant="quiet" disabled={busy} aria-label={`Удалить подход ${index + 1} — ${exercise.name}`} onClick={() => void deleteRow(exercise.relationId, set)}>×</Button></li>)}</ol>
            <Button className="add-button" disabled={busy} onClick={() => addDraft(exercise.relationId, exercise.exerciseId)}>＋ Добавить подход</Button>
          </section>
        })}
        <Button className="add-exercise-button" variant="quiet" disabled={busy} onClick={() => { setPicker(true); window.scrollTo({ top: 0 }) }}>＋ Добавить упражнение</Button>
        {removed && <div className="undo-panel" role="status">Подход удалён<Button variant="quiet" disabled={busy} onClick={() => void (async () => { const { relationId, draft } = removed; if (await apply({ kind: 'saveSet', operationId: uuid(), id: uuid(), relationId, weight: draft.weight, reps: draft.reps, position: draft.position })) setRemoved(null) })()}>Отменить</Button></div>}
        {unsaved && <p className="draft-hint">Заполните вес и повторы, затем нажмите ○. Черновики сохраняются на этом устройстве и не считаются выполненными подходами.</p>}
        <Button className="finish-button" disabled={busy || savedCount === 0 || unsaved} onClick={() => void (async () => { if (await apply({ kind: 'finishWorkout', operationId: uuid() }, false)) changeTab('history') })()}>Завершить тренировку</Button>
        <details className="workout-options"><summary>Дата и управление тренировкой</summary><label htmlFor="workout-date">Дата тренировки</label><input id="workout-date" className="search-input" type="date" value={localDay(view.startedAt ?? new Date())} max={localDay(new Date())} disabled={busy} onChange={(event) => { if (event.target.value) void apply({ kind: 'changeDate', operationId: uuid(), startedAt: new Date(`${event.target.value}T00:00:00`).toISOString() }) }} /><Button className="danger-text" variant="quiet" disabled={busy} onClick={() => { if (window.confirm('Удалить текущую тренировку и все её подходы? Это действие нельзя отменить.')) void apply({ kind: 'discardWorkout', operationId: uuid() }, false) }}>Удалить тренировку</Button></details>
      </>}
      {!authenticated && <section className="backup-panel"><h2>Локальная копия</h2><div className="backup-actions"><Button variant="quiet" onClick={() => void exportDev()}>Экспорт JSON</Button><Button variant="quiet" onClick={() => fileRef.current?.click()}>Импорт JSON</Button></div><input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Выбрать файл JSON для импорта" onChange={(event) => void importDev(event.target.files?.[0])} /></section>}
    </>}
  </main><BottomNav tab={tab} onChange={changeTab} /></>
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
