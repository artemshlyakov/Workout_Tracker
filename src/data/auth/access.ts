import type { AuthState } from './auth'

/** Only a signed-in identity can select an account-scoped IndexedDB database. */
export function workspaceOwner(auth: AuthState | null): string | null {
  return auth && auth.kind !== 'SIGNED_OUT' && !auth.user.is_anonymous ? auth.user.id : null
}

export function mayOpenWorkspace(auth: AuthState, hasCachedWorkspace: boolean): boolean {
  return workspaceOwner(auth) !== null && (auth.kind === 'SIGNED_IN_ONLINE' || hasCachedWorkspace)
}

export function maySync(auth: AuthState, ownerUserId: string): boolean {
  return auth.kind === 'SIGNED_IN_ONLINE' && workspaceOwner(auth) === ownerUserId
}
