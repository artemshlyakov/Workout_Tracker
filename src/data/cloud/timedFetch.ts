/** Bound requests without changing TLS or the Supabase SDK's auth headers. */
export async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const abort = () => controller.abort(upstream?.reason)
  if (upstream?.aborted) abort()
  else upstream?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Сервер не ответил вовремя', 'TimeoutError')), 20000)
  try { return await fetch(input, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer); upstream?.removeEventListener('abort', abort) }
}
