// Controlled Plan 003B Auth test. Never put passwords or JWTs in shell arguments.
// Run signup only after the owner explicitly opens the short onboarding window.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const file = join(tmpdir(), 'workout-tracker-plan003b-auth.json')
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_PUBLISHABLE_KEY
const command = process.argv[2]
const nonce = () => randomBytes(16).toString('hex')
const password = () => randomBytes(36).toString('base64url')

function client() {
  return createClient(url, key, { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
  } })
}

async function settings() {
  const response = await fetch(new URL('/auth/v1/settings', url), {
    headers: { apikey: key }, signal: AbortSignal.timeout(15000),
  })
  assert.equal(response.status, 200, `Auth settings HTTP ${response.status}`)
  const data = await response.json()
  assert.equal(typeof data.disable_signup, 'boolean', 'Auth не раскрыл статус регистрации')
  return data
}

function save(data, first = false) {
  writeFileSync(file, JSON.stringify(data), { flag: first ? 'wx' : 'w', mode: 0o600 })
  chmodSync(file, 0o600)
}

function load() {
  assert.ok(existsSync(file), 'Временный файл тестовых аккаунтов отсутствует')
  return JSON.parse(readFileSync(file, 'utf8'))
}

async function signIn(entry) {
  const { data, error } = await client().auth.signInWithPassword({ email: entry.email, password: entry.password })
  if (error) throw new Error(`Вход тестового аккаунта отклонён: ${error.code ?? 'auth_error'}`)
  assert.equal(data.user?.id, entry.id, 'Идентификатор аккаунта изменился')
  assert.ok(data.session?.access_token, 'Auth не выдал сеанс')
  return data.session.access_token
}

async function main() {
  if (command === 'help' || !command) {
    console.log('Usage: node supabase/tests/auth-pilot.mjs preflight|signup|verify|cleanup')
    return
  }
  assert.ok(['preflight', 'signup', 'verify', 'cleanup'].includes(command), 'Неизвестная фаза')
  if (command === 'cleanup') {
    if (existsSync(file)) unlinkSync(file)
    console.log('Локальные тестовые пароли удалены; облачные аккаунты не затронуты')
    return
  }
  assert.ok(url?.startsWith('https://') && key?.startsWith('sb_publishable_'), 'Нужны SUPABASE_URL и публичный SUPABASE_PUBLISHABLE_KEY')
  const config = await settings()
  if (command === 'preflight') {
    console.log(`Auth доступен; signup ${config.disable_signup ? 'закрыт' : 'открыт'}; Confirm Email ${config.mailer_autoconfirm === true ? 'выключен' : config.mailer_autoconfirm === false ? 'включён' : 'не удалось определить'}`)
    return
  }
  if (command === 'signup') {
    assert.equal(config.disable_signup, false, 'Регистрация закрыта; аккаунты не создавались')
    assert.equal(config.mailer_autoconfirm, true, 'Confirm Email должен быть выключен до создания аккаунтов')
    assert.equal(config.external?.email, true, 'Email provider должен быть включён')
    const data = existsSync(file) ? load() : {
      project: new URL(url).host,
      accounts: ['a', 'b'].map((label) => ({
        email: `workout-plan003b-${label}-${nonce()}@example.invalid`,
        password: password(), id: null,
      })),
    }
    assert.equal(data.project, new URL(url).host, 'Файл относится к другому проекту')
    assert.equal(data.accounts.length, 2, 'Ожидаются ровно два аккаунта')
    if (!existsSync(file)) save(data, true)
    for (const entry of data.accounts) {
      if (entry.id) continue
      // If a previous response was lost, test the generated credentials before retrying signup.
      const existing = await client().auth.signInWithPassword({ email: entry.email, password: entry.password })
      if (!existing.error && existing.data.user) {
        entry.id = existing.data.user.id
      } else {
        const { data: created, error } = await client().auth.signUp({ email: entry.email, password: entry.password })
        if (error) throw new Error(`Signup отклонён: ${error.code ?? 'auth_error'}`)
        assert.ok(created.user?.id && created.session?.access_token, 'Аккаунт мог быть создан без сеанса; проверьте Confirm Email и не повторяйте signup вслепую')
        entry.id = created.user.id
      }
      save(data)
    }
    console.log('Созданы ровно два тестовых аккаунта A/B. СТОП: отключите Allow new users to sign up до дальнейших тестов.')
    return
  }
  assert.equal(config.disable_signup, true, 'Регистрация ещё открыта; тесты остановлены')
  const data = load()
  assert.equal(data.project, new URL(url).host, 'Файл относится к другому проекту')
  assert.equal(data.accounts.length, 2, 'Ожидаются ровно два аккаунта')
  const [aToken, bToken] = await Promise.all(data.accounts.map(signIn))
  assert.ok(aToken !== bToken, 'A и B получили одинаковые токены')
  // This attempt is made only after the server itself reports signup disabled.
  const denied = await client().auth.signUp({
    email: `workout-plan003b-denied-${nonce()}@example.invalid`, password: password(),
  })
  assert.ok(denied.error && !denied.data.user, 'Сервер принял новый signup после закрытия регистрации; остановитесь')
  console.log('Новый signup сервером отклонён; A/B могут входить')
  const result = spawnSync(process.execPath, ['supabase/tests/security.integration.mjs'], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: key,
      TEST_USER_A_JWT: aToken, TEST_USER_B_JWT: bToken },
  })
  assert.equal(result.status, 0, 'Интеграционные security-проверки не прошли')
}

try { await main() } catch (error) {
  console.error(`Auth pilot: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`)
  process.exitCode = 1
}
