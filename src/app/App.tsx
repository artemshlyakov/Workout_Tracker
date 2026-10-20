import { useEffect, useRef, useState } from 'react'
import { parseReps, parseWeight, removeSet, updateSet, type SetField, type WorkoutSet } from '../domain/workout'
import type { WorkoutCommand, WorkoutRepository } from '../data/ports/WorkoutRepository'
import { LocalSaveStatus } from '../features/workout/LocalSaveStatus'
import { ExerciseCard } from '../features/workout/ExerciseCard'
import { Button } from '../shared/Button'

interface Props { repository: WorkoutRepository; authenticated?: boolean; onLocalWrite?: () => void; onDraftStateChange?: (unsaved: boolean) => void }

export function App({ repository, authenticated = false, onLocalWrite, onDraftStateChange }: Props) {
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [newestId, setNewestId] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ set: WorkoutSet; index: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const commands = useRef<WorkoutCommand[]>([])
  const draining = useRef<Promise<void> | null>(null)
  const blocked = useRef(false)
  const positions = useRef(new Map<string, number>())
  const nextPosition = useRef(0)
  const date = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date())

  useEffect(() => {
    let active = true
    repository.load().then((view) => {
      if (!active) return
      setTitle(view.title)
      setSets(view.sets.map(({ id, weight, reps, position }) => {
        positions.current.set(id, position)
        nextPosition.current = Math.max(nextPosition.current, position + 1)
        return { id, weight, reps }
      }))
      setLoading(false)
    }).catch((cause: unknown) => {
      if (active) { setLoadError(message(cause)); setLoading(false) }
    })
    return () => { active = false }
  }, [repository])

  function drain() {
    if (draining.current || blocked.current) return
    draining.current = (async () => {
      while (commands.current.length > 0) {
        try {
          await repository.apply(commands.current[0])
          commands.current.shift()
          setPending(commands.current.length)
          onLocalWrite?.()
        } catch (cause) {
          blocked.current = true
          setError(message(cause))
          break
        }
      }
    })().finally(() => { draining.current = null })
  }

  function enqueue(command: WorkoutCommand) {
    commands.current.push(command)
    setPending(commands.current.length)
    drain()
  }

  function retry() {
    blocked.current = false
    setError(null)
    drain()
  }

  async function waitForWrites() {
    await draining.current
    if (commands.current.length > 0 || invalid) throw new Error('Есть несохранённые изменения. Исправьте ввод или повторите сохранение')
  }

  function handleChange(id: string, field: SetField, value: string) {
    const updated = updateSet(sets, id, field, value)
    setSets(updated)
    const changed = updated.find((set) => set.id === id)!
    if (validSet(changed)) enqueue({ kind: 'saveSet', operationId: crypto.randomUUID(), ...changed, position: positions.current.get(id) ?? 0 })
  }

  function handleAdd() {
    const previous = [...sets].reverse().find((set) => parseWeight(set.weight) !== null)
    const set = { id: crypto.randomUUID(), weight: previous?.weight ?? '0', reps: '1' }
    const position = nextPosition.current++
    positions.current.set(set.id, position)
    setSets((current) => [...current, set])
    setNewestId(set.id)
    setRemoved(null)
    enqueue({ kind: 'saveSet', operationId: crypto.randomUUID(), ...set, position })
  }

  function handleDelete(id: string) {
    const index = sets.findIndex((set) => set.id === id)
    if (index < 0) return
    setRemoved({ set: sets[index], index })
    setSets((current) => removeSet(current, id))
    if (newestId === id) setNewestId(null)
    enqueue({ kind: 'deleteSet', operationId: crypto.randomUUID(), id })
  }

  function handleUndo() {
    if (!removed || !validSet(removed.set)) return
    const { set, index } = removed
    setSets((current) => {
      const restored = [...current]
      restored.splice(Math.min(index, restored.length), 0, set)
      return restored
    })
    setRemoved(null)
    enqueue({ kind: 'restoreSet', operationId: crypto.randomUUID(), ...set, position: positions.current.get(set.id) ?? index })
  }

  async function handleExport() {
    try {
      await waitForWrites()
      const json = await repository.exportData()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'workout-tracker-dev-backup.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Резервная копия скачана')
    } catch (cause) { setNotice(`Не удалось экспортировать: ${message(cause)}`) }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    if (!window.confirm('Импорт заменит все локальные тестовые данные на данные из файла. Продолжить?')) return
    try {
      await waitForWrites()
      const view = await repository.importData(await file.text())
      positions.current.clear()
      nextPosition.current = 0
      setSets(view.sets.map(({ id, weight, reps, position }) => {
        positions.current.set(id, position)
        nextPosition.current = Math.max(nextPosition.current, position + 1)
        return { id, weight, reps }
      }))
      setTitle(view.title)
      setError(null)
      commands.current = []
      blocked.current = false
      setRemoved(null)
      setNotice('Локальные тестовые данные восстановлены')
    } catch (cause) { setNotice(`Не удалось импортировать: ${message(cause)}`) }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  const invalid = title.trim().length === 0 || sets.some((set) => !validSet(set))

  useEffect(() => { onDraftStateChange?.(pending > 0 || invalid) }, [pending, invalid, onDraftStateChange])

  return <main className="app-shell">
    <header className="page-header">
      <div className="header-kicker"><span className="live-dot" aria-hidden="true" /> АКТИВНАЯ ТРЕНИРОВКА</div>
      <h1>Тренировка</h1><p className="date-line">{date}</p>
    </header>
    {!authenticated && <div className="dev-banner" role="note">Режим разработки — нет аккаунта и облачной копии</div>}
    {loading ? <p role="status">Загружаем локальную тренировку…</p> : loadError ? <div role="alert" className="load-error"><p>Не удалось открыть локальные данные: {loadError}</p><Button onClick={() => window.location.reload()}>Повторить загрузку</Button></div> : <>
      {authenticated ? error ? <div role="alert" className="load-error">Локальная запись не удалась: {error} <Button onClick={retry}>Повторить</Button></div> : invalid ? <div role="alert" className="local-status local-status--error">Исправьте пустые или некорректные значения: они ещё не сохранены.</div> : pending > 0 ? <div role="status" className="local-status">Сохраняем на устройстве…</div> : null : <LocalSaveStatus pending={pending} error={error} invalid={invalid} onRetry={retry} />}
      <section className="workout-title-card" aria-label="Название тренировки">
        <label htmlFor="workout-title">НАЗВАНИЕ ТРЕНИРОВКИ</label>
        <input id="workout-title" value={title} onChange={(event) => {
          const value = event.target.value
          setTitle(value)
          if (value.trim()) enqueue({ kind: 'rename', operationId: crypto.randomUUID(), title: value })
        }} maxLength={60} aria-label="Название тренировки" />
      </section>
      <ExerciseCard sets={sets} newestId={newestId} onChange={handleChange} onAdd={handleAdd} onDelete={handleDelete} />
      {removed && <div className="undo-panel" role="status"><span>Подход удалён</span><Button variant="quiet" onClick={handleUndo}>Отменить</Button></div>}
      {!authenticated && <section className="backup-panel" aria-label="Резервная копия">
        <h2>Локальная копия</h2><p>Экспортируйте тестовые данные в JSON. Импорт полностью заменит текущую локальную тренировку.</p>
        <div className="backup-actions">
          <Button variant="quiet" onClick={handleExport}>Экспорт JSON</Button>
          <Button variant="quiet" onClick={() => fileRef.current?.click()}>Импорт JSON</Button>
        </div>
        <input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Выбрать файл JSON для импорта" onChange={(event) => void handleImport(event.target.files?.[0])} />
        {notice && <p role="status" className="backup-notice">{notice}</p>}
      </section>}
      <p className="footer-note">{authenticated ? 'Локальные данные этого аккаунта хранятся на устройстве. Облачная синхронизация пока не подтверждена.' : 'Данные хранятся только в этом браузере. Очистка хранилища удалит их.'}</p>
    </>}
  </main>
}

function validSet(set: WorkoutSet): boolean {
  const weight = parseWeight(set.weight)
  const reps = parseReps(set.reps)
  return weight !== null && weight <= 2000 && reps !== null && reps >= 1 && reps <= 1000
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : 'неизвестная ошибка' }
