import { useEffect, useRef, useState } from 'react'
import { equipmentLabels, imageUrl, isLoggable, library, muscleLabels, type LibraryExercise } from '../../data/catalog/library'
import type { JournalView } from '../../data/ports/WorkoutRepository'
import { Button } from '../../shared/Button'

export function ExerciseImage({ exercise, className = '' }: { exercise?: LibraryExercise; className?: string }) {
  const [failed, setFailed] = useState(false)
  return <span className={`exercise-photo ${className}`} aria-hidden="true">{exercise?.images[0] && !failed ? <img src={imageUrl(exercise.images[0])} alt="" loading="lazy" width="72" height="72" onError={() => setFailed(true)} /> : <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 13v6m4-10v14m4-17v20m10-20v20m4-17v14m4-10v6M11 16h10" /></svg>}</span>
}

export function ExerciseLibrary({ journal, busy, onChoose, onClose }: { journal: JournalView; busy: boolean; onChoose: (name: string) => Promise<boolean>; onClose?: () => void }) {
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState('')
  const [equipment, setEquipment] = useState('')
  const [personal, setPersonal] = useState(false)
  const [limit, setLimit] = useState(30)
  const [selected, setSelected] = useState<LibraryExercise | null>(null)
  const [custom, setCustom] = useState('')
  const normalized = query.trim().toLocaleLowerCase('ru')
  const filtered = library.filter((item) => (!muscle || item.muscles.includes(muscle)) && (!equipment || item.equipment === equipment) && `${item.name} ${item.originalName}`.toLocaleLowerCase('ru').includes(normalized))
  const own = journal.exercises.filter((item) => item.name.toLocaleLowerCase('ru').includes(normalized))
  return <section className="journal-screen library-screen">
    {onClose && <button className="text-action" onClick={onClose}>← К тренировке</button>}
    <p className="screen-eyebrow">ВАША БИБЛИОТЕКА</p><h1>Упражнения</h1>
    <p className="date-line">{library.length} движений · свой каталог без ограничений</p>
    <div className="segmented"><button aria-pressed={!personal} onClick={() => setPersonal(false)}>Библиотека</button><button aria-pressed={personal} onClick={() => setPersonal(true)}>Мои ({journal.exercises.length})</button></div>
    <input type="search" className="search-input" aria-label="Поиск упражнений" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30) }} placeholder="Название на русском или английском" />
    {!personal && <div className="filter-grid"><select className="search-input" aria-label="Группа мышц" value={muscle} onChange={(event) => { setMuscle(event.target.value); setLimit(30) }}><option value="">Все мышцы</option>{Object.entries(muscleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select className="search-input" aria-label="Оборудование" value={equipment} onChange={(event) => { setEquipment(event.target.value); setLimit(30) }}><option value="">Всё оборудование</option>{Object.entries(equipmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>}
    <details className="custom-exercise-form"><summary>＋ Создать своё упражнение</summary><form onSubmit={(event) => { event.preventDefault(); if (custom.trim()) void onChoose(custom.trim()).then((saved) => { if (saved) setCustom('') }) }}><label htmlFor="custom-name">Название</label><input className="search-input" id="custom-name" maxLength={120} required value={custom} onChange={(event) => setCustom(event.target.value)} /><Button disabled={busy || !custom.trim()}>Создать упражнение</Button></form></details>
    <div className="journal-list">{personal ? own.map((item) => <div className="library-item" key={item.id}><span>{item.name}</span><Button variant="quiet" disabled={busy} aria-label={`Выбрать ${item.name}`} onClick={() => void onChoose(item.name)}>＋</Button></div>) : filtered.slice(0, limit).map((item) => <button className="library-item" key={item.id} onClick={() => setSelected(item)}><ExerciseImage exercise={item} /><span><strong>{item.name}</strong><small>{item.muscles.map((key) => muscleLabels[key] ?? key).join(', ')} · {equipmentLabels[item.equipment]}</small></span><span className="history-arrow" aria-hidden="true">›</span></button>)}</div>
    {(personal ? own.length === 0 : filtered.length === 0) && <div className="empty-panel"><strong>Ничего не найдено</strong><p>Измените фильтры или создайте своё упражнение.</p></div>}
    {!personal && filtered.length > limit && <Button variant="quiet" onClick={() => setLimit((current) => current + 30)}>Показать ещё · {filtered.length - limit}</Button>}
    <p className="footer-note">Часть названий и описаний — на языке источника. Иллюстрации доступны после загрузки из сети. <a href={`${import.meta.env.BASE_URL}licenses/free-exercise-db.txt`}>Лицензия каталога</a></p>
    {selected && <ExerciseDetail exercise={selected} busy={busy} onClose={() => setSelected(null)} onChoose={async () => { if (await onChoose(selected.name)) setSelected(null) }} />}
  </section>
}

function ExerciseDetail({ exercise, busy, onClose, onChoose }: { exercise: LibraryExercise; busy: boolean; onClose: () => void; onChoose: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="exercise-dialog" onCancel={onClose} aria-labelledby="exercise-detail-title"><div className="dialog-heading"><h2 id="exercise-detail-title">{exercise.name}</h2><Button variant="quiet" aria-label="Закрыть описание" onClick={onClose}>×</Button></div><p className="date-line">{exercise.originalName}</p><div className="exercise-frames">{exercise.images.map((path, index) => <img key={path} src={imageUrl(path)} alt={`Положение ${index + 1}: ${exercise.name}`} loading="lazy" />)}</div><div className="tag-row"><span>{equipmentLabels[exercise.equipment]}</span>{exercise.muscles.map((key) => <span key={key}>{muscleLabels[key] ?? key}</span>)}</div><h3>Описание источника · EN</h3><ol className="exercise-instructions">{exercise.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol>{isLoggable(exercise) ? <Button className="add-button" disabled={busy} onClick={() => void onChoose()}>＋ Выбрать упражнение</Button> : <p className="empty-note">Это справочная карточка. Журнал пока поддерживает подходы с весом и повторениями; длительность и дистанция не записываются.</p>}</dialog>
}
