# Design system — Hybrid Performance Dark × Athletic Pro

**Status: selected direction v0.2.** Design reference `docs/design/visual-concepts.png` shows older A/B/C; four-screen reference: `docs/design/hybrid-mobile-concept.png`. Images are inspirations; this document is authoritative.

## Product personality

Fast, focused, strong, precise. Near-black input surfaces, blue-graphite elevated surfaces, lime CTA for immediate training actions, electric blue for statistics/information. **One coherent theme** — never independently switch the screen's whole palette between A and C.

## Цветовые темы

| Token | Hex | Meaning |
| --- | --- | --- |
| `bg.canvas` | `#090D12` | app background |
| `bg.surface` | `#121B24` | cards, panels |
| `bg.elevated` | `#1A2633` | forms, overlays |
| `border.default` | `#2C3B49` | dividers/outlines |
| `text.primary` | `#F5F8FC` | main text |
| `text.secondary` | `#ADBCCB` | descriptions, captions |
| `accent.action` | `#B8FF34` | primary action / active workout |
| `accent.info` | `#37B8FF` | charts / secondary data |
| `state.success` | `#78E8B1` | synced |
| `state.warning` | `#FFC76D` | local-only pending |
| `state.danger` | `#FF7D86` | errors / destructive |

Светлая тема использует холст `#F3F6F4`, белые карточки, тёмный текст `#17251E` и тот же лаймовый CTA; для мелкого текста лаймовый заменяется контрастным зелёным `#3D6919`. Выбор темы хранится на устройстве и доступен с экрана входа и в шапке журнала. Use `#091016` on filled lime/blue buttons for readable labels. Error/success communication must never depend on color alone.

## Spacing and layout

- 4px base scale: `4, 8, 12, 16, 20, 24, 32`.
- Mobile viewport targets: 360, 375, 390, 430 CSS px; at 360 px **no horizontal scroll**.
- Page gutter `16px`, bottom safe area via `env(safe-area-inset-bottom)`; max content width `520px` on desktops (app remains phone-like).
- Card radius `16px`; buttons/inputs `12px`; chips `999px`.
- Main CTA min-height `52px`; all tappable items min `44×44px` (prefer 48px for gym actions).
- Main focus is set entry. Bottom navigation stays visible but must not overlap virtual keyboard or fields.

## Typography

Native system fonts (`system-ui`, `-apple-system`, `Segoe UI`, `Roboto`, sans-serif) — no download required.
- Page H1: 26px, 750 weight, line-height 1.15.
- Card heading: 18px, 700.
- Body: 15–16px, 450–500.
- Metric: 22–28px, tabular numbers; sets values >=16px.
- Caption: 12–13px, never use tiny faint text for vital state.

## Shared components

`AppShell`, `TopBar`, `BottomNav`, `WorkoutHeader`, `ExerciseCard`, `SetRow`, `NumericField`, `PrimaryButton`, `SecondaryButton`, `Chip`, `SaveStatus`, `EmptyState`, `ConfirmDialog`, `InlineError`, `ProgressStat`, `ChartCard` (future).

## Interaction rules

1. One primary action per view: `Добавить подход` on workout, `Начать тренировку` on home.
2. Decimal weight accepts dot or comma in input, parses precisely in domain layer; display Russian separator; no negative number; step default 2.5kg but direct input takes precedence.
3. Repeat last entered weight by default when adding a set; reps remain editable, no silent copy of completed flag.
4. Set status distinct: completed / planned. In the current workout screen, a row is saved only after explicit validation and a successful local transaction; cloud status is reported separately by AuthGate.
5. On-screen keyboard must not hide the currently edited field or Save/Add control; allow natural scroll.
6. Support focus-visible, keyboard operation, labels, `aria-live` save states and `prefers-reduced-motion`.
7. No unnecessary animated background, gradient decoration or heavy charts in active workout. Короткие переходы цвета и отклик на нажатие выключаются через `prefers-reduced-motion`.

## Save states

- `Демо — данные не сохраняются` (task 001).
- `Сохранение…` when confirmed cloud write is in flight.
- `Сохранено` only after cloud acknowledgment.
- `На устройстве · ожидает синхронизации` after IndexedDB transaction commits, not before.
- `Не удалось сохранить · повторить` for failed write with draft preserved.
- `Конфликт изменений` if a server version differs; do not silently discard local edits.

## Navigation and analytic theme

Bottom tabs: `Тренировка`, `История`, `Упражнения`, `Прогресс`. `Настройки` via top-right icon. The `Прогресс` screen uses `accent.info`, but cards and backgrounds match all other screens. Do not invent progress figures: no historical data -> honest empty state.

## Reference screenshots

`docs/design/hybrid-mobile-concept.png` is a concept sheet, NOT exact product content; values/statistics shown there are illustrative. See `screens.md` for accepted behavior and priority.

## Plan 007

Иконка сочетает штангу и растущую линию, без букв и мелких деталей. Профиль открывается круглой кнопкой справа сверху; резервное копирование находится в раскрываемом разделе. Pinch zoom разрешён для доступности, поля >=16px не запускают автоприближение при фокусе iOS. Светлая и тёмная темы проверяются на 360/390 px в локальном Chromium.
