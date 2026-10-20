# Offline-first and synchronization protocol — v0.4

**Status:** архитектурная цель, ещё не реализована. План 002 использует dev-only локальный профиль, публичный журнал появляется лишь с обязательной авторизацией (ADR 0006). До успешного Plan 004 ежедневное использование не рекомендовать.

## Что означает офлайн
1. Установка/первая загрузка shell PWA — онлайн; далее Service Worker может открыть HTML/JS/CSS офлайн.
2. Первая регистрация/вход в Supabase — онлайн. Офлайн можно записывать **только ранее вошедшему на этом устройстве, не выполнившему выход** пользователю в его локальную область, без обещания, что серверная сессия в этот момент действительна.
3. Локальный IndexedDB commit сохраняется при обычном обновлении/перезапуске. Не гарантирует восстановление после очистки браузера/эвикции/поломки устройства.
4. Статус `Синхронизировано` только после подтверждения Supabase. `navigator.onLine` — лишь подсказка.

## Local storage (Dexie)
- `workspaces`: `workspaceId UUID`, `mode=dev_test|authenticated`, `ownerUserId?`, `createdAt`, `lastActiveAt`. Dev тестовые данные не становятся пользовательскими данными публичного приложения автоматически.
- `workouts`, `exercises`, `workoutExercises`, `exerciseSets`: стабильный entity UUID, `workspaceId`, `ownerUserId?`, `serverRevision?`, `localRevision`, `deletedAt?`, доменные поля.
- `outbox`: UUID `operationId`, `workspaceId`, `ownerUserId?`, entity info, snapshot, `baseServerRevision`, status/attempts/errors.
- `syncState`: курсор и последняя подтверждённая синхронизация **по ownerUserId**.
- Passwords, SMTP credentials, service_role и вручную скопированные JWT не хранить в таблицах.

## Write path
Validate input → generate stable entity/operation UUID → **atomic IDB transaction over record + outbox** → show `Сохранено на устройстве` → async sync when online and authenticated → server ack → mark synced.
If IndexedDB transaction fails, show `Не удалось сохранить`; never show success. For deleted/edited data keep operation and tombstone. For successive edits on same entity preserve expected ordering or safely coalesce changes; don't generate fake cross-user conflict.

## Sync protocol
- Sync only when `outbox.ownerUserId` equals verified current `auth.uid()` and session/network allows cloud calls. Never claim ownership from stale email or display name.
- Parent-before-child uploads; server-owned revision and atomic compare-and-swap; stable operation ID, operation ledger `(user_id, operation_id)`, retries safe after unknown ack; duplicate operation with changed payload rejected.
- Multiple devices/edit conflict: preserve local and remote versions; user chooses after review. Tombstones prevent resurrection.
- Reopen/foreground/manual Sync triggers; no guaranteed upload when PWA closed. Use jittered retry/backoff and show pending counts.
- Worker caches **static app shell only**, not API JSON/session tokens/user-private files.

## Auth and lifecycle
- `SIGNED_OUT`: AuthGate hides personal history, no offline journal if no active locally trusted prior login.
- `SIGNED_IN_ONLINE`: user scoped read/write, sync allowed by server.
- `SIGNED_IN_OFFLINE_CACHED`: cached identity from prior valid sign-in; local read/write only, sync paused until online revalidation.
- `AUTH_RECHECK_REQUIRED`: preserve owner-scoped pending changes; require reauth online.
- Signout with pending: warn, offer immediate sync or backup/export; never silently clear/publish pending. After signout hide access to old cache. Account B cannot access A's data or replay A's outbox.

## Fault-test matrix (Plan 004 release blockers)
1. First-time visitor offline / explicitly signed-out user offline → no access to personal journal, clear login requires internet message.
2. Existing signed-in user offline → PWA loads cached shell and only own records.
3. Record/edit/delete 3 sets offline → force-close/reopen → no loss, correct pending count.
4. Reconnect and validate same Auth user → upload exactly once after server ack.
5. Server committed but request timed out → retry same operation ID with no duplicate.
6. A and B account switching on same device → no cross-user visibility or queued data upload.
7. Supabase RLS direct requests: A/B/anon isolation including forged FKs.
8. Same account, 2 devices, concurrent edits → recoverable conflict, no silent overwrite.
9. Deleted set is not resurrected from stale device; conflict UI safe.
10. Export/import roundtrip + corrupted JSON import check.
11. Browser offline/online, 360px and 390px, numeric keyboard, real device.
12. В закрытом пилоте: signup владельца и вход на Pages работают без email verification; после закрытия signup новый аккаунт создать нельзя; UI не обещает password reset. Для открытой регистрации нужен отдельный gate.

## Не гарантируем
Безопасность локального IndexedDB как защищённого сейфа, поддержку первого входа без сети, 100% защиту от потери локальных данных, автоматический sync после полного закрытия браузера, бесконечный бесплатный cloud uptime.
