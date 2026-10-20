import type { User } from '@supabase/supabase-js'
import { supabase } from '../cloud/client'

export type AuthState =
  | { kind: 'SIGNED_OUT' }
  | { kind: 'SIGNED_IN_ONLINE'; user: User }
  | { kind: 'SIGNED_IN_OFFLINE_CACHED'; user: User }
  | { kind: 'AUTH_RECHECK_REQUIRED'; user: User }

export async function restoreAuth(): Promise<AuthState> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session?.user || session.user.is_anonymous) return { kind: 'SIGNED_OUT' }
  if (!navigator.onLine) return { kind: 'SIGNED_IN_OFFLINE_CACHED', user: session.user }
  const checked = await supabase.auth.getUser()
  if (checked.error || !checked.data.user || checked.data.user.id !== session.user.id) {
    return { kind: 'AUTH_RECHECK_REQUIRED', user: session.user }
  }
  return { kind: 'SIGNED_IN_ONLINE', user: checked.data.user }
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string): Promise<void> {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (!data.session) throw new Error('Аккаунт создан без активного сеанса. Проверьте настройки закрытого пилота в Supabase Dashboard')
}

export async function signOut(): Promise<'global' | 'local'> {
  if (navigator.onLine) {
    const globalResult = await supabase.auth.signOut({ scope: 'global' })
    if (!globalResult.error) return 'global'
  }
  const localResult = await supabase.auth.signOut({ scope: 'local' })
  if (localResult.error) throw localResult.error
  return 'local'
}

export function authErrorMessage(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : ''
  switch (code) {
    case 'invalid_credentials': return 'Неверная почта или пароль'
    case 'email_not_confirmed': return 'Для этого аккаунта требуется подтверждение почты'
    case 'user_already_exists': return 'Аккаунт с такой почтой уже существует'
    case 'signup_disabled': return 'Регистрация закрыта на сервере'
    case 'weak_password': return 'Пароль не соответствует требованиям сервера'
    case 'over_email_send_rate_limit': return 'Слишком много запросов. Попробуйте позже'
  }
  if (!navigator.onLine || cause instanceof TypeError) return 'Нет связи с сервером. Проверьте интернет'
  return cause instanceof Error && cause.message.startsWith('Аккаунт создан без активного сеанса') ? cause.message : 'Не удалось выполнить вход. Попробуйте позже'
}
