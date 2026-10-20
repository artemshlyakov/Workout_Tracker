import { useEffect, useMemo, useState } from 'react'
import { App } from '../../app/App'
import { restoreAuth, signOut, type AuthState } from '../../data/auth/auth'
import { mayOpenWorkspace, maySync, workspaceOwner } from '../../data/auth/access'
import { supabase } from '../../data/cloud/client'
import { CloudSync } from '../../data/cloud/sync'
import { DexieWorkoutRepository } from '../../data/local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../../data/local/schema'
import { Button } from '../../shared/Button'
import { AuthForm } from './AuthForm'

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const [readyFor, setReadyFor] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [draftUnsaved, setDraftUnsaved] = useState(false)

  useEffect(() => {
    let active = true
    let version = 0
    const initialVersion = version
    void restoreAuth().then((state) => { if (active && version === initialVersion) setAuth(state) }).catch(() => { if (active && version === initialVersion) setAuth({ kind: 'SIGNED_OUT' }) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { version++; setAuth({ kind: 'SIGNED_OUT' }); return }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') { version++; setGeneration((n) => n + 1) }
    })
    const refresh = () => setGeneration((n) => n + 1)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh) }
  }, [])

  useEffect(() => {
    if (!generation) return
    let active = true
    void restoreAuth().then((state) => { if (active) setAuth(state) }).catch(() => {
      if (active && auth?.kind !== 'SIGNED_OUT') setAuth((current) => current?.kind === 'SIGNED_OUT' ? current : current?.user ? { kind: 'AUTH_RECHECK_REQUIRED', user: current.user } : { kind: 'SIGNED_OUT' })
    })
    return () => { active = false }
  // Only auth events and network transitions trigger a recheck.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  const userId = workspaceOwner(auth)
  const repository = useMemo(() => userId ? new DexieWorkoutRepository(new WorkoutDatabase(`workout-tracker-auth-${userId}`), { ownerUserId: userId }) : null, [userId])
  const sync = useMemo(() => repository ? new CloudSync(repository) : null, [repository])

  useEffect(() => {
    if (!repository || !sync || !auth || auth.kind === 'SIGNED_OUT') return
    let active = true
    const start = async () => {
      try {
        if (auth.kind === 'SIGNED_IN_ONLINE') await sync.prepare()
        if (!mayOpenWorkspace(auth, Boolean(await repository.db.workspaces.get(repository.workspaceId)))) {
          throw new Error('Первый вход на этом устройстве требует подтверждения через интернет')
        }
        await repository.load()
        if (!active) return
        setPending(await sync.pendingCount())
        setReadyFor(repository.workspaceId)
        if (auth.kind === 'SIGNED_IN_ONLINE') await sync.push()
        if (active) { setPending(await sync.pendingCount()); setSyncError(null) }
      } catch (cause) {
        if (active) {
          setSyncError(cause instanceof Error ? cause.message : 'Не удалось связаться с облаком')
          if (await repository.db.workspaces.get(repository.workspaceId)) setReadyFor(repository.workspaceId)
        }
      }
    }
    void start()
    return () => { active = false }
  }, [auth, repository, sync])

  async function syncAfterWrite() {
    if (!sync) return
    setPending(await sync.pendingCount())
    if (!auth || !maySync(auth, repository!.workspaceId)) return
    try { await sync.push(); setSyncError(null) }
    catch (cause) { setSyncError(cause instanceof Error ? cause.message : 'Ошибка синхронизации') }
    setPending(await sync.pendingCount())
  }

  async function handleSignOut() {
    if (!repository) return
    const pending = await repository.db.outbox.where('workspaceId').equals(repository.workspaceId).count()
    if ((pending || draftUnsaved) && !window.confirm(`${pending} изменений ожидают синхронизации${draftUnsaved ? '; есть ввод, ещё не сохранённый на устройстве' : ''}. Очередь останется за этим аккаунтом. Выйти?`)) return
    try {
      await sync?.stop()
      const mode = await signOut()
      setAuth({ kind: 'SIGNED_OUT' })
      setError(mode === 'local' ? 'Вы вышли на этом устройстве. Серверный сеанс мог остаться активным до истечения срока.' : null)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось выйти') }
  }

  async function handleExport() {
    if (!repository) return
    try {
      const json = await repository.exportAccountData()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'workout-tracker-account-export.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось экспортировать данные') }
  }

  if (!auth) return <main className="app-shell"><p role="status">Проверяем сеанс…</p></main>
  if (auth.kind === 'SIGNED_OUT') return <AuthForm notice={error} onSuccess={() => { setError(null); setGeneration((n) => n + 1) }} />
  if (!repository) return null
  return <>
    <div className="account-bar">
      <span>{auth.user.email ?? 'Личный аккаунт'}</span>
      <Button variant="quiet" onClick={() => void handleExport()}>Экспорт</Button>
      <Button variant="quiet" onClick={() => void handleSignOut()}>Выйти</Button>
    </div>
    {auth.kind === 'AUTH_RECHECK_REQUIRED' && <div className="auth-notice" role="alert">Сеанс нужно проверить онлайн. Локальные записи сохранены, отправка остановлена. <Button variant="quiet" onClick={() => setGeneration((n) => n + 1)}>Повторить</Button></div>}
    {auth.kind === 'SIGNED_IN_OFFLINE_CACHED' && <div className="auth-notice" role="status">Офлайн: открыт локальный журнал этого аккаунта. Отправка остановлена.</div>}
    {error && <div className="auth-notice" role="alert">{error}</div>}
    {syncError && <div className="auth-notice" role="alert">Синхронизация: {syncError} {auth.kind === 'SIGNED_IN_ONLINE' && <Button variant="quiet" onClick={() => void syncAfterWrite()}>Повторить</Button>}</div>}
    <div className="auth-notice" role="status">{pending ? `${pending} изменений ожидают отправки` : auth.kind === 'SIGNED_IN_ONLINE' && !syncError ? 'Облако подтвердило все изменения' : 'Облачная отправка остановлена'}</div>
    {readyFor === repository.workspaceId ? <App key={auth.user.id} repository={repository} authenticated onLocalWrite={() => void syncAfterWrite()} onDraftStateChange={setDraftUnsaved} /> : <main className="app-shell"><p role="status">Загружаем личный журнал…</p></main>}
  </>
}
