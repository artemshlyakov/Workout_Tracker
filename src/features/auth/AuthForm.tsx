import { useState, type FormEvent } from 'react'
import { authErrorMessage, signIn, signUp } from '../../data/auth/auth'
import { Button } from '../../shared/Button'

export function AuthForm({ onSuccess, notice }: { onSuccess: () => void; notice?: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!navigator.onLine) { setError('Для первого входа нужен интернет'); return }
    if (registering && password !== confirm) { setError('Пароли не совпадают'); return }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (registering) {
        const result = await signUp(email.trim(), password)
        if (result === 'confirmation_required') {
          setSuccess('Если для этого адреса создан аккаунт, проверьте почту и перейдите по ссылке подтверждения. Затем войдите.')
          setRegistering(false)
          setConfirm('')
          return
        }
      } else {
        await signIn(email.trim(), password)
      }
      onSuccess()
    } catch (cause) {
      setError(authErrorMessage(cause))
    } finally { setBusy(false) }
  }

  return <main className="app-shell auth-shell">
    <div className="header-kicker"><span className="live-dot" aria-hidden="true" /> WORKOUT TRACKER</div>
    <h1>{registering ? 'Регистрация' : 'Ваши тренировки'}</h1>
    <p className="date-line">Личный журнал силовых тренировок</p>
    {notice && <p role="status" className="auth-notice">{notice}</p>}
    <section className="workout-title-card auth-card">
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="auth-email">EMAIL</label>
        <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="auth-password">ПАРОЛЬ</label>
        <input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
        <label className="auth-toggle"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} /> Показать пароль</label>
        {registering && <><label htmlFor="auth-confirm">ПОВТОРИТЕ ПАРОЛЬ</label><input id="auth-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(event) => setConfirm(event.target.value)} /></>}
        {error && <p role="alert" className="auth-error">{error}</p>}
        {success && <p role="status" className="auth-success">{success}</p>}
        <Button type="submit" disabled={busy}>{busy ? 'Подождите…' : registering ? 'Создать аккаунт' : 'Войти'}</Button>
      </form>
    </section>
    <Button variant="quiet" disabled={busy} onClick={() => { setRegistering(!registering); setError(null); setSuccess(null); setConfirm('') }}>{registering ? 'Вернуться ко входу' : 'Создать аккаунт'}</Button>
    <p className="footer-note">Для первого входа нужен интернет. Восстановление пароля по почте пока недоступно.</p>
  </main>
}
