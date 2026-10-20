import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), signOut: vi.fn(),
}))
vi.mock('../cloud/client', () => ({ supabase: { auth: mocks } }))

import { authErrorMessage, restoreAuth, signOut } from './auth'

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', is_anonymous: false }

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true })
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user } }, error: null })
  mocks.getUser.mockReset().mockResolvedValue({ data: { user }, error: null })
  mocks.signOut.mockReset().mockResolvedValue({ error: null })
})

describe('auth lifecycle', () => {
  it('allows an online workspace only after getUser confirms the same account', async () => {
    expect((await restoreAuth()).kind).toBe('SIGNED_IN_ONLINE')
    mocks.getUser.mockResolvedValue({ data: { user: { ...user, id: 'other' } }, error: null })
    expect((await restoreAuth()).kind).toBe('AUTH_RECHECK_REQUIRED')
  })

  it('opens only a previously cached account while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect((await restoreAuth()).kind).toBe('SIGNED_IN_OFFLINE_CACHED')
    expect(mocks.getUser).not.toHaveBeenCalled()
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect((await restoreAuth()).kind).toBe('SIGNED_OUT')
  })

  it('rejects anonymous Auth users and signs out locally when offline', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { ...user, is_anonymous: true } } }, error: null })
    expect((await restoreAuth()).kind).toBe('SIGNED_OUT')
    vi.stubGlobal('navigator', { onLine: false })
    await signOut()
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('shows a clear Russian error for rejected credentials or registration', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Неверная почта или пароль')
    expect(authErrorMessage({ code: 'signup_disabled' })).toBe('Регистрация закрыта на сервере')
  })

  it('closes the local session if global sign-out cannot reach the server', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: new Error('network') }).mockResolvedValueOnce({ error: null })
    expect(await signOut()).toBe('local')
    expect(mocks.signOut).toHaveBeenNthCalledWith(1, { scope: 'global' })
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
  })
})
