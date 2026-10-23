import { afterEach, expect, it, vi } from 'vitest'
import { timedFetch } from './timedFetch'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('aborts a hung request after 20 seconds and propagates cancellation', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((_input, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason)
    else init.signal.addEventListener('abort', () => reject(init.signal.reason))
  })))
  const pending = timedFetch('https://example.test')
  const rejected = expect(pending).rejects.toThrow('Сервер не ответил вовремя')
  await vi.advanceTimersByTimeAsync(20000); await rejected
  const abort = new AbortController()
  const cancelled = timedFetch('https://example.test', { signal: abort.signal })
  const checked = expect(cancelled).rejects.toThrow('stop')
  abort.abort(new Error('stop')); await checked
  expect(vi.getTimerCount()).toBe(0)
})
