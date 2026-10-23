import { useEffect, useState } from 'react'
import type { CloudSync, SyncConflict } from '../../data/cloud/sync'
import { Button } from '../../shared/Button'
function describe(record: SyncConflict['local']): string {
  if (record.deletedAt) return 'Запись удалена'
  if ('title' in record) return `${record.title} · ${record.completedAt ? 'Завершена' : 'В процессе'}`
  if ('name' in record) return record.name
  if ('weightCentiKg' in record) return `${record.weightCentiKg / 100} кг × ${record.reps} повт.`
  return `Упражнение в позиции ${record.position + 1}`
}
export function ConflictPanel({ sync, onExport, onResolved }: { sync: CloudSync; onExport: () => void; onResolved: () => void }) {
  const [conflict, setConflict] = useState<SyncConflict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => { let active = true; void sync.getConflict().then((next) => { if (active) { setConflict(next); setError(null) } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Не удалось прочитать версии') }); return () => { active = false } }, [sync, reload])
  async function resolve(choice: 'local' | 'cloud') {
    if (!conflict || !window.confirm(`Использовать ${choice === 'local' ? 'локальную' : 'облачную'} версию этой записи? Другую версию можно предварительно сохранить через экспорт.`)) return
    setBusy(true)
    try { await sync.resolveConflict(conflict, choice); onResolved() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось разрешить конфликт') }
    finally { setBusy(false) }
  }
  return <section className="conflict-panel"><h2>Выберите версию записи</h2><p>Изменения на двух устройствах различаются. Они не были перезаписаны автоматически.</p>{conflict && <div className="conflict-versions"><div><span>На устройстве</span><strong>{describe(conflict.local)}</strong><Button disabled={busy || Boolean(conflict.remote.deletedAt)} onClick={() => void resolve('local')}>Оставить мою</Button></div><div><span>В облаке</span><strong>{describe(conflict.remote)}</strong><Button variant="quiet" disabled={busy} onClick={() => void resolve('cloud')}>Принять облачную</Button></div></div>}{error && <p role="alert">{error}</p>}<div className="backup-actions"><Button variant="quiet" onClick={onExport}>Экспорт до выбора</Button><Button variant="quiet" disabled={busy} onClick={() => setReload((value) => value + 1)}>Обновить сравнение</Button></div></section>
}
