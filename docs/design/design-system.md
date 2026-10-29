# Design system — Hybrid Performance Dark × Athletic Pro

**Status: selected direction v0.3 (Plan 010 refinement).** Design reference `docs/design/visual-concepts.png` shows older A/B/C; four-screen reference: `docs/design/hybrid-mobile-concept.png`. Images are inspirations; this document is authoritative.

## Product personality

Fast, focused, strong, precise. Warm graphite surfaces in dark mode, muted sage canvas in light mode, lime CTA for immediate training actions, electric blue for statistics/information. **One coherent theme** — never independently switch the screen's whole palette between A and C. Both modes share the same hierarchy and spacing.

## Цветовые темы

| Token | Hex | Meaning |
| --- | --- | --- |
| `bg.canvas` | `#151D22` | app background |
| `bg.surface` | `#202B31` | cards, panels |
| `bg.elevated` | `#2A3940` | forms, overlays |
| `border.default` | `#3B4E55` | dividers/outlines |
| `text.primary` | `#F1F5F2` | main text |
| `text.secondary` | `#B4C3BF` | descriptions, captions |
| `accent.action` | `#B8FF34` | primary action / active workout |
| `accent.info` | `#37B8FF` | charts / secondary data |
| `state.success` | `#78E8B1` | synced |
| `state.warning` | `#FFC76D` | local-only pending |
| `state.danger` | `#FF7D86` | errors / destructive |

Светлая тема использует холст `#F1F3ED`, тёплые карточки `#FBFCF8`, приподнятые поверхности `#E9EEE6`, границы `#CCD8CD`, основной текст `#1B2A23` и вторичный `#53665A`. Лаймовый CTA остаётся главным акцентом; для мелкого текста лаймовый заменяется контрастным зелёным `#3D6919`. Выбор темы хранится на устройстве и доступен с экрана входа и в шапке журнала. Use `#091016` on filled lime/blue buttons for readable labels. Error/success communication must never depend on color alone.

Фон допускает только **статичное низкоконтрастное свечение** у верхнего края холста; рисунок не должен попадать на поля, карточки подходов или графики. Не использовать повторяющийся паттерн, шум, блеск либо постоянную анимацию. Карточки должны оставаться спокойными и однородными, чтобы числа и кнопки читались во время тренировки. Граница и небольшая тень отделяют их от холста; не накладывать сильные тени на каждую строку подхода.

## Spacing and layout

- 4px base scale: `4, 8, 12, 16, 20, 24, 32`.
- Mobile viewport targets: 360, 375, 390, 430 CSS px; at 360 px **no horizontal scroll**.
- Page gutter `16px`, bottom safe area via `env(safe-area-inset-bottom)`; max content width `520px` on desktops (app remains phone-like).
- Card radius `16px`; buttons/inputs `12px`; chips `999px`.
- Main CTA min-height `52px`; all tappable items min `44×44px` (prefer 48px for gym actions).
- Main focus is set entry. Bottom navigation stays visible but must not overlap virtual keyboard or fields.
- Между основными секциями 20–24px, между однотипными карточками 10–14px; внутри карточки 14–20px. Подходы остаются компактными и не должны расти ради декоративного эффекта. На ширине 360px заголовки и кнопки не создают горизонтальную прокрутку.

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
7. В активной тренировке нет анимированного фона, декоративных градиентов внутри карточек или тяжёлых графиков. Короткие переходы цвета и отклик на нажатие выключаются через `prefers-reduced-motion`.
8. Переключатель темы имеет понятные значки солнца и луны, видимое текущее состояние и зону касания не меньше `44px` по высоте. Мягкий переход подложки допускается только при обычных настройках движения; выбранная тема сохраняется после перезагрузки. Для озвучивания используется явное действие в `aria-label`.
9. В нижней навигации активную вкладку различают значок, подпись и форма/подложка, а не один цвет. Панель отделена от содержимого тонкой границей и мягкой тенью, не перекрывает поля и учитывает нижний safe area iPhone.

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

Иконка сочетает штангу и растущую линию, без букв и мелких деталей. Профиль открывается круглой кнопкой справа сверху; резервное копирование находится в раскрываемом разделе. Поля >=16px не запускают автоприближение при фокусе iOS. Светлая и тёмная темы проверяются на 360/390 px в локальном Chromium.

## Plan 009 — графики, изображения и панель выбора

Графики имеют видимые точки и подписи дат; при одной записи показывают точку и честное пояснение. Миниатюры упражнений кадрируются под форму карточки без светлой подложки и режима смешивания; исходные кадры доступны в подробной карточке. Список упражнений прогресса открывается как нижняя панель с поиском, контрастным выбранным пунктом и крупными зонами касания. По прямому запросу владельца viewport и `touch-action` ограничивают масштаб страницы; iOS Safari игнорирует viewport для pinch, поэтому браузерные `gesturestart/gesturechange` подавляются. Системное увеличение текста и Accessibility Zoom не блокируются. Поведение Safari требует проверки на физическом iPhone.

## Plan 010 — visual refinement

Цвета, переключатель темы, тонкий фон и навигация уточнены выше. Изменение темы не влияет на тренировочные данные, состояние авторизации или синхронизации. Контраст проверяется для текста, подписей графиков, кнопок и состояний disabled/error в обеих темах; видимый фокус и `prefers-reduced-motion` обязательны. Снимки Chromium на 360/390px полезны для композиции, но не доказывают поведение физического iPhone.
