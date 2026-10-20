# Mobile screen contracts — UX v0.2

**Visual reference:** `hybrid-mobile-concept.png`; selected hybrid style. Screens are product specifications; screenshots do not define DB schema.

## 0. App shell / navigation

Four tabs: `Тренировка`, `История`, `Упражнения`, `Прогресс`; settings available from header. Tabs have a visible active indicator and text labels. No inert actions; unreleased screens display explanatory empty states. Responsive at 360×800 and 390×844.

## 1. Active workout — the most important screen

Top: `Тренировка`, current local date, editable workout title; clear save status and overflow menu.
Exercise block: name, optional previous-session reference; each row shows `№ | Вес, кг | Повторы | выполнено` with per-row edit/delete actions. Primary action bottom of exercise card `+ Добавить подход`.

Behavior: tapping add creates one new row with previous weight prefilled (if available) and focused reps input. Editing updates volume immediately. Prevent duplicates from accidental double tap. Show set-level confirmation and restore ability for undo where safe. Workout-complete action must not erase edits. The header is distinct from a timer; timer is deferred.

For no workout: big `Начать тренировку` CTA, date, recent workout summary (if any). Plan 001 may begin directly with a seeded demo workout and a visible demo label.

## 2. History

Chronological newest first. Each list item: localized date, workout name, number of exercises, count of sets; total volume may appear with transparent formula. Tapping opens a **read-only previous workout** with edit action. Filters/search later.
Empty: `Пока нет тренировок` + `Начать тренировку`. Offline cached history should be labeled if stale (phase 003).

## 3. Exercises

User-scoped catalog. Search by name, quick add, recent/frequent items first when available. Add custom exercise and choose it in a workout. Avoid mandatory muscle-group taxonomy in MVP; category optional future. The list should remain usable without illustrations.
Empty: `Добавьте первое упражнение`.

## 4. Progress

Design intended: exercise picker, interval picker, `Лучший рабочий вес`, `Объём`, `Частота` metrics and readable chart. **Not part of plan 001.** Real charts only after sufficient stored records; no invented metrics. If no data: `Запишите несколько тренировок, чтобы увидеть прогресс`.

## 5. Auth / account (Plan 003; mandatory for public version)

Dedicated login with email + password. Signup screen **только для первичного onboarding при временно открытой серверной регистрации** (ADR 0007); после закрытия signup показывать `Регистрация временно закрыта`. Username/display name optional. Не рисовать работающие confirmation/reset до появления проверенной доставки email; объяснить пользователю ограничение по восстановлению пароля. Successful sign-in navigates to workout. First login requires internet. Signed-out visitors cannot see personal records. Sign-out hides previous local cache offline; warn if pending.

## 6. Settings / Data

Export personal data to versioned JSON; import is deferred and must not be falsely offered. Account status, sign out and app version. Offline phase: pending count, explicit `Синхронизировать`, retry information.

## States mandatory for each implemented screen

Loading, empty, signed out, offline with cached prior identity, first-login offline unavailable, auth expired, form invalid, save failed. `Сохранено` only after server ack. No success toasts for unsaved React state.

## One-handed gym usability

- Big buttons and controlled input spacing, no invisible swipe-only actions.
- Keep last values visible without leaving active workout where possible.
- Test on actual phone with keyboard open and at 200% font-size where practical.
- Do not require network after PWA installation if offline phase is accepted and completed.
