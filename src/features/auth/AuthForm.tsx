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

  function changeMode(next: boolean) {
    if (busy || registering === next) return
    setRegistering(next)
    setError(null)
    setSuccess(null)
    setConfirm('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!navigator.onLine) { setError('Для входа и регистрации нужен интернет'); return }
    if (registering && password !== confirm) { setError('Пароли не совпадают'); return }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (registering) {
        const result = await signUp(email.trim(), password)
        if (result === 'confirmation_required') {
          setSuccess('Проверьте почту и перейдите по ссылке подтверждения, если письмо было отправлено. Затем войдите.')
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
    <header className="auth-brand">
      <span className="auth-brand__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
          <path d="M5 12v8m4-12v16m4-12v8m6-8v8m4-12v16m4-12v8M13 16h6" />
        </svg>
      </span>
      <div className="auth-brand__name">WORKOUT <span>TRACKER</span><small>Личный дневник тренировок</small></div>
    </header>

    <section className="auth-hero" aria-labelledby="auth-hero-title">
      <span className="auth-hero__eyebrow"><span aria-hidden="true" /> ТВОЙ ТЕМП. ТВОЙ ПРОГРЕСС.</span>
      <h1 id="auth-hero-title">Каждый подход <span>имеет значение.</span></h1>
      <p>Записывай упражнения, следи за рабочими весами и возвращайся к своим результатам.</p>
      <div className="auth-features" aria-label="Возможности приложения">
        <span>01 / Тренировки</span><span>02 / История</span><span>03 / Прогресс</span>
      </div>
    </section>

    <section className="auth-panel" aria-label="Доступ к аккаунту">
      <div className="auth-mode-switch" role="group" aria-label="Выберите действие">
        <button type="button" className={!registering ? 'auth-mode-switch__button is-active' : 'auth-mode-switch__button'} aria-pressed={!registering} disabled={busy} onClick={() => changeMode(false)}>Войти</button>
        <button type="button" className={registering ? 'auth-mode-switch__button is-active' : 'auth-mode-switch__button'} aria-pressed={registering} disabled={busy} onClick={() => changeMode(true)}>Регистрация</button>
      </div>

      <div className="auth-panel__intro">
        <h2>{registering ? 'Создать аккаунт' : 'С возвращением'}</h2>
        <p>{registering ? 'Начни вести свой журнал тренировок.' : 'Продолжи там, где остановился.'}</p>
      </div>
      {notice && <p role="status" className="auth-notice">{notice}</p>}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <div className="auth-field">
          <label htmlFor="auth-email">Электронная почта</label>
          <input id="auth-email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" spellCheck={false} required value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="auth-field">
          <label htmlFor="auth-password">Пароль</label>
          <div className="auth-password-control">
            <input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? 'Не менее 6 символов' : 'Введите пароль'} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Скрыть' : 'Показать'}</button>
          </div>
        </div>
        {registering && <div className="auth-field">
          <label htmlFor="auth-confirm">Повторите пароль</label>
          <input id="auth-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={6} required placeholder="Повторите пароль" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </div>}
        {error && <p role="alert" className="auth-error">{error}</p>}
        {success && <p role="status" className="auth-success">{success}</p>}
        <Button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Подождите…' : registering ? 'Создать аккаунт' : 'Войти в дневник'} <span aria-hidden="true">↗</span></Button>
      </form>
    </section>
    <p className="auth-footnote">После первого входа записи доступны на этом устройстве без интернета.</p>
  </main>
}
