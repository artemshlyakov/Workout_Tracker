// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthGate, completedStatus, statusText } from './AuthGate'

const state = vi.hoisted(() => ({
  user: 'A', failA: true, notify: null as null | ((event: string) => void),
  pulls: [] as string[], pushes: [] as string[], stops: [] as string[],
  firstRestore: null as null | ((value: unknown) => void), delayRestore: false,
}))

vi.mock('../../data/auth/auth', () => ({
  restoreAuth: vi.fn(() => state.delayRestore ? new Promise((resolve) => { state.firstRestore = resolve }) : Promise.resolve(state.user === 'out' ? { kind: 'SIGNED_OUT' } : { kind: 'SIGNED_IN_ONLINE', user: { id: state.user, email: `${state.user}@test.invalid` } })),
  signOut: vi.fn(async () => { state.user = 'out'; state.notify?.('SIGNED_OUT'); return 'global' }),
}))
vi.mock('../../data/cloud/client', () => ({ supabase: { auth: { onAuthStateChange: (callback: (event: string) => void) => {
  state.notify = callback
  return { data: { subscription: { unsubscribe: () => { state.notify = null } } } }
} } } }))
vi.mock('../../data/local/schema', () => ({ WorkoutDatabase: class { constructor(public name: string) {} } }))
vi.mock('../../data/local/DexieWorkoutRepository', () => ({ DexieWorkoutRepository: class {
  workspaceId: string
  ownerUserId: string
  db = { workspaces: { get: async () => ({ id: this.workspaceId }) }, outbox: { where: () => ({ equals: () => ({ count: async () => 0 }) }) } }
  constructor(_db: unknown, options: { ownerUserId: string }) { this.workspaceId = options.ownerUserId; this.ownerUserId = options.ownerUserId }
  async load() { return { title: this.workspaceId, sets: [] } }
  async exportAccountData() { return '{}' }
} }))
vi.mock('../../data/cloud/sync', () => ({ CloudSync: class {
  owner: string
  constructor(repository: { ownerUserId: string }) { this.owner = repository.ownerUserId }
  async prepare() { state.pulls.push(this.owner); return { cloudChecked: false } }
  async pendingCount() { return 0 }
  async push() { state.pushes.push(this.owner); if (this.owner === 'A' && state.failA) throw new Error('A network error'); return { acknowledged: 0, pending: 0 } }
  async stop() { state.stops.push(this.owner) }
} }))
vi.mock('../../app/App', () => ({ App: ({ repository, onDraftStateChange }: { repository: { workspaceId: string }; onDraftStateChange: (value: boolean) => void }) => <div data-testid="workout">{repository.workspaceId}<button onClick={() => onDraftStateChange(true)}>Изменить черновик</button></div> }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  state.user = 'A'; state.failA = true; state.notify = null; state.pulls = []; state.pushes = []; state.stops = []; state.firstRestore = null; state.delayRestore = false
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('confirm', vi.fn(() => true))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

it('does not claim cloud confirmation from an empty queue', () => {
  expect(completedStatus({ acknowledged: 0, pending: 0 }, false)).toEqual({ kind: 'pending', count: 0 })
  expect(statusText(completedStatus({ acknowledged: 0, pending: 0 }, false))).toContain('не проверено')
  expect(completedStatus({ acknowledged: 0, pending: 0 }, true)).toEqual({ kind: 'confirmed' })
  expect(completedStatus({ acknowledged: 1, pending: 0 }, false)).toEqual({ kind: 'confirmed' })
  expect(completedStatus({ acknowledged: 1, pending: 2 }, true)).toEqual({ kind: 'pending', count: 2 })
})

it('scopes errors, draft state, status, and workspace to each account across switch and logout', async () => {
  await act(async () => root.render(<AuthGate />))
  await vi.waitFor(() => expect(container.textContent).toContain('A network error'))
  expect(container.querySelector('[data-testid=workout]')?.textContent).toContain('A')
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid=workout] button')!.click() })
  await act(async () => { state.user = 'B'; state.notify?.('SIGNED_IN') })
  await vi.waitFor(() => expect(container.querySelector('[data-testid=workout]')?.textContent).toContain('B'))
  expect(container.textContent).not.toContain('A network error')
  expect(container.textContent).toContain('Облачное состояние ещё не проверено')
  expect(state.stops).toContain('A')
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Выйти')!.click() })
  await vi.waitFor(() => expect(container.querySelector('[data-testid=workout]')).toBeNull())
  expect(window.confirm).not.toHaveBeenCalled()
  state.failA = false
  await act(async () => { state.user = 'A'; state.notify?.('SIGNED_IN') })
  await vi.waitFor(() => expect(container.querySelector('[data-testid=workout]')?.textContent).toContain('A'))
  expect(container.textContent).not.toContain('A network error')
  expect(state.stops).toContain('B')
})

it('ignores a late A restore after logout', async () => {
  state.delayRestore = true
  await act(async () => root.render(<AuthGate />))
  expect(state.firstRestore).not.toBeNull()
  await act(async () => { state.user = 'out'; state.notify?.('SIGNED_OUT') })
  await act(async () => state.firstRestore?.({ kind: 'SIGNED_IN_ONLINE', user: { id: 'A' } }))
  expect(container.querySelector('[data-testid=workout]')).toBeNull()
  expect(container.textContent).not.toContain('A@test.invalid')
})

it('retries a failed sync without claiming unverified cloud state', async () => {
  await act(async () => root.render(<AuthGate />))
  await vi.waitFor(() => expect(container.textContent).toContain('A network error'))
  state.failA = false
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Повторить')!.click() })
  await vi.waitFor(() => expect(container.textContent).toContain('Облачное состояние ещё не проверено'))
  expect(container.textContent).not.toContain('A network error')
  expect(state.stops).toContain('A')
})

it('allows manual sync and retries when the app returns to the foreground', async () => {
  state.user = 'B'
  await act(async () => root.render(<AuthGate />))
  await vi.waitFor(() => expect(state.pushes).toEqual(['B']))
  expect(container.textContent).toContain('Облачное состояние ещё не проверено')
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Синхронизировать')!.click() })
  await vi.waitFor(() => expect(state.pushes).toEqual(['B', 'B']))
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await vi.waitFor(() => expect(state.pushes).toEqual(['B', 'B', 'B']))
})
