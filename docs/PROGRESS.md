# Прогресс Workout Tracker

## Текущий этап

Plan 003A — согласованная SQL-инфраструктура применена и проверена в облаке. Ветка `feat/plan-003a-supabase-infrastructure`, Draft PR #3; работа остановлена до следующего задания.

## Реально выполнено

- Проверено, что Plan 002 объединён в `main`.
- Через Supabase plugin найдена единственная Free-организация, проверена стоимость нового проекта 0/мес и создан `workout-tracker` (`snnlibzckwpmbkersdnm`, `eu-central-1`). Перед применением согласованного SQL проект был `ACTIVE_HEALTHY`, а `public` и история миграций пусты.
- Через Supabase CLI создан файл миграции; подготовлены таблицы, RLS/grants, owner-aware FK, CAS/RPC и операция ledger. Создан сценарий интеграционных проверок.
- По внешнему ревью миграция дополнена установкой `pgcrypto` в `extensions` и проверкой `extensions.digest(bytea,text)`. Security-сценарии расширены проверками всех пользовательских таблиц и закрытого ledger.
- Подготовлен обзор схемы и рисков: `docs/architecture/plan-003a-review.md`.
- После явного разрешения владельца файл `20261020124057_private_workout_sync.sql` применён через Supabase MCP без изменений после ревью `b36799f`. Облачная история зарегистрировала версию `20261020132939_private_workout_sync`.

## Подготовлено для следующего этапа

- `supabase/tests/security.integration.mjs`. Реальные A/B/anon REST/RPC проверки ждут двух контролируемых аккаунтов; агент их не создавал.
- Имя локального файла миграции отличается timestamp от облачной записи. До следующей миграции требуется согласовать историю с CLI; повторный `db push` без проверки может повторно выполнить уже применённый SQL.

## Проверки

- Миграция успешно применена в двух одноразовых локальных базах PostgreSQL 17 с тестовыми заглушками `auth.uid()`/`auth.jwt()`: с заранее установленным `pgcrypto` и без него. В обоих случаях `extensions.digest(bytea,text)` доступна.
- В обеих локальных базах пройдены проверки RLS и grants, отсутствия прямых `INSERT/UPDATE/DELETE` для `authenticated` на всех пяти таблицах, недоступности `sync_operations` и всех таблиц для `anon`, A/B и Auth anonymous, запрета чужих FK, повторной операции, несовпадающего payload, повторного UUID, CAS-конфликта и tombstone. Воспроизводимый сценарий находится в `supabase/tests/`; он не заменяет тесты в реальном Supabase.
- Облачный `list_tables(public)` показал пять пустых таблиц с RLS; SQL-каталог подтвердил четыре owner-scoped SELECT-политики, отсутствие клиентских прав записи и доступа к ledger, а также `SECURITY DEFINER` RPC с пустым `search_path`, доступный только `authenticated`. `pgcrypto` 1.3 и `extensions.digest(bytea,text)` доступны.
- Security Advisors: INFO `rls_enabled_no_policy` для закрытого ledger; WARN `authenticated_security_definer_function_executable` для намеренного RPC. Performance Advisors: WARN `auth_rls_initplan` на четырёх SELECT-политиках; INFO `unused_index` для шести индексов в пустых таблицах. Детали и ссылки: `docs/architecture/plan-003a-review.md`.
- `node --check supabase/tests/security.integration.mjs` — успешно; сетевой тест не запускался без миграции и двух аккаунтов.
- `npm run lint`, `npm run typecheck`, `npm test -- --run` (15 тестов), `npm run build`, `git diff --check` — успешно.
- Реальные облачные проверки схемы и прав выполнены; REST/RPC тесты с пользователями A/B ещё не запускались.

## Ограничения и действия владельца

- Инструмент Supabase не предоставляет управление настройками Auth. Для закрытого пилота владелец должен выбрать `Confirm Email = OFF`; после создания владельца и тестовых аккаунтов A/B — `Allow new users to sign up = OFF` на сервере. Агент не создавал аккаунты и не придумывал пароли.
- Приложение по-прежнему в локальном dev-режиме Plan 002. Нет входа и синхронизации. Не публиковать как продукт.
- Следующее действие после отдельного задания: настройка Auth владельцем и реальные A/B/anon security-тесты. Сейчас никаких дополнительных миграций и работ Plan 003B/004 не выполнять.

## PR или коммит

Draft PR: https://github.com/artemshlyakov/Workout_Tracker/pull/3 (ветка `feat/plan-003a-supabase-infrastructure`, согласованный SQL-коммит `b36799f`). Не объединён.
