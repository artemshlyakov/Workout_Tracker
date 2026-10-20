# Plan 004 — reliable offline sync + **closed personal pilot** release gate

**Status: PLANNED after Plan 003.** В личный пилот выходить только после перечисленных проверок. **Не открывает публичную регистрацию сторонним пользователям.**

## Required
1. Idempotent sync RPC, owner-bound operation ledger, server-owned revisions, compare-and-swap и tombstones; retry after unknown server ack.
2. Transactional outbox recovery, backoff/jitter, manual Sync, зависимость родителей/дочерних записей, multiple edits per entity.
3. User-scoped local data; офлайн только после прошлой успешной авторизации и без явного signout. Никакого offline-first-time-login.
4. Logout with pending warning + recovery/export path; недопустим cross-account replay/outbox visibility.
5. Concurrent edits на двух устройствах: обе версии сохраняются, пользователь выбирает. Удалённый подход не «воскресает».
6. Auth режим закрытого пилота: email/password, `Confirm Email OFF`, signup закрыт **после** первоначальной регистрации A. Проверить повторный вход A и серверный запрет новых регистраций. Email reset/verification не выдавать за готовые функции.
7. Версионируемые JSON export/import + тест плохого JSON, без secret leaks.
8. RLS/grants direct REST/RPC tests User A/B/anon, включая чужие ссылки.
9. Ручное тестирование PWA на телефоне 360/390px, офлайн перезапуск, возврат сети, GitHub Pages deployment.

## DoD — must all pass
- A сохраняет >=3 подходов офлайн, закрывает/открывает приложение, при reconnect отправляет ровно один раз.
- Offline first login и signed-out offline journal недоступны; другой аккаунт не может прочитать локальную историю A.
- RLS/REST A/B/anon; account switch блокирует cross-user visibility/dispatch.
- Conflict UI и tombstones; без потери данных после повторной отправки при неполученном ответе сервера.
- Backup round-trip и corruption тест; история в облаке доступна A на втором устройстве.
- Ссылка Pages доступна, но неавторизованный пользователь не получает доступ к данным; signup после закрытия реально запрещён сервером.
- Рабочий вход/выход и явное предупреждение о **недоступном восстановлении через почту**. Владелец лично проверил на устройстве и знает ограничение по восстановлению.

## Отдельный gate для открытой регистрации
До публичного multiuser запуска необходимо новый ADR: рабочая проверка email и восстановление (SMTP) **или** согласованный OAuth, защита от злоупотреблений, тестирование ранее автоматически подтверждённых пользователей, доступность входа и восстановление на настоящем Pages URL. Этот gate не входит в Plan 004.
