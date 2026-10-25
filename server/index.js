import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import pg from 'pg'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

const { Pool } = pg
const dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
})
const events = new EventEmitter()
const sessionDurationMs = 14 * 24 * 60 * 60 * 1000
const cookieName = 'shopping_session'
const isProduction = process.env.NODE_ENV === 'production'
const cookieSecure = process.env.COOKIE_SECURE === 'true'
const proxyHops = Number(process.env.TRUST_PROXY)

app.disable('x-powered-by')
app.set('trust proxy', Number.isInteger(proxyHops) && proxyHops > 0 ? proxyHops : false)
app.use(express.json({ limit: '32kb' }))
app.use((request, _response, next) => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) request.body = {}
  next()
})
app.use(cookieParser())
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})
app.use('/api', (request, response, next) => {
  const token = request.cookies?.[cookieName]
  if (token && request.method !== 'GET' && request.get('origin') && request.get('origin') !== `${request.protocol}://${request.get('host')}`) {
    return fail(response, 403, 'Заявката е отхвърлена.')
  }
  return next()
})

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isUuid(value) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    must_change_password: user.must_change_password,
  }
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}

function fail(response, status, message) {
  return response.status(status).json({ error: message })
}

async function issueSession(userId, response) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionDurationMs)
  await pool.query(
    'INSERT INTO login_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hash(token), userId, expiresAt],
  )
  response.cookie(cookieName, token, {
    httpOnly: true,
    secure: cookieSecure || (isProduction && process.env.COOKIE_SECURE !== 'false'),
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  })
}

async function requireAuth(request, response, next) {
  const token = request.cookies?.[cookieName]
  if (!token) return fail(response, 401, 'Влезте в профила си.')
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.disabled, u.must_change_password
       FROM login_sessions s JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hash(token)],
    )
    const user = rows[0]
    if (!user || user.disabled) {
      response.clearCookie(cookieName, { path: '/' })
      return fail(response, 401, 'Сесията не е валидна.')
    }
    request.user = user
    if (user.must_change_password
      && request.path !== '/api/account/change-password'
      && request.path !== '/api/logout'
      && request.path !== '/api/me') {
      return fail(response, 403, 'Сменете временната си парола, за да продължите.')
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return fail(response, 403, 'Достъпът е само за администратори.')
  return next()
}

async function currentFamily(userId) {
  const { rows } = await pool.query(
    `SELECT f.id AS family_id, f.name AS family_name, fm.role,
            (SELECT count(*)::int FROM family_members m WHERE m.family_id = f.id) AS member_count
     FROM family_members fm
     JOIN families f ON f.id = fm.family_id
     WHERE fm.user_id = $1`,
    [userId],
  )
  const family = rows[0]
  if (!family) return null
  const members = await pool.query(
    `SELECT u.id AS user_id, u.display_name, m.role
     FROM family_members m JOIN app_users u ON u.id = m.user_id
     WHERE m.family_id = $1 ORDER BY m.joined_at`,
    [family.family_id],
  )
  return { ...family, members: members.rows }
}

async function userFamilyId(userId) {
  const { rows } = await pool.query('SELECT family_id FROM family_members WHERE user_id = $1', [userId])
  return rows[0]?.family_id ?? null
}

function notifyFamily(familyId) {
  if (familyId) events.emit(`family:${familyId}`, 'changed')
}

function parseNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validateItem(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const quantity = parseNumber(body.quantity)
  const unit = typeof body.unit === 'string' ? body.unit.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const priceInput = body.estimated_unit_price
  const price = priceInput === null || priceInput === '' || priceInput === undefined ? null : parseNumber(priceInput)
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!name || name.length > 120) return 'Името трябва да е между 1 и 120 символа.'
  if (quantity === null || quantity <= 0 || quantity > 100000) return 'Количеството трябва да е между 0 и 100000.'
  if (!unit || unit.length > 20 || !category || category.length > 40) return 'Проверете мерната единица и категорията.'
  if (priceInput !== null && priceInput !== '' && priceInput !== undefined
    && (price === null || price < 0 || price > 1000000)) return 'Проверете цената.'
  if (note.length > 500) return 'Бележката е твърде дълга.'
  return { name, quantity, unit, category, price, note }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Твърде много опити. Опитайте отново след малко.' },
})

app.post('/api/auth/register', authLimiter, asyncRoute(async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  const displayName = typeof request.body.display_name === 'string' ? request.body.display_name.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(response, 400, 'Въведете валиден имейл адрес.')
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return fail(response, 400, 'Паролата трябва да е поне 8 символа и максимум 72 байта.')
  if (displayName.length > 100) return fail(response, 400, 'Името трябва да е до 100 символа.')
  const passwordHash = await bcrypt.hash(password, 12)
  try {
    const { rows } = await pool.query(
      'INSERT INTO app_users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name, role, must_change_password',
      [email, displayName, passwordHash],
    )
    await issueSession(rows[0].id, response)
    response.status(201).json({ user: publicUser(rows[0]) })
  } catch (error) {
    if (error.code === '23505') return fail(response, 409, 'Вече има профил с този имейл адрес.')
    throw error
  }
}))

app.post('/api/auth/login', authLimiter, asyncRoute(async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  const { rows } = await pool.query(
    'SELECT id, email, display_name, password_hash, role, disabled, must_change_password FROM app_users WHERE email = $1',
    [email],
  )
  const user = rows[0]
  const validPassword = user && Buffer.byteLength(password, 'utf8') <= 72
    ? await bcrypt.compare(password, user.password_hash)
    : false
  if (!user || !validPassword || user.disabled) return fail(response, 401, 'Имейлът или паролата не са правилни.')
  await issueSession(user.id, response)
  response.json({ user: publicUser(user) })
}))

app.get('/api/me', requireAuth, (request, response) => response.json({ user: publicUser(request.user) }))

app.post('/api/logout', requireAuth, asyncRoute(async (request, response) => {
  const token = request.cookies?.[cookieName]
  if (token) await pool.query('DELETE FROM login_sessions WHERE token_hash = $1', [hash(token)])
  response.clearCookie(cookieName, { path: '/' })
  response.status(204).end()
}))

app.post('/api/account/change-password', requireAuth, asyncRoute(async (request, response) => {
  const currentPassword = typeof request.body.current_password === 'string' ? request.body.current_password : ''
  const newPassword = typeof request.body.new_password === 'string' ? request.body.new_password : ''
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) return fail(response, 400, 'Новата парола трябва да е поне 8 символа и максимум 72 байта.')
  const { rows } = await pool.query('SELECT password_hash FROM app_users WHERE id = $1', [request.user.id])
  if (!await bcrypt.compare(currentPassword, rows[0].password_hash)) return fail(response, 400, 'Текущата парола не е правилна.')
  const passwordHash = await bcrypt.hash(newPassword, 12)
  await pool.query('UPDATE app_users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2', [passwordHash, request.user.id])
  response.json({ ok: true })
}))

app.get('/api/family', requireAuth, asyncRoute(async (request, response) => {
  response.json({ family: await currentFamily(request.user.id) })
}))

app.post('/api/family', requireAuth, asyncRoute(async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
  if (!name || name.length > 80) return fail(response, 400, 'Името на семейството трябва да е до 80 символа.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM app_users WHERE id = $1 FOR UPDATE', [request.user.id])
    const membership = await client.query('SELECT 1 FROM family_members WHERE user_id = $1', [request.user.id])
    if (membership.rowCount) {
      await client.query('ROLLBACK')
      return fail(response, 409, 'Вече сте член на семейство.')
    }
    const { rows } = await client.query('INSERT INTO families (name, created_by) VALUES ($1, $2) RETURNING id', [name, request.user.id])
    await client.query('INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)', [rows[0].id, request.user.id, 'owner'])
    await client.query('COMMIT')
    response.status(201).json({ family: await currentFamily(request.user.id) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.post('/api/invitations', requireAuth, asyncRoute(async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(response, 400, 'Въведете валиден имейл адрес.')
  const family = await currentFamily(request.user.id)
  if (!family || family.role !== 'owner') return fail(response, 403, 'Само собственикът на семейството може да кани.')
  const token = randomBytes(32).toString('hex')
  const { rows } = await pool.query(
    `INSERT INTO family_invitations (family_id, invited_by, invited_email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '7 days') RETURNING expires_at`,
    [family.family_id, request.user.id, email, hash(token)],
  )
  response.status(201).json({ token, expires_at: rows[0].expires_at })
}))

app.post('/api/invitations/:token/accept', requireAuth, asyncRoute(async (request, response) => {
  if (!/^[0-9a-f]{64}$/i.test(request.params.token)) return fail(response, 400, 'Кодът за покана е невалиден.')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM app_users WHERE id = $1 FOR UPDATE', [request.user.id])
    const { rows } = await client.query(
      `SELECT i.id, i.family_id, i.invited_email
       FROM family_invitations i
       WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()
       FOR UPDATE`,
      [hash(request.params.token)],
    )
    const invitation = rows[0]
    if (!invitation || invitation.invited_email !== request.user.email) {
      await client.query('ROLLBACK')
      return fail(response, 400, 'Поканата е изтекла, използвана е или е за друг имейл адрес.')
    }
    const member = await client.query('SELECT 1 FROM family_members WHERE user_id = $1', [request.user.id])
    if (member.rowCount) {
      await client.query('ROLLBACK')
      return fail(response, 409, 'Вече членувате в семейство.')
    }
    await client.query('INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)', [invitation.family_id, request.user.id, 'member'])
    await client.query('UPDATE family_invitations SET used_at = now() WHERE id = $1', [invitation.id])
    await client.query('COMMIT')
    notifyFamily(invitation.family_id)
    response.json({ family: await currentFamily(request.user.id) })
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}))

app.get('/api/items', requireAuth, asyncRoute(async (request, response) => {
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 409, 'Създайте семеен списък или използвайте покана.')
  const { rows } = await pool.query(
    `SELECT id, family_id, name, quantity, unit, category, estimated_unit_price, note,
            is_purchased, created_by, created_at, updated_at
     FROM shopping_items WHERE family_id = $1 ORDER BY created_at DESC`,
    [familyId],
  )
  response.json({ items: rows })
}))

app.post('/api/items', requireAuth, asyncRoute(async (request, response) => {
  const item = validateItem(request.body)
  if (typeof item === 'string') return fail(response, 400, item)
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 409, 'Създайте семеен списък или използвайте покана.')
  const { rows } = await pool.query(
    `INSERT INTO shopping_items (family_id, name, quantity, unit, category, estimated_unit_price, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [familyId, item.name, item.quantity, item.unit, item.category, item.price, item.note, request.user.id],
  )
  notifyFamily(familyId)
  response.status(201).json({ item: rows[0] })
}))

app.patch('/api/items/:id', requireAuth, asyncRoute(async (request, response) => {
  if (!isUuid(request.params.id)) return fail(response, 400, 'Продуктът не е намерен.')
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 403, 'Нямате достъп до този списък.')
  const fields = []
  const values = []
  const allowed = ['name', 'quantity', 'unit', 'category', 'estimated_unit_price', 'note', 'is_purchased']
  for (const key of allowed) {
    if (!Object.hasOwn(request.body, key)) continue
    const value = request.body[key]
    let normalizedValue = value
    if (key === 'is_purchased' && typeof value !== 'boolean') return fail(response, 400, 'Невалиден статус на продукта.')
    if (key === 'quantity') {
      normalizedValue = parseNumber(value)
      if (normalizedValue === null || normalizedValue <= 0 || normalizedValue > 100000) return fail(response, 400, 'Невалидно количество.')
    }
    if (key === 'name' && (typeof value !== 'string' || !value.trim() || value.trim().length > 120)) return fail(response, 400, 'Невалидно име на продукт.')
    if (key === 'name') normalizedValue = value.trim()
    if (['unit', 'category', 'note'].includes(key)) {
      if (typeof value !== 'string') return fail(response, 400, 'Невалидна стойност.')
      normalizedValue = value.trim()
      const maxLength = key === 'note' ? 500 : key === 'unit' ? 20 : 40
      if (normalizedValue.length > maxLength || (key !== 'note' && !normalizedValue)) return fail(response, 400, 'Невалидна стойност.')
    }
    if (key === 'estimated_unit_price' && value !== null) {
      normalizedValue = parseNumber(value)
      if (normalizedValue === null || normalizedValue < 0 || normalizedValue > 1000000) return fail(response, 400, 'Невалидна цена.')
    }
    values.push(normalizedValue)
    fields.push(`${key} = $${values.length}`)
  }
  if (!fields.length) return fail(response, 400, 'Няма промени за запазване.')
  values.push(request.params.id, familyId)
  const { rows } = await pool.query(
    `UPDATE shopping_items SET ${fields.join(', ')}, updated_at = now()
     WHERE id = $${values.length - 1} AND family_id = $${values.length} RETURNING *`,
    values,
  )
  if (!rows[0]) return fail(response, 404, 'Продуктът не е намерен.')
  notifyFamily(familyId)
  response.json({ item: rows[0] })
}))

app.delete('/api/items/purchased', requireAuth, asyncRoute(async (request, response) => {
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 403, 'Нямате достъп до този списък.')
  const result = await pool.query('DELETE FROM shopping_items WHERE family_id = $1 AND is_purchased = true', [familyId])
  if (result.rowCount) notifyFamily(familyId)
  response.json({ deleted: result.rowCount })
}))

app.delete('/api/items/:id', requireAuth, asyncRoute(async (request, response) => {
  if (!isUuid(request.params.id)) return fail(response, 400, 'Продуктът не е намерен.')
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 403, 'Нямате достъп до този списък.')
  const result = await pool.query('DELETE FROM shopping_items WHERE id = $1 AND family_id = $2', [request.params.id, familyId])
  if (!result.rowCount) return fail(response, 404, 'Продуктът не е намерен.')
  notifyFamily(familyId)
  response.status(204).end()
}))

app.get('/api/events', requireAuth, asyncRoute(async (request, response) => {
  const familyId = await userFamilyId(request.user.id)
  if (!familyId) return fail(response, 409, 'Няма семеен списък.')
  response.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  response.write('event: ready\ndata: {}\n\n')
  const sendUpdate = () => response.write('event: changed\ndata: {}\n\n')
  const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), 25000)
  events.on(`family:${familyId}`, sendUpdate)
  request.on('close', () => {
    clearInterval(heartbeat)
    events.off(`family:${familyId}`, sendUpdate)
  })
}))

app.get('/api/admin/overview', requireAuth, requireAdmin, asyncRoute(async (_request, response) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.disabled, u.must_change_password, u.created_at,
            f.name AS family_name,
            (SELECT count(*)::int FROM family_members m WHERE m.family_id = f.id) AS member_count
     FROM app_users u
     LEFT JOIN family_members fm ON fm.user_id = u.id
     LEFT JOIN families f ON f.id = fm.family_id
     ORDER BY u.created_at DESC`,
  )
  const counts = await pool.query(
    `SELECT (SELECT count(*)::int FROM app_users) AS users,
            (SELECT count(*)::int FROM families) AS families,
            (SELECT count(*)::int FROM shopping_items) AS items`,
  )
  response.json({ users: rows, stats: counts.rows[0] })
}))

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const userId = request.params.id
  if (!isUuid(userId)) return fail(response, 400, 'Потребителят не е намерен.')
  if (userId === request.user.id && (request.body.disabled === true || request.body.role === 'user')) {
    return fail(response, 400, 'Не можете да деактивирате или премахнете правата на собствения си профил.')
  }
  const updates = []
  const values = []
  if (typeof request.body.disabled === 'boolean') {
    values.push(request.body.disabled)
    updates.push(`disabled = $${values.length}`)
  }
  if (request.body.role === 'user' || request.body.role === 'admin') {
    values.push(request.body.role)
    updates.push(`role = $${values.length}`)
  }
  if (typeof request.body.display_name === 'string' && request.body.display_name.trim().length <= 100) {
    values.push(request.body.display_name.trim())
    updates.push(`display_name = $${values.length}`)
  }
  if (!updates.length) return fail(response, 400, 'Няма валидни промени.')
  if (request.body.role === 'user' || request.body.disabled === true) {
    const admins = await pool.query(
      `SELECT count(*)::int AS count FROM app_users
       WHERE role = 'admin' AND disabled = false AND id <> $1`,
      [userId],
    )
    const target = await pool.query('SELECT role, disabled FROM app_users WHERE id = $1', [userId])
    if (target.rows[0]?.role === 'admin' && !target.rows[0].disabled && admins.rows[0].count === 0) {
      return fail(response, 409, 'Не може да остане системата без активен администратор.')
    }
  }
  values.push(userId)
  const { rows } = await pool.query(
    `UPDATE app_users SET ${updates.join(', ')}, updated_at = now()
     WHERE id = $${values.length}
     RETURNING id, email, display_name, role, disabled, must_change_password, created_at`,
    values,
  )
  if (!rows[0]) return fail(response, 404, 'Потребителят не е намерен.')
  if (request.body.disabled === true) await pool.query('DELETE FROM login_sessions WHERE user_id = $1', [userId])
  response.json({ user: rows[0] })
}))

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  if (!isUuid(request.params.id)) return fail(response, 400, 'Потребителят не е намерен.')
  const temporaryPassword = randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(temporaryPassword, 12)
  const { rowCount } = await pool.query(
    `UPDATE app_users SET password_hash = $1, must_change_password = true, updated_at = now()
     WHERE id = $2 AND disabled = false`,
    [passwordHash, request.params.id],
  )
  if (!rowCount) return fail(response, 404, 'Активният потребител не е намерен.')
  await pool.query('DELETE FROM login_sessions WHERE user_id = $1', [request.params.id])
  response.json({ temporary_password: temporaryPassword })
}))

app.post('/api/admin/sql', requireAuth, requireAdmin, asyncRoute(async (request, response) => {
  const sql = typeof request.body.sql === 'string' ? request.body.sql.trim() : ''
  if (!sql || sql.length > 20000) return fail(response, 400, 'Заявката е празна или надхвърля 20 000 символа.')
  if (/\b(begin|commit|rollback|end|savepoint|release|set\s+role|reset\s+(?:role|all)|discard)\b/i.test(sql)
    || /\b(?:set\s+(?:(?:local|session)\s+)?(?:statement_timeout|lock_timeout)|reset\s+(?:statement_timeout|lock_timeout)|set_config\s*\()/i.test(sql)) {
    return fail(response, 400, 'Команди за управление на транзакции, роли или ограничения за изпълнение не се допускат.')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout = '5s'")
    await client.query("SET LOCAL lock_timeout = '2s'")
    const result = await client.query(sql)
    await client.query('COMMIT')
    const results = (Array.isArray(result) ? result : [result]).map((entry) => ({
      command: entry.command,
      row_count: entry.rowCount,
      rows: entry.rows?.slice(0, 200),
      truncated: (entry.rows?.length ?? 0) > 200,
      fields: entry.fields?.map((field) => field.name),
    }))
    response.json({ results })
  } catch (error) {
    await client.query('ROLLBACK')
    response.status(400).json({ error: error.message })
  } finally {
    client.release()
  }
}))

app.get('/api/health', asyncRoute(async (_request, response) => {
  await pool.query('SELECT 1')
  response.json({ status: 'ok' })
}))

app.use('/api', (_request, response) => fail(response, 404, 'API маршрутът не е намерен.'))

const distPath = path.resolve(dirname, '../dist')
app.use(express.static(distPath, { index: false, maxAge: isProduction ? '1h' : 0 }))
app.get('*', (_request, response, next) => {
  response.sendFile(path.join(distPath, 'index.html'), (error) => {
    if (error) next()
  })
})

app.use((error, _request, response, _next) => {
  console.error(error)
  if (response.headersSent) return
  response.status(500).json({ error: 'Възникна неочаквана грешка на сървъра.' })
})

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email && !password) {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD are unset; no initial admin was bootstrapped.')
    return
  }
  if (!email || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.')
  }
  const existing = await pool.query('SELECT id FROM app_users WHERE email = $1', [email])
  if (!existing.rowCount) {
    const passwordHash = await bcrypt.hash(password, 12)
    await pool.query(
      `INSERT INTO app_users (email, display_name, password_hash, role)
       VALUES ($1, 'Администратор', $2, 'admin')`,
      [email, passwordHash],
    )
    console.info(`Initial administrator created: ${email}`)
  } else {
    await pool.query("UPDATE app_users SET role = 'admin', updated_at = now() WHERE email = $1", [email])
    console.info(`Administrator access enabled for: ${email}`)
  }
}

async function start() {
  const schema = await readFile(path.join(dirname, 'schema.sql'), 'utf8')
  await pool.query(schema)
  await bootstrapAdmin()
  const port = Number(process.env.PORT ?? 3000)
  const server = app.listen(port, '0.0.0.0', () => console.info(`Shopping list server listening on ${port}`))
  const cleanup = async () => {
    server.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  setInterval(() => {
    void pool.query('DELETE FROM login_sessions WHERE expires_at <= now()')
      .catch((error) => console.error('Session cleanup failed:', error))
  }, 60 * 60 * 1000).unref()
}

start().catch((error) => {
  console.error('Server startup failed:', error)
  process.exit(1)
})
