# Mobile screen contracts — UX v0.2

**Visual reference:** `hybrid-mobile-concept.png`; selected hybrid style. Screens are product specifications; screenshots do not define DB schema.

## 0. App shell / navigation

Four tabs: `Тренировка`, `История`, `Упражнения`, `Прогресс`; profile available from header. Tabs have a visible active indicator and text labels. No inert actions; unreleased screens display explanatory empty states. Responsive at 360×800 and 390×844.

## 1. Active workout — the most important screen

Top: `Тренировка`, current local date, editable workout title; clear save status and overflow menu.
Exercise block: name, optional previous-session reference; each row shows `№ | Вес, кг | Повторы | выполнено` with per-row edit/delete actions. Primary action bottom of exercise card `+ Добавить подход`.

Behavior: tapping add creates one new row with previous weight prefilled (if available) and focused reps input. Editing updates volume immediately. Prevent duplicates from accidental double tap. Show set-level confirmation and restore ability for undo where safe. Workout-complete action must not erase edits. The header is distinct from the separate rest timer introduced in Plan 006.

For no workout: big `Начать тренировку` CTA, date, recent workout summary (if any). Plan 001 may begin directly with a seeded demo workout and a visible demo label.

## 2. History

Chronological newest first. Each list item: localized date, workout name, number of exercises, count of sets; total volume may appear with transparent formula. Tapping opens a **read-only previous workout** with edit action. Filters/search later.
Empty: `Пока нет тренировок` + `Начать тренировку`. Offline cached history should be labeled if stale (phase 003).

## 3. Exercises

User-scoped catalog. Search by name, quick add, recent/frequent items first when available. Add custom exercise and choose it in a workout. Avoid mandatory muscle-group taxonomy in MVP; category optional future. The list should remain usable without illustrations.
Empty: `Добавьте первое упражнение`.

## 4. Progress

Design intended: exercise picker, interval picker, `Лучший рабочий вес`, `Объём`, `Частота` metrics and readable chart. **Not part of plan 001.** Real charts only after sufficient stored records; no invented metrics. If no data: `Запишите несколько тренировок, чтобы увидеть прогресс`.

Первый визуальный срез Plan 004 показывал фактический лучший вес, суммарный объём и результаты завершённых тренировок; при двух и более записях — простые полосы сравнения. Plan 009 заменяет полосы на график дневного объёма всех завершённых тренировок и график лучшего веса выбранного упражнения. Один день с записью виден отдельной точкой; незавершённые записи и вымышленные значения не используются. Список упражнений открывается в адаптивной панели с поиском. Интервалы 30/90 дней и всё время действуют на оба графика. Локальные снимки `../screenshots/progress-chart-local-390.png` и `../screenshots/progress-picker-local-390.png` используют тестовые данные и не подтверждают браузерный Auth/offline/online сценарий.

## 5. Auth / account (Plan 003; mandatory for public version)

Dedicated login with email + password. Signup screen **только для первичного onboarding при временно открытой серверной регистрации** (ADR 0007); после закрытия signup показывать `Регистрация временно закрыта`. Username/display name optional. Не рисовать работающие confirmation/reset до появления проверенной доставки email; объяснить пользователю ограничение по восстановлению пароля. Successful sign-in navigates to workout. First login requires internet. Signed-out visitors cannot see personal records. Sign-out hides previous local cache offline; warn if pending.

## 6. Settings / Data

Export personal data to versioned JSON; import adds validated copies under the same owner without replacing the journal (ADR 0008). Account status, sign out and app version. Offline phase: pending count, explicit `Синхронизировать`, retry information.

## States mandatory for each implemented screen

Loading, empty, signed out, offline with cached prior identity, first-login offline unavailable, auth expired, form invalid, save failed. `Сохранено` only after server ack. No success toasts for unsaved React state.

## One-handed gym usability

- Big buttons and controlled input spacing, no invisible swipe-only actions.
- Keep last values visible without leaving active workout where possible.
- Test on actual phone with keyboard open and at 200% font-size where practical.
- Do not require network after PWA installation if offline phase is accepted and completed.

## Implemented multi-exercise entry

Start with a required user-provided workout name; no catalog exercise is inserted for a new account. The active screen can attach several existing catalog entries or create and attach a new one. Each exercise card owns independent ordered sets. Adding a row copies the previous weight only as a draft, leaves repetitions empty, and writes nothing until the user explicitly saves valid weight and repetitions. Editing a saved row also requires explicit save. Finish is enabled only when a saved set exists and no unsaved drafts or title edit remain; it opens the existing history, which retains every exercise and set after reload. Local visual checks at 360 and 390 px: `../screenshots/workout-multi-360.png`, `../screenshots/workout-multi-390.png`. The screenshots use a temporary local account and do not establish cloud browser coverage.

## Plan 006

Календарь, фильтр дня, повтор/исправление записи, справочник с изображениями и фильтрами, предыдущий вес, черновики, отдых и интервалы 30/90 дней реализованы. Пользовательский контракт и ограничения: `../operations/personal-diary.md`. Актуальные снимки: `../screenshots/diary-{workout,history,library}-390.png` — локальный тестовый owner без облачного входа.

## Plan 007

В шапке журнала доступны тема и профиль. В «Моих упражнениях» каждую запись можно убрать; активная тренировка защищена, завершённая история сохраняет упражнение. Профиль показывает реальные счётчики, email и состояние синхронизации. Резервные копии скрыты в разделе данных профиля.

Локальные визуальные проверки Plan 007: `../screenshots/profile-light-local-390.png` и `../screenshots/workout-light-local-390.png`. В профиле на скриншоте тестовые счётчики; production вычисляет их по пользовательскому журналу.

## Plan 010 — visual refinement

Светлый и тёмный режимы сохраняют одинаковую структуру всех экранов. Тёмный холст — мягкий графит, светлый — тёплый шалфей; белая или почти чёрная заливка всей страницы не нужна. Лёгкое статичное свечение допускается у верхней части холста и не должно попадать в карточки упражнений, поля подходов и графики.

Переключатель темы в шапке и на входе показывает солнце и луну и своё выбранное состояние. Нижняя навигация отделена от страницы, активная вкладка узнаётся по форме, подписи и значку. При скролле длинной тренировки главное действие, сохранённые подходы и статус синхронизации читаются первыми; оформление не добавляет ложные данные или отвлекающую анимацию. Проверить обе темы на 360 и 390px для входа, активной тренировки, истории, библиотеки, прогресса, профиля и нижних панелей; особое внимание — контрасту мелких подписей и клавиатуре iPhone.

Действия с упражнением собраны в 44px меню в строке заголовка, чтобы не разрывать связь с карточкой и не уменьшать ширину полей подходов. Кнопка сохранения параметров тела в профиле остаётся заметной вторичной кнопкой в обеих темах.
