import { describe, expect, it } from 'vitest'
import type { AuthState } from './auth'
import { mayOpenWorkspace, maySync, workspaceOwner } from './access'

const account = (id: string, kind: 'SIGNED_IN_ONLINE' | 'SIGNED_IN_OFFLINE_CACHED' | 'AUTH_RECHECK_REQUIRED'): AuthState =>
  ({ kind, user: { id, is_anonymous: false } } as AuthState)

describe('AuthGate access policy', () => {
  it('hides the journal after logout', () => {
    const signedOut: AuthState = { kind: 'SIGNED_OUT' }
    expect(workspaceOwner(signedOut)).toBeNull()
    expect(mayOpenWorkspace(signedOut, true)).toBe(false)
    expect(maySync(signedOut, 'A')).toBe(false)
  })

  it('switches local workspaces by stable user ID', () => {
    expect(workspaceOwner(account('A', 'SIGNED_IN_ONLINE'))).toBe('A')
    expect(workspaceOwner(account('B', 'SIGNED_IN_ONLINE'))).toBe('B')
    expect(maySync(account('B', 'SIGNED_IN_ONLINE'), 'A')).toBe(false)
    expect(maySync(account('B', 'SIGNED_IN_ONLINE'), 'B')).toBe(true)
  })

  it('allows offline use only for an existing workspace, with sync blocked', () => {
    const cached = account('A', 'SIGNED_IN_OFFLINE_CACHED')
    expect(mayOpenWorkspace(cached, false)).toBe(false)
    expect(mayOpenWorkspace(cached, true)).toBe(true)
    expect(maySync(cached, 'A')).toBe(false)
    expect(maySync(account('A', 'AUTH_RECHECK_REQUIRED'), 'A')).toBe(false)
  })
})
