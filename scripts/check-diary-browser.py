"""Local Chromium + actual Dexie UI check. Requires Python playwright and Chromium.
Run npm run dev in another terminal, then python scripts/check-diary-browser.py.
No Supabase credentials, no assertions about real cloud Auth/sync.
"""
from pathlib import Path
import atexit
root = Path(__file__).resolve().parents[1]
fixtures = {'preview-workout.html': '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/src/preview-workout.tsx"></script></body></html>\n', 'src/preview-workout.tsx': "import ReactDOM from 'react-dom/client'\nimport { App } from './app/App'\nimport { DexieWorkoutRepository } from './data/local/DexieWorkoutRepository'\nimport { WorkoutDatabase } from './data/local/schema'\nimport './shared/styles.css'\nconst repository = new DexieWorkoutRepository(new WorkoutDatabase('browser-release-check'), { ownerUserId: '11111111-1111-4111-8111-111111111111' })\nObject.assign(window, { repository })\nReactDOM.createRoot(document.getElementById('root')!).render(<App repository={repository} authenticated />)\n"}
fixtures['src/preview-workout.tsx'] = fixtures['src/preview-workout.tsx'].replace(
    "ReactDOM.createRoot(document.getElementById('root')!).render(<App repository={repository} authenticated />)",
    """import { useState } from 'react'
import { ThemeToggle, useTheme } from './shared/theme'
import { ProfileDialog } from './features/auth/AuthGate'
function Preview() {
  const { theme, toggle } = useTheme()
  const [profile, setProfile] = useState(false)
  return <><header className="account-topbar"><img className="account-topbar__logo" src="/Workout_Tracker/icon-180.png" width="34" height="34" alt="Workout Tracker" /><span className="account-topbar__name">Workout Tracker</span><ThemeToggle theme={theme} onToggle={toggle} /><button className="profile-trigger" aria-label="Открыть профиль" onClick={() => setProfile(true)}>Я</button></header>{profile && <ProfileDialog email="owner@example.test" status="Синхронизировано" stats={{workouts: 2, sets: 6}} importing={false} onClose={() => setProfile(false)} onSignOut={() => {}} onExport={() => {}} onImport={() => {}} />}<App repository={repository} authenticated /></>
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)"""
)
for name in fixtures:
    if (root/name).exists(): raise RuntimeError(f'Refusing to overwrite {name}')
def cleanup():
    for name in fixtures: (root/name).unlink(missing_ok=True)
atexit.register(cleanup)
for name, content in fixtures.items(): (root/name).write_text(content)
from playwright.sync_api import sync_playwright, expect
import re,json
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for width in (360,390):
  context=browser.new_context(viewport={'width':width,'height':844},is_mobile=True,has_touch=True)
  page=context.new_page(); errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://localhost:5173/Workout_Tracker/preview-workout.html')
  page.get_by_label('Включить светлую тему').click()
  assert page.evaluate('document.documentElement.dataset.theme')=='light'
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.get_by_role('button',name='Открыть профиль').click()
  expect(page.locator('.profile-dialog')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.screenshot(path=f'/tmp/profile-light-{width}.png')
  page.get_by_role('button',name='Закрыть профиль').click()
  page.reload()
  assert page.evaluate('document.documentElement.dataset.theme')=='light'
  page.get_by_label('Включить тёмную тему').click()
  assert page.evaluate('document.documentElement.dataset.theme')=='dark'

  page.locator('#new-workout-title').fill('Силовая — проверка')
  page.get_by_role('button',name='Начать тренировку').click()
  for name in ('Жим штанги лёжа','Тяга гантели одной рукой','Моё упражнение'):
   page.get_by_role('button',name='Добавить упражнение').click()
   if name=='Моё упражнение':
    page.locator('summary').filter(has_text='Создать своё').click()
    page.locator('#custom-name').fill(name); page.get_by_role('button',name='Создать упражнение',exact=True).click()
   else:
    page.get_by_label('Поиск упражнений').fill(name)
    page.locator('.library-item').first.click()
    page.get_by_role('button',name='Выбрать упражнение').click()
   expect(page.locator('.library-screen')).to_have_count(0)
  cards=page.locator('.multi-exercise-card'); expect(cards).to_have_count(3)
  for i in range(3):
   for j in range(2):
    card=cards.nth(i);card.get_by_role('button',name='Добавить подход').click()
    save=card.get_by_role('button',name=re.compile('Сохранить подход'))
    expect(save).to_be_disabled()
    card.locator('input[inputmode=decimal]').last.fill(str(40+i*10+j*2.5))
    card.locator('input[inputmode=numeric]').last.fill('10')
    save.click();expect(save).to_have_count(0)
  cards.nth(0).get_by_role('button',name='Добавить подход').click()
  cards.nth(0).locator('input[inputmode=decimal]').last.fill('77.5')
  page.wait_for_timeout(250)
  pending=page.evaluate('window.repository.db.outbox.count()')
  page.reload();expect(cards).to_have_count(3)
  expect(cards.nth(0).locator('input[inputmode=decimal]').last).to_have_value('77.5')
  expect(page.get_by_role('button',name='Завершить тренировку')).to_be_disabled()
  assert page.evaluate('window.repository.db.outbox.count()')==pending
  cards.nth(0).get_by_role('button',name=re.compile('Удалить подход 3')).click()
  cards.nth(1).get_by_role('button',name=re.compile('Удалить подход 2')).click()
  page.get_by_role('button',name='Отменить',exact=True).click()
  expect(cards.nth(1).locator('input[inputmode=numeric]')).to_have_count(2)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'overflow workout {width}'
  page.get_by_label('Включить светлую тему').click()
  page.wait_for_timeout(260)
  page.screenshot(path=f'/tmp/release-workout-light-{width}.png',full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.get_by_label('Включить тёмную тему').click()
  page.screenshot(path=f'/tmp/release-workout-{width}.png',full_page=True)
  page.get_by_role('button',name='Завершить тренировку').click()
  expect(page.locator('.calendar-card')).to_be_visible()
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'overflow calendar {width}'
  page.screenshot(path=f'/tmp/release-history-{width}.png',full_page=True)
  page.reload();page.locator('.history-item').first.click()
  expect(page.locator('.history-sets li')).to_have_count(6)
  backup=page.evaluate('window.repository.exportAccountData()')
  assert len(json.loads(backup)['exerciseSets'])==7 # six live and a tombstone from undo
  page.get_by_role('button',name='Повторить тренировку').click()
  expect(cards).to_have_count(3)
  expect(page.locator('.training-set')).to_have_count(0)
  context.set_offline(True)
  cards.nth(0).get_by_role('button',name='Добавить подход').click()
  cards.nth(0).locator('input[inputmode=decimal]').last.fill('50')
  cards.nth(0).locator('input[inputmode=numeric]').last.fill('12')
  cards.nth(0).get_by_role('button',name=re.compile('Сохранить подход')).click()
  expect(cards.nth(0).get_by_role('button',name='Подход 1 сохранён на устройстве')).to_be_visible()
  context.set_offline(False)
  page.reload();expect(cards.nth(0).locator('input[inputmode=numeric]').last).to_have_value('12')
  page.get_by_role('button',name='Упражнения',exact=True).click()
  expect(page.locator('.library-item').first.locator('img')).to_be_visible()
  page.wait_for_timeout(500)
  assert page.locator('.library-item').first.locator('img').evaluate('(img)=>img.naturalWidth>0')
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'overflow library {width}'
  page.screenshot(path=f'/tmp/release-library-{width}.png',full_page=True)
  page.get_by_role('button',name=re.compile(r'Мои \(')).click()
  page.get_by_role('button',name='Тренировка',exact=True).click()
  page.get_by_role('button',name='Завершить тренировку').click()
  page.get_by_role('button',name='Упражнения',exact=True).click()
  expect(page.locator('.library-screen')).to_be_visible()
  page.get_by_role('button',name=re.compile(r'Мои \(')).click(timeout=3000)
  page.on('dialog', lambda dialog: dialog.accept())
  page.get_by_role('button',name='Убрать Моё упражнение из моих упражнений').click()
  expect(page.get_by_role('button',name='Убрать Моё упражнение из моих упражнений')).to_have_count(0)
  page.get_by_role('button',name='История',exact=True).click()
  page.locator('.history-item').first.click()
  assert 'Моё упражнение' in page.locator('.journal-screen').inner_text()
  expect(page.get_by_role('button',name='Исправить запись')).to_be_disabled()
  page.get_by_role('button',name='Прогресс',exact=True).click()
  expect(page.locator('#progress-exercise option').filter(has_text='Моё упражнение · архив')).to_have_count(1)

  assert not errors,errors
  print(width,'PASS: 3 exercises, 6 sets, draft reload, completion/history, repeat, offline write, archive/history/progress, both themes/profile, images, no overflow/errors')
  context.close()
 browser.close()
