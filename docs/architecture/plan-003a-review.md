# Plan 003A — применённая облачная миграция и проверки

**Статус:** после внешнего ревью `b36799f` и явного разрешения владельца согласованный SQL применён к проекту `snnlibzckwpmbkersdnm`. Draft PR #3 не объединён; Auth и синхронизация ещё не настроены.

## Подтверждённое состояние Supabase

- Подключённый Supabase plugin: доступ к списку организаций и проектов, созданию проекта, оценке стоимости, миграциям, таблицам, SQL и advisors.
- Организация `artemshlyakov's Org` — Free; стоимость нового проекта, показанная `get_cost`, — 0 в месяц.
- Создан проект `workout-tracker`, ID `snnlibzckwpmbkersdnm`, регион `eu-central-1`. `get_project`: `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- Непосредственно перед применением `list_tables(public)` и `list_migrations` вернули пустые списки; каталог показал 0 отношений в `public`, отсутствие RPC и `pgcrypto` 1.3 в `extensions`.
- В подключённых инструментах нет изменения настроек Supabase Auth. `Confirm Email = OFF` и последующее серверное `Allow new users to sign up = OFF` пока **не настроены и не подтверждены**. Пароли и аккаунты агент не создавал.

## Применённая миграция

Файл: `supabase/migrations/20261020124057_private_workout_sync.sql`. Создан через Supabase CLI 2.121.0 (`supabase migration new`), затем заполнен вручную. Применён через Supabase MCP без правок после ревью; SHA-256 файла `659955b2d2d84ac3d12750b770650ae86d7266cbc63500fb456990cb36671417`. Старый SQL-черновик v0.2 не использован. Облачная запись истории: `20261020132939_private_workout_sync` — timestamp инструмента MCP отличается от имени локального файла. До новых миграций нужно согласовать локальную и облачную историю, чтобы CLI не применил этот SQL повторно.

### Зависимость от pgcrypto

Идемпотентный RPC вычисляет SHA-256 отпечаток операции через `extensions.digest(bytea, text)`, которую предоставляет расширение `pgcrypto`. В начале **этой же миграции**, до создания таблиц и RPC, выполняются `create schema if not exists extensions` и `create extension if not exists pgcrypto with schema extensions`. Затем `to_regprocedure('extensions.digest(bytea,text)')` проверяет точную функцию; при её отсутствии миграция прерывается с понятной ошибкой. Если `pgcrypto` уже установлено в другой схеме, `IF NOT EXISTS` не переносит его автоматически: нужна отдельная проверка расположения и согласованное решение до применения, без молчаливой смены схемы существующего расширения.

В проекте `snnlibzckwpmbkersdnm` Supabase подтвердил `pgcrypto` 1.3 в `extensions` и наличие `extensions.digest(bytea,text)`. Локально миграция успешно применена и с заранее установленным расширением, и на чистом PostgreSQL 17 без него; оба варианта прошли SQL security-тесты.

| Таблица | Назначение | Главные связи |
| --- | --- | --- |
| `workouts` | Тренировка, название, начало и завершение | `user_id → auth.users` |
| `exercises` | Личный каталог упражнений | `user_id → auth.users` |
| `workout_exercises` | Упражнение внутри тренировки и порядок | `(user_id, workout_id)` и `(user_id, exercise_id)` |
| `exercise_sets` | Вес, повторы и порядок подходов | `(user_id, workout_exercise_id)` |
| `sync_operations` | UUID операции, SHA-256 отпечаток запроса, базовая ревизия и сохранённый результат | `(user_id, operation_id)` — первичный ключ |

Все сущности используют клиентский UUID, серверную ревизию, серверные UTC timestamps и `deleted_at` для мягкого удаления. Ограничения SQL: вес 0–2000 кг с двумя знаками, повторы 1–1000, неотрицательный порядок. Индексы покрывают пользователя и внешние ключи. Внешние ключи запрещают физическое удаление владельца или родителя без отдельной процедуры очистки; обычное удаление записей выполняется через tombstone.

## RLS и SQL-функция

RLS включается на всех пяти таблицах. `authenticated` получает только `SELECT` четырёх предметных таблиц при `user_id = auth.uid()`; Auth anonymous users исключены. У `anon` нет grants. На `sync_operations` нет клиентской политики или grant. Прямые `INSERT`, `UPDATE`, `DELETE` на таблицы для браузерных ролей отозваны.

Единственная новая функция — `public.apply_workout_operation(uuid, text, uuid, text, bigint, jsonb)`. Она принимает UUID операции/сущности, тип, действие, базовую ревизию и полный payload. `SECURITY DEFINER` нужен, поскольку прямые table writes запрещены; функция проверяет `auth.uid()`, типы и поля, фиксирует `search_path = ''`, использует полностью квалифицированные имена, проверяет живых родителей и блокирует строки родителей на время создания потомка. Доступ к функции отозван у `PUBLIC`/`anon` и выдан только `authenticated`.

Для повторного UUID операции с тем же SHA-256 отпечатком функция возвращает прежний результат. Повтор с иным запросом отклоняется. Запись и подтверждение операции выполняются одной транзакцией вызова. При устаревшей ревизии или повторном создании entity UUID функция возвращает `status: conflict` и текущую ревизию без перезаписи; этот результат тоже сохраняется в ledger. Для разрешения конфликта нужен новый UUID операции после выбора пользователя.

## Проверено в облаке после применения

- `list_tables(public)` показал ровно пять таблиц, у всех `rls_enabled = true`, все пусты. История содержит одну запись `20261020132939_private_workout_sync`.
- Каталог `pg_policies` показал четыре политики `SELECT` по `user_id = auth.uid()` с исключением Auth anonymous; у `sync_operations` политик нет. Для `authenticated` есть `SELECT` на четырёх предметных таблицах и нет прямых `INSERT/UPDATE/DELETE` ни на одной из пяти. У `anon` нет `SELECT/INSERT/UPDATE/DELETE` ни на одной таблице; ledger недоступен обеим клиентским ролям.
- Функция `public.apply_workout_operation(uuid,text,uuid,text,bigint,jsonb)` существует как `SECURITY DEFINER`, с `search_path = ''`; `EXECUTE` есть у `authenticated`, у `anon` отсутствует.
- Это проверки схемы и прав по реальному облачному каталогу. A/B REST/RPC тесты без аккаунтов не запускались.

## Supabase Advisors после применения

- **Security INFO:** [`rls_enabled_no_policy`](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) — `public.sync_operations` имеет RLS без политики. Это намеренно закрытый ledger без клиентских grants.
- **Security WARN:** [`authenticated_security_definer_function_executable`](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) — `authenticated` может вызвать `public.apply_workout_operation`. Это намеренный контролируемый путь записи; до использования нужны реальные отрицательные A/B/anon тесты.
- **Performance WARN, 4 находки:** [`auth_rls_initplan`](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) на политиках чтения `workouts`, `exercises`, `workout_exercises`, `exercise_sets`. В SQL уже используются подзапросы `select auth.uid()` и `select auth.jwt() ->> 'is_anonymous'`; предупреждение зафиксировано без изменения согласованного SQL. Проверить план выполнения на реальных данных перед отдельным решением об оптимизации.
- **Performance INFO, 6 находок:** [`unused_index`](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) для `workouts_user_started_idx`, `exercises_user_name_idx`, `workout_exercises_workout_idx`, `workout_exercises_exercise_idx`, `exercise_sets_parent_idx`, `sync_operations_user_created_idx`. Таблицы пока пусты; использование индексов оценивать после появления нагрузки.

Дополнительные миграции и исправления SQL не выполнялись.

## Оставшиеся проверки для следующего этапа

1. Владелец создаёт свой аккаунт с собственным паролем через интерфейс будущего этапа. Для тестов создаются два контролируемых аккаунта A/B; затем регистрация закрывается **на сервере**. До настройки Auth и двух аккаунтов сетевой тест не выполняется.
2. Запустить `supabase/tests/security.integration.mjs` с URL, publishable key и короткоживущими JWT тестовых A/B из локального окружения. Скрипт проверяет A/B/anon, запрет прямых REST `INSERT/UPDATE/DELETE` для всех пяти таблиц, недоступность `sync_operations`, чужие FK, повтор операции, иной payload с тем же UUID, CAS-конфликт и tombstone. Токены не печатать и не коммитить.
3. Проверить серверный запрет нового signup и вход существующего аккаунта. Подтверждение email и восстановление пароля в закрытом пилоте не обещать.

## Проверено до применения

- Миграция применена в двух одноразовых локальных базах PostgreSQL 17 с тестовой схемой Auth: одна без `pgcrypto`, другая с уже установленным `pgcrypto` в `extensions`. В обоих вариантах прошёл сценарий A/B/anon и Auth anonymous: RLS/grants, отсутствие прямых `INSERT/UPDATE/DELETE` на всех пяти таблицах, недоступность ledger, чужие FK, повтор операции и несовпадающий payload, конфликт при повторном создании UUID, CAS и tombstone. Сценарий сохранён в `supabase/tests/local-bootstrap.sql` и `supabase/tests/security.local.sql`; тестовые транзакции откатаны, облачный проект не затронут.
- Интеграционный REST-скрипт проверен `node --check`; реальные Supabase SQL-каталог и Advisors проверены, **REST/RPC тесты с A/B аккаунтами ещё не запускались**.
- Наличие `pgcrypto` 1.3 в схеме `extensions` подтверждено Supabase `list_extensions`.

## Риски и блокирующие условия

- `SECURITY DEFINER` обходит RLS; ошибка в проверке пользователя или привязке родителя может открыть данные. Нужны отрицательные тесты через реальные A/B/anon до использования приложения.
- Настройки Auth не доступны через подключённый Supabase plugin. Владелец должен выставить `Confirm Email = OFF` для закрытого пилота, а после создания контролируемых аккаунтов — `Allow new users to sign up = OFF` в Dashboard. Агент проверит состояние через доступные средства после этого шага; без подтверждения настройки нельзя считать готовыми.
- На этапе 003A нет AuthGate, пользовательских локальных областей и синхронизации в React. Dev-данные Plan 002 не переносятся автоматически.
- Пароль владельца и тестовые JWT не передавать через чат. Проект пока нельзя использовать как личный журнал или публиковать как готовый продукт.
