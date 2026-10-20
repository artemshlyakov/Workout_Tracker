# Прогресс Workout Tracker

## Текущий этап

Plan 003A — подготовка облачной инфраструктуры и SQL к ревью. Ветка `feat/plan-003a-supabase-infrastructure` от `origin/main` после объединения PR #2.

## Реально выполнено

- Проверено, что Plan 002 объединён в `main`.
- Через Supabase plugin найдена единственная Free-организация, проверена стоимость нового проекта 0/мес и создан `workout-tracker` (`snnlibzckwpmbkersdnm`, `eu-central-1`). Supabase подтвердил `ACTIVE_HEALTHY`, PostgreSQL 17.11; `public` и история миграций пусты.
- Через Supabase CLI создан файл миграции; подготовлены таблицы, RLS/grants, owner-aware FK, CAS/RPC и операция ledger. Создан сценарий интеграционных проверок.
- Подготовлен обзор схемы и рисков: `docs/architecture/plan-003a-review.md`.

## Подготовлено, но не применено

- `supabase/migrations/20261020124057_private_workout_sync.sql`. **Облачную миграцию не применяли**: ожидается контрольная точка владельца.
- `supabase/tests/security.integration.mjs`. Реальные A/B/anon проверки ждут миграцию и двух контролируемых аккаунтов.

## Проверки

- Миграция разобрана локальным PostgreSQL-парсером `pglast` (25 SQL-операторов), затем успешно применена в одноразовом изолированном Docker-контейнере PostgreSQL 17 с тестовыми заглушками `auth.uid()`/`auth.jwt()`.
- В локальном PostgreSQL пройдены проверки RLS и grants, A/B/anon и Auth anonymous, запрета чужих FK, повторной операции, несовпадающего payload, повторного создания UUID, CAS-конфликта и tombstone. Воспроизводимый сценарий добавлен в `supabase/tests/`; он не заменяет тесты в реальном Supabase.
- `node --check supabase/tests/security.integration.mjs` — успешно; сетевой тест не запускался без миграции и двух аккаунтов.
- `npm run lint`, `npm run typecheck`, `npm test -- --run` (15 тестов), `npm run build`, `git diff --check` — успешно.
- Облачные SQL/RLS/REST тесты не запускались до контрольной точки применения.

## Ограничения и действия владельца

- Инструмент Supabase не предоставляет управление настройками Auth. Для закрытого пилота владелец должен выбрать `Confirm Email = OFF`; после создания владельца и тестовых аккаунтов A/B — `Allow new users to sign up = OFF` на сервере. Агент не создавал аккаунты и не придумывал пароли.
- Приложение по-прежнему в локальном dev-режиме Plan 002. Нет входа и синхронизации. Не публиковать как продукт.
- Следующее действие: ревью подготовленной миграции и отдельное согласование её применения; затем реальные security-тесты. Plan 004 не начинать.

## PR или коммит

Draft PR: https://github.com/artemshlyakov/Workout_Tracker/pull/3 (ветка `feat/plan-003a-supabase-infrastructure`, основной коммит `94fe86d`). Не объединён.
