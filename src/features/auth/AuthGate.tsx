import { useEffect, useMemo, useRef, useState } from 'react'
import { App } from '../../app/App'
import { restoreAuth, signOut, type AuthState } from '../../data/auth/auth'
import { mayOpenWorkspace, maySync, workspaceOwner } from '../../data/auth/access'
import { supabase } from '../../data/cloud/client'
import { CloudSync, type PushResult } from '../../data/cloud/sync'
import { DexieWorkoutRepository } from '../../data/local/DexieWorkoutRepository'
import { WorkoutDatabase } from '../../data/local/schema'
import type { BodyProfile } from '../../data/ports/WorkoutRepository'
import { Button } from '../../shared/Button'
import { ThemeToggle, useTheme, type Theme } from '../../shared/theme'
import { ConflictPanel } from './ConflictPanel'
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
    case 'confirmed': return 'Синхронизировано'
    case 'pending': return status.count ? `${status.count} изменений ожидают отправки` : 'Облачное состояние ещё не проверено'
    case 'error': return `Синхронизация: ${status.message}. ${status.count} изменений ожидают отправки`
  }
}

export function AuthGate() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const { theme, toggle } = useTheme()
  const [notice, setNotice] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  const authVersion = useRef(0)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { authVersion.current++; setAuth({ kind: 'SIGNED_OUT' }) }
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') { authVersion.current++; setGeneration((n) => n + 1) }
    })
    const refresh = () => { authVersion.current++; setGeneration((n) => n + 1) }
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => { subscription.unsubscribe(); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh); document.removeEventListener('visibilitychange', refreshWhenVisible) }
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
  if (auth.kind === 'SIGNED_OUT') return <AuthForm theme={theme} onThemeToggle={toggle} notice={notice} onSuccess={() => { setNotice(null); authVersion.current++; setGeneration((n) => n + 1) }} />
  const owner = workspaceOwner(auth)
  if (!owner) return null
  return <AccountWorkspace key={owner} auth={auth} theme={theme} onThemeToggle={toggle} onSignOut={(message) => {
    authVersion.current++
    setAuth({ kind: 'SIGNED_OUT' })
    setNotice(message)
  }} onRecheck={() => { authVersion.current++; setGeneration((n) => n + 1) }} />
}

function AccountWorkspace({ auth, theme, onThemeToggle, onSignOut, onRecheck }: { auth: Exclude<AuthState, { kind: 'SIGNED_OUT' }>; theme: Theme; onThemeToggle: () => void; onSignOut: (message: string | null) => void; onRecheck: () => void }) {
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
  const [dataVersion, setDataVersion] = useState(0)
  const retryAttempt = useRef(0)
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const importFile = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [bodyProfile, setBodyProfile] = useState<BodyProfile | null>(null)
  const [profileStats, setProfileStats] = useState<{ workouts: number; sets: number } | null>(null)

  useEffect(() => () => { if (writeTimer.current) clearTimeout(writeTimer.current) }, [])
  useEffect(() => {
    if (status.kind !== 'error' || auth.kind !== 'SIGNED_IN_ONLINE' || /[Кк]онфликт/.test(status.message) || retryAttempt.current >= 5) return
    const delay = Math.min(30000, 2000 * 2 ** retryAttempt.current++) + Math.floor(Math.random() * 500)
    const timer = setTimeout(() => setRetry((n) => n + 1), delay)
    return () => clearTimeout(timer)
  }, [status, auth.kind])

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
        const pulled = await sync.prepare()
        if (active && revision === statusRevision.current) {
          cloudChecked.current = cloudChecked.current || pulled.cloudChecked
          if (pulled.cloudChecked) setDataVersion((value) => value + 1)
          setStatus(completedStatus(result, cloudChecked.current))
          retryAttempt.current = 0
        }
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
      const pulled = await sync.prepare()
      if (syncRef.current === sync && revision === statusRevision.current) {
        cloudChecked.current = cloudChecked.current || pulled.cloudChecked
        if (pulled.cloudChecked) setDataVersion((value) => value + 1)
        setStatus(completedStatus(result, cloudChecked.current))
        retryAttempt.current = 0
      }
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

  async function handleImport(file?: File) {
    if (!file) return
    if (draftUnsaved) { setError('Сначала сохраните или удалите незаполненные подходы'); return }
    if (!window.confirm('Восстановить копию? Тренировки будут добавлены с новыми идентификаторами и пометкой «копия». Текущие записи и очередь сохранятся.')) return
    setImporting(true)
    try {
      const count = await repository.importAccountData(await file.text())
      setError(null); setDataVersion((value) => value + 1)
      setStatus({ kind: 'pending', count: await syncRef.current?.pendingCount() ?? count })
      void syncAfterWrite()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось восстановить копию') }
    finally { setImporting(false); if (importFile.current) importFile.current.value = '' }
  }

  return <>
    <header className="account-topbar">
      <img className="account-topbar__logo" src={`${import.meta.env.BASE_URL}icon-180.png`} width="34" height="34" alt="Workout Tracker" />
      <span className="account-topbar__name">Workout Tracker</span>
      <ThemeToggle theme={theme} onToggle={onThemeToggle} />
      <button className="profile-trigger" type="button" aria-label="Открыть профиль" onClick={() => { setProfileStats(null); void repository.loadBodyProfile().then(setBodyProfile).catch(() => {}); void repository.listJournal().then((journal) => setProfileStats({ workouts: journal.workouts.filter((item) => item.completedAt).length, sets: journal.workouts.filter((item) => item.completedAt).reduce((total, item) => total + item.exercises.reduce((count, exercise) => count + exercise.sets.length, 0), 0) })).catch(() => {}); setProfileOpen(true) }}>{auth.user.email?.charAt(0).toLocaleUpperCase() ?? 'Я'}</button>
    </header>
    {profileOpen && <ProfileDialog email={auth.user.email ?? 'Личный аккаунт'} createdAt={auth.user.created_at} status={statusText(status)} stats={profileStats} bodyProfile={bodyProfile} onSaveBody={async (value) => { await repository.saveBodyProfile(value); setBodyProfile(value) }} importing={importing} onClose={() => setProfileOpen(false)} onSignOut={() => void handleSignOut()} onExport={() => void handleExport()} onImport={() => importFile.current?.click()} />}
    <input ref={importFile} type="file" accept="application/json,.json" className="visually-hidden" aria-label="Выбрать личную резервную копию" onChange={(event) => void handleImport(event.target.files?.[0])} />
    {auth.kind === 'AUTH_RECHECK_REQUIRED' && <div className="auth-notice" role="alert">Сеанс нужно проверить онлайн. Локальные записи сохранены, отправка остановлена. <Button variant="quiet" onClick={onRecheck}>Повторить</Button></div>}
    {auth.kind === 'SIGNED_IN_OFFLINE_CACHED' && <div className="auth-notice" role="status">Офлайн · записи сохраняются на устройстве</div>}
    {error && <div className="auth-notice" role="alert">{error}</div>}
    <div className={`sync-strip sync-strip--${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}><span>{statusText(status)}</span>{auth.kind === 'SIGNED_IN_ONLINE' && <Button variant="quiet" disabled={status.kind === 'syncing' || status.kind === 'checking'} onClick={() => { retryAttempt.current = 0; setRetry((n) => n + 1) }}>{status.kind === 'error' ? 'Повторить' : 'Синхронизировать'}</Button>}</div>
    {status.kind === 'error' && /[Кк]онфликт/.test(status.message) && syncRef.current && <ConflictPanel sync={syncRef.current} onExport={() => void handleExport()} onResolved={() => { setDataVersion((value) => value + 1); setRetry((value) => value + 1) }} />}
    {ready ? <App repository={repository} authenticated refreshToken={dataVersion} onLocalWrite={() => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
      writeTimer.current = setTimeout(() => void syncAfterWrite(), 250)
    }} onDraftStateChange={setDraftUnsaved} /> : <main className="app-shell"><p role="status">Загружаем личный журнал…</p></main>}
  </>
}

export function ProfileDialog({ email, createdAt, status, stats, bodyProfile, onSaveBody, importing, onClose, onSignOut, onExport, onImport }: { email: string; createdAt?: string; status: string; stats: { workouts: number; sets: number } | null; bodyProfile?: BodyProfile | null; onSaveBody?: (value: BodyProfile) => Promise<void>; importing: boolean; onClose: () => void; onSignOut: () => void; onExport: () => void; onImport: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [height, setHeight] = useState('')
  const [bodyWeight, setBodyWeight] = useState('')
  const [bodyMessage, setBodyMessage] = useState('')
  useEffect(() => { setHeight(bodyProfile?.heightCm?.toString() ?? ''); setBodyWeight(bodyProfile?.bodyWeightKg?.toString() ?? '') }, [bodyProfile])
  useEffect(() => { if (typeof ref.current?.showModal === 'function') ref.current.showModal(); else ref.current?.setAttribute('open', '') }, [])
  return <dialog className="profile-dialog" ref={ref} onCancel={onClose} aria-labelledby="profile-title"><div className="profile-dialog__heading"><span className="profile-dialog__eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span><button type="button" className="profile-dialog__close" aria-label="Закрыть профиль" onClick={onClose}>×</button></div>
    <div className="profile-identity"><span className="profile-identity__avatar">{email.charAt(0).toLocaleUpperCase()}</span><div><h2 id="profile-title">Ваш профиль</h2><p>{email}</p></div></div>
    <div className="profile-stats"><div><strong>{stats?.workouts ?? '—'}</strong><span>тренировок</span></div><div><strong>{stats?.sets ?? '—'}</strong><span>подходов</span></div></div>
    <div className="profile-details"><p><span>Синхронизация</span><strong>{status}</strong></p>{createdAt && <p><span>С нами с</span><strong>{new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(new Date(createdAt))}</strong></p>}</div>
    {onSaveBody && <section className="profile-body"><h3>Параметры тела</h3><p>Личная заметка на этом устройстве; на расчёт рабочих весов не влияет.</p><div><label>Рост, см<input className="search-input" type="number" inputMode="numeric" min="80" max="250" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label>Вес, кг<input className="search-input" type="number" inputMode="decimal" min="20" max="400" step="0.1" value={bodyWeight} onChange={(event) => setBodyWeight(event.target.value)} /></label></div><Button variant="quiet" onClick={() => void onSaveBody({ heightCm: height ? Number(height) : null, bodyWeightKg: bodyWeight ? Number(bodyWeight) : null }).then(() => setBodyMessage('Параметры сохранены на устройстве')).catch((cause: unknown) => setBodyMessage(cause instanceof Error ? cause.message : 'Не удалось сохранить'))}>Сохранить параметры</Button>{bodyMessage && <p role="status">{bodyMessage}</p>}</section>}
    <p className="profile-install">На iPhone: Safari → «Поделиться» → «На экран Домой».</p>
    <details className="profile-backup"><summary>Данные и резервная копия <span aria-hidden="true">⌄</span></summary><p>Обычно записи хранятся в облаке. Копия пригодится при редком конфликте или очистке данных браузера.</p><div className="backup-actions"><Button variant="quiet" onClick={onExport}>Скачать копию</Button><Button variant="quiet" disabled={importing} onClick={onImport}>{importing ? 'Восстановление…' : 'Восстановить'}</Button></div></details>
    <Button className="profile-signout" variant="quiet" onClick={onSignOut}>Выйти из аккаунта</Button>
  </dialog>
}
