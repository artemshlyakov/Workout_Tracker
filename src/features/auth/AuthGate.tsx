import { useEffect, useMemo, useRef, useState } from 'react'
import { App } from '../../app/App'
import { restoreAuth, signOut, type AuthState } from '../../data/auth/auth'
import { mayOpenWorkspace, maySync, workspaceOwner } from '../../data/auth/access'
import { supabase } from '../../data/cloud/client'
import { CloudSync, type PushResult } from '../../data/cloud/sync'
import { DexieWorkoutRepository } from '../../data/local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../../data/local/schema'
import { Button } from '../../shared/Button'
import { AuthForm } from './AuthForm'

export type SyncStatus =
  | { kind: 'checking' }
  | { kind: 'syncing' }
  | { kind: 'confirmed' }
  | { kind: 'pending'; count: number }
  | { kind: 'error'; message: string; count: number }

export function completedStatus(result: PushResult, cloudChecked: boolean): SyncStatus {
  if (result.pending > 0) return { kind: 'pending', count: result.pending }
  return cloudChecked || result.acknowledged > 0 ? { kind: 'confirmed' } : { kind: 'pending', count: 0 }
}

export function statusText(status: SyncStatus): string {
  switch (status.kind) {
    case 'checking': return 'Проверяем облачное состояние…'
    case 'syncing': return 'Синхронизируем изменения…'
    case 'confirmed': return 'Облако подтвердило все изменения'
    case 'pending': return status.count ? `${status.count} изменений ожидают отправки` : 'Облачное состояние ещё не проверено'
    case 'error': return `Синхронизация: ${status.message}. ${status.count} изменений ожидают отправки`
  }
}

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const authVersion = useRef(0)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { authVersion.current++; setAuth({ kind: 'SIGNED_OUT' }) }
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') { authVersion.current++; setGeneration((n) => n + 1) }
    })
    const refresh = () => { authVersion.current++; setGeneration((n) => n + 1) }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => { subscription.unsubscribe(); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh) }
  }, [])

  useEffect(() => {
    let active = true
    const version = authVersion.current
    void restoreAuth().then((state) => {
      if (active && version === authVersion.current) setAuth(state)
    }).catch(() => {
      if (active && version === authVersion.current) setAuth((current) => current?.kind === 'SIGNED_OUT' ? current : current?.user ? { kind: 'AUTH_RECHECK_REQUIRED', user: current.user } : { kind: 'SIGNED_OUT' })
    })
    return () => { active = false }
  }, [generation])

  if (!auth) return <main className="app-shell"><p role="status">Проверяем сеанс…</p></main>
  if (auth.kind === 'SIGNED_OUT') return <AuthForm notice={notice} onSuccess={() => { setNotice(null); authVersion.current++; setGeneration((n) => n + 1) }} />
  const owner = workspaceOwner(auth)
  if (!owner) return null
  return <AccountWorkspace key={owner} auth={auth} onSignOut={(message) => {
    authVersion.current++
    setAuth({ kind: 'SIGNED_OUT' })
    setNotice(message)
  }} onRecheck={() => { authVersion.current++; setGeneration((n) => n + 1) }} />
}

function AccountWorkspace({ auth, onSignOut, onRecheck }: { auth: Exclude<AuthState, { kind: 'SIGNED_OUT' }>; onSignOut: (message: string | null) => void; onRecheck: () => void }) {
  const owner = auth.user.id
  const repository = useMemo(() => new DexieWorkoutRepository(new WorkoutDatabase(`workout-tracker-auth-${owner}`), { ownerUserId: owner }), [owner])
  const syncRef = useRef<CloudSync | null>(null)
  const cloudChecked = useRef(false)
  const statusRevision = useRef(0)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<SyncStatus>({ kind: 'checking' })
  const [error, setError] = useState<string | null>(null)
  const [draftUnsaved, setDraftUnsaved] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    const revision = ++statusRevision.current
    const sync = new CloudSync(repository)
    syncRef.current = sync
    cloudChecked.current = false
    setStatus({ kind: 'checking' })
    const start = async () => {
      try {
        if (auth.kind === 'SIGNED_IN_ONLINE') {
          const prepared = await sync.prepare()
          if (!active) return
          cloudChecked.current = prepared.cloudChecked
        }
        const cached = Boolean(await repository.db.workspaces.get(repository.workspaceId))
        if (!mayOpenWorkspace(auth, cached)) throw new Error('Первый вход на этом устройстве требует подтверждения через интернет')
        await repository.load()
        if (!active || revision !== statusRevision.current) return
        setReady(true)
        const pending = await sync.pendingCount()
        if (!active || revision !== statusRevision.current) return
        if (!maySync(auth, owner)) { setStatus({ kind: 'pending', count: pending }); return }
        setStatus({ kind: 'syncing' })
        const result = await sync.push()
        if (active && revision === statusRevision.current) setStatus(completedStatus(result, cloudChecked.current))
      } catch (cause) {
        if (!active || revision !== statusRevision.current) return
        const count = await sync.pendingCount().catch(() => 0)
        if (!active || revision !== statusRevision.current) return
        setStatus({ kind: 'error', message: cause instanceof Error ? cause.message : 'Не удалось связаться с облаком', count })
        if (await repository.db.workspaces.get(repository.workspaceId) && active) setReady(true)
      }
    }
    void start()
    return () => { active = false; if (syncRef.current === sync) syncRef.current = null; void sync.stop() }
  }, [auth, repository, owner, retry])

  async function syncAfterWrite() {
    const sync = syncRef.current
    if (!sync) return
    const pending = await sync.pendingCount()
    if (syncRef.current !== sync) return
    const revision = ++statusRevision.current
    if (!maySync(auth, owner)) { setStatus({ kind: 'pending', count: pending }); return }
    setStatus({ kind: 'syncing' })
    try {
      const result = await sync.push()
      if (syncRef.current === sync && revision === statusRevision.current) setStatus(completedStatus(result, cloudChecked.current))
    } catch (cause) {
      if (syncRef.current === sync && revision === statusRevision.current) {
        const count = await sync.pendingCount()
        if (syncRef.current === sync && revision === statusRevision.current) setStatus({ kind: 'error', message: cause instanceof Error ? cause.message : 'Ошибка синхронизации', count })
      }
    }
  }

  async function handleSignOut() {
    const pending = await repository.db.outbox.where('workspaceId').equals(owner).count()
    if ((pending || draftUnsaved) && !window.confirm(`${pending} изменений ожидают синхронизации${draftUnsaved ? '; есть ввод, ещё не сохранённый на устройстве' : ''}. Очередь останется за этим аккаунтом. Выйти?`)) return
    try {
      await syncRef.current?.stop()
      const mode = await signOut()
      onSignOut(mode === 'local' ? 'Вы вышли на этом устройстве. Серверный сеанс мог остаться активным до истечения срока.' : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось выйти')
      setRetry((n) => n + 1)
    }
  }

  async function handleExport() {
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

  return <>
    <div className="account-bar">
      <span>{auth.user.email ?? 'Личный аккаунт'}</span>
      <Button variant="quiet" onClick={() => void handleExport()}>Экспорт</Button>
      <Button variant="quiet" onClick={() => void handleSignOut()}>Выйти</Button>
    </div>
    {auth.kind === 'AUTH_RECHECK_REQUIRED' && <div className="auth-notice" role="alert">Сеанс нужно проверить онлайн. Локальные записи сохранены, отправка остановлена. <Button variant="quiet" onClick={onRecheck}>Повторить</Button></div>}
    {auth.kind === 'SIGNED_IN_OFFLINE_CACHED' && <div className="auth-notice" role="status">Офлайн: открыт локальный журнал этого аккаунта. Отправка остановлена.</div>}
    {error && <div className="auth-notice" role="alert">{error}</div>}
    <div className="auth-notice" role={status.kind === 'error' ? 'alert' : 'status'}>{statusText(status)} {status.kind === 'error' && auth.kind === 'SIGNED_IN_ONLINE' && <Button variant="quiet" onClick={() => setRetry((n) => n + 1)}>Повторить</Button>}</div>
    {ready ? <App repository={repository} authenticated onLocalWrite={() => void syncAfterWrite()} onDraftStateChange={(unsaved) => {
      setDraftUnsaved(unsaved)
      if (unsaved) setStatus((current) => current.kind === 'confirmed' ? { kind: 'pending', count: 0 } : current)
    }} /> : <main className="app-shell"><p role="status">Загружаем личный журнал…</p></main>}
  </>
}
