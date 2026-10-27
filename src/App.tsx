import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Apple, Check, CheckCheck, ChevronDown, CircleHelp, Clipboard, Cloud, CloudOff,
  Database, LogOut, Minus, Pencil, Plus, Search, Shield, ShoppingBasket, Trash2, X,
} from 'lucide-react'
import { api, ApiError } from './lib/api'
import { estimateTotal, formatAmount } from './lib/shopping'
import { credentialsSchema, familyNameSchema, itemSchema, type ItemInput } from './lib/validation'
import type { AppUser, FamilyInfo, ShoppingItem } from './types'

const categories = [
  'Плодове и зеленчуци',
  'Млечни продукти',
  'Месо и риба',
  'Хляб и тестени',
  'Напитки',
  'Домакинство',
  'Други',
]
const units = ['бр.', 'кг', 'г', 'л', 'мл', 'пакет']

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && /network|fetch|offline/i.test(error.message)) {
    return 'Няма връзка със сървъра. Проверете връзката си и опитайте отново.'
  }
  return fallback
}

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [family, setFamily] = useState<FamilyInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [adminOpen, setAdminOpen] = useState(false)

  const refreshFamily = useCallback(async () => {
    const result = await api<{ family: FamilyInfo | null }>('/api/family')
    setFamily(result.family)
  }, [])

  useEffect(() => {
    let active = true
    api<{ user: AppUser }>('/api/me')
      .then(({ user: currentUser }) => {
        if (!active) return
        setUser(currentUser)
        if (!currentUser.must_change_password) {
          void api<{ family: FamilyInfo | null }>('/api/family')
            .then(({ family: currentFamily }) => { if (active) setFamily(currentFamily) })
            .catch((error: unknown) => { if (active) setMessage(errorMessage(error, 'Семейството не може да бъде заредено.')) })
        }
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          setMessage(errorMessage(error, 'Сървърът не е достъпен.'))
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function signOut() {
    try {
      await api('/api/logout', { method: 'POST' })
      setUser(null)
      setFamily(null)
      setAdminOpen(false)
    } catch (error) {
      setMessage(errorMessage(error, 'Излизането не бе успешно.'))
    }
  }

  async function passwordChanged() {
    try {
      const { user: currentUser } = await api<{ user: AppUser }>('/api/me')
      setUser(currentUser)
      await refreshFamily()
    } catch (error) {
      setMessage(errorMessage(error, 'Паролата е сменена, но профилът не може да бъде обновен.'))
    }
  }

  if (loading) return <LoadingScreen />
  if (!user) {
    return <main className="app-shell">
      {message && <Toast message={message} onClose={() => setMessage('')} />}
      <AuthScreen onSignedIn={(nextUser) => { setUser(nextUser); setMessage('') }} onMessage={setMessage} />
    </main>
  }
  if (user.must_change_password) {
    return <main className="app-shell">
      {message && <Toast message={message} onClose={() => setMessage('')} />}
      <ChangePasswordScreen user={user} onChanged={() => void passwordChanged()} onSignOut={() => void signOut()} />
    </main>
  }

  return <main className="app-shell">
    {message && <Toast message={message} onClose={() => setMessage('')} />}
    {adminOpen && user.role === 'admin' ? (
      <AdminScreen user={user} onBack={() => setAdminOpen(false)} onSignOut={() => void signOut()} onMessage={setMessage} />
    ) : family ? (
      <ShoppingScreen
        user={user}
        family={family}
        onSignOut={() => void signOut()}
        onOpenAdmin={() => setAdminOpen(true)}
        onMessage={setMessage}
      />
    ) : (
      <FamilySetup
        user={user}
        onFamilyCreated={refreshFamily}
        onSignOut={() => void signOut()}
        onOpenAdmin={user.role === 'admin' ? () => setAdminOpen(true) : undefined}
      />
    )}
  </main>
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="toast" role="alert">{message}<button aria-label="Затвори" onClick={onClose}><X size={16} /></button></div>
}

function LoadingScreen() {
  return <main className="center-screen"><div className="loader" role="status" aria-label="Зареждане" /></main>
}

function AuthScreen({
  onSignedIn,
  onMessage,
}: {
  onSignedIn: (user: AppUser) => void
  onMessage: (message: string) => void
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [localMessage, setLocalMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalMessage('')
    if (mode === 'reset') {
      setLocalMessage('Свържете се с администратора на приложението, за да получите временна парола.')
      return
    }
    const credentials = credentialsSchema.safeParse({ email, password })
    if (!credentials.success) {
      setLocalMessage(credentials.error.issues[0]?.message ?? 'Проверете въведените данни.')
      return
    }
    if (mode === 'signup' && displayName.trim().length > 100) {
      setLocalMessage('Името трябва да е до 100 символа.')
      return
    }
    setBusy(true)
    try {
      const result = await api<{ user: AppUser }>(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, display_name: displayName.trim() }),
      })
      onSignedIn(result.user)
      if (result.user.must_change_password) onMessage('Въведете нова парола, за да продължите.')
    } catch (error) {
      setLocalMessage(errorMessage(error, mode === 'login' ? 'Входът не бе успешен.' : 'Регистрацията не бе успешна.'))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'signup' ? 'Създайте профил' : mode === 'reset' ? 'Възстановяване на парола' : 'Добре дошли отново'
  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <a className="brand" href="#"><span className="brand-mark"><ShoppingBasket size={24} /></span><span>ShopMates<span className="brand-dot">.</span></span></a>
        <div className="intro-copy">
          <p className="eyebrow">ПО-МАЛКО ЗАБРАВЕНИ НЕЩА</p>
          <h1>Пазаруването<br />е по-лесно <em>с ShopMates.</em></h1>
          <p>Един общ списък, който винаги е актуален за цялото семейство.</p>
          <div className="intro-art" aria-hidden="true"><div className="art-circle"><ShoppingBasket size={100} strokeWidth={1.2} /></div><span className="art-leaf"><Apple size={32} /></span></div>
        </div>
        <p className="intro-foot">Вашият малък помощник за всеки ден.</p>
      </div>
      <div className="auth-panel">
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <div className="mobile-brand brand"><span className="brand-mark"><ShoppingBasket size={22} /></span><span>ShopMates<span className="brand-dot">.</span></span></div>
          <p className="eyebrow">{mode === 'signup' ? 'ЗАПОЧНЕТЕ БЕЗПЛАТНО' : mode === 'reset' ? 'ВРЪЩАНЕ КЪМ ПРОФИЛА' : 'ВАШИЯТ СЕМЕЕН СПИСЪК'}</p>
          <h2>{title}</h2>
          <p className="form-subtitle">{mode === 'signup' ? 'Регистрирайте се и създайте своето семейство.' : mode === 'reset' ? 'Администраторът може да издаде временна парола.' : 'Влезте, за да видите какво ви трябва.'}</p>
          {mode === 'signup' && <label>Име<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Вашето име" /></label>}
          {mode !== 'reset' && <>
            <label>Имейл<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ime@primer.bg" /></label>
            <label>Парола<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Поне 8 символа" /></label>
          </>}
          {mode === 'login' && <button className="text-button forgot-button" type="button" onClick={() => { setLocalMessage(''); setMode('reset') }}>Забравена парола?</button>}
          {localMessage && <p className="inline-error" role="alert">{localMessage}</p>}
          {mode !== 'reset'
            ? <button className="button button-primary button-wide" disabled={busy} type="submit">{busy ? 'Моля, изчакайте…' : mode === 'signup' ? 'Създай профил' : 'Вход'}<span>→</span></button>
            : <button className="button button-primary button-wide" type="submit">Информация за възстановяване<span>→</span></button>}
          <p className="switch-mode">
            {mode === 'signup' ? 'Вече имате профил?' : 'Нямате профил?'}{' '}
            <button className="text-button" type="button" onClick={() => { setLocalMessage(''); setMode(mode === 'signup' ? 'login' : 'signup') }}>
              {mode === 'signup' ? 'Влезте' : 'Регистрирайте се'}
            </button>
          </p>
          {mode === 'reset' && <button className="text-button back-button" type="button" onClick={() => setMode('login')}>← Обратно към вход</button>}
        </form>
      </div>
    </section>
  )
}

function ChangePasswordScreen({
  user,
  onChanged,
  onSignOut,
}: {
  user: AppUser
  onChanged: () => void
  onSignOut: () => void
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword.length < 8 || newPassword.length > 72) {
      setError('Новата парола трябва да е между 8 и 72 символа.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/account/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      onChanged()
    } catch (reason) {
      setError(errorMessage(reason, 'Паролата не бе променена.'))
    } finally {
      setBusy(false)
    }
  }
  return <section className="family-setup">
    <header className="topbar"><Brand /><button className="profile-button" onClick={onSignOut}><LogOut size={16} /> Изход</button></header>
    <div className="setup-content">
      <span className="setup-icon"><Shield size={26} /></span>
      <p className="eyebrow">СИГУРНОСТ НА ПРОФИЛА</p>
      <h1>Сменете временната парола.</h1>
      <p className="setup-lead">Администраторът е издал временна парола за {user.email}. Трябва да я смените, преди да използвате приложението.</p>
      <form className="setup-form" onSubmit={(event) => void submit(event)}>
        <label>Временна парола<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>Нова парола<input type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Запазване…' : 'Смени паролата'}</button>
      </form>
    </div>
  </section>
}

function Brand() {
  return <a className="brand" href="#"><span className="brand-mark"><ShoppingBasket size={22} /></span><span>ShopMates<span className="brand-dot">.</span></span></a>
}

function FamilySetup({
  user,
  onFamilyCreated,
  onSignOut,
  onOpenAdmin,
}: {
  user: AppUser
  onFamilyCreated: () => Promise<void>
  onSignOut: () => void
  onOpenAdmin?: () => void
}) {
  const [familyName, setFamilyName] = useState('')
  const [inviteToken, setInviteToken] = useState(new URLSearchParams(window.location.search).get('invite') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function createFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = familyNameSchema.safeParse(familyName)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверете името.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api('/api/family', { method: 'POST', body: JSON.stringify({ name: parsed.data }) })
      await onFamilyCreated()
    } catch (reason) {
      setError(errorMessage(reason, 'Семейството не можа да бъде създадено.'))
    } finally {
      setBusy(false)
    }
  }

  async function acceptInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const token = inviteToken.trim()
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setError('Въведете валидния 64-символен код за покана.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' })
      window.history.replaceState({}, '', window.location.pathname)
      await onFamilyCreated()
    } catch (reason) {
      setError(errorMessage(reason, 'Поканата не може да бъде използвана. Проверете кода и имейла си.'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="family-setup">
    <header className="topbar"><Brand /><div className="topbar-right">{onOpenAdmin && <button className="button button-secondary" onClick={onOpenAdmin}><Shield size={16} /> Администратор</button>}<button className="icon-button" onClick={onSignOut} aria-label="Изход"><LogOut size={18} /></button></div></header>
    <div className="setup-content">
      <span className="setup-icon"><ShoppingBasket size={28} /></span>
      <p className="eyebrow">ВАШЕТО СЕМЕЙСТВО · {user.email}</p>
      <h1>Нека започнем<br />с нещо общо.</h1>
      <p className="setup-lead">Създайте семеен списък или се присъединете към споделен списък чрез покана.</p>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <form className="setup-form" onSubmit={(event) => void createFamily(event)}>
        <label>Име на семейството<input maxLength={80} required value={familyName} onChange={(event) => setFamilyName(event.target.value)} placeholder="Например: Семейство Иванови" /></label>
        <button className="button button-primary button-wide" type="submit" disabled={busy}>Създай семеен списък <span>→</span></button>
      </form>
      <div className="or-divider"><span>ИЛИ</span></div>
      <form className="setup-form" onSubmit={(event) => void acceptInvitation(event)}>
        <label>Код за покана<input required value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Поставете кода от поканата" /></label>
        <button className="button button-secondary button-wide" type="submit" disabled={busy}>Присъедини се към семейство</button>
      </form>
      <button className="text-button signout-link" onClick={onSignOut}>Изход от профила</button>
    </div>
  </section>
}

function ShoppingScreen({
  user,
  family,
  onSignOut,
  onOpenAdmin,
  onMessage,
}: {
  user: AppUser
  family: FamilyInfo
  onSignOut: () => void
  onOpenAdmin: () => void
  onMessage: (message: string) => void
}) {
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [itemsLoadFailed, setItemsLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Всички категории')
  const [sort, setSort] = useState<'newest' | 'name' | 'category'>('newest')
  const [showOnlyNeeded, setShowOnlyNeeded] = useState(false)
  const [editing, setEditing] = useState<ShoppingItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState('')

  const loadItems = useCallback(async () => {
    setItemsLoadFailed(false)
    try {
      const result = await api<{ items: ShoppingItem[] }>('/api/items')
      setItems(result.items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        estimated_unit_price: item.estimated_unit_price === null ? null : Number(item.estimated_unit_price),
      })))
    } catch (error) {
      setItemsLoadFailed(true)
      onMessage(errorMessage(error, 'Списъкът не може да бъде зареден.'))
    } finally {
      setLoading(false)
    }
  }, [onMessage])

  useEffect(() => {
    void loadItems()
    const source = new EventSource('/api/events')
    source.addEventListener('ready', () => setRealtimeConnected(true))
    source.addEventListener('changed', () => { void loadItems() })
    source.onerror = () => setRealtimeConnected(false)
    const handleOnline = () => { setOnline(true); void loadItems() }
    const handleOffline = () => { setOnline(false); setRealtimeConnected(false) }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      source.close()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadItems])

  useEffect(() => {
    const interval = window.setInterval(() => { if (navigator.onLine) void loadItems() }, 30000)
    return () => window.clearInterval(interval)
  }, [loadItems])

  const categoriesInList = useMemo(
    () => ['Всички категории', ...new Set(items.map((item) => item.category))],
    [items],
  )
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('bg')
    return items
      .filter((item) => !normalizedQuery || item.name.toLocaleLowerCase('bg').includes(normalizedQuery))
      .filter((item) => category === 'Всички категории' || item.category === category)
      .filter((item) => !showOnlyNeeded || !item.is_purchased)
      .sort((first, second) => {
        if (sort === 'name') return first.name.localeCompare(second.name, 'bg')
        if (sort === 'category') return first.category.localeCompare(second.category, 'bg') || first.name.localeCompare(second.name, 'bg')
        return new Date(second.created_at).getTime() - new Date(first.created_at).getTime()
      })
  }, [items, query, category, showOnlyNeeded, sort])
  const neededItems = filtered.filter((item) => !item.is_purchased)
  const purchasedItems = filtered.filter((item) => item.is_purchased)
  const neededCount = items.filter((item) => !item.is_purchased).length
  const total = estimateTotal(items)
  const displayName = user.display_name || user.email.split('@')[0] || 'Приятел'

  async function saveItem(input: ItemInput, existing?: ShoppingItem) {
    setBusy(true)
    const body = {
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      category: input.category,
      estimated_unit_price: input.estimated_unit_price === '' || input.estimated_unit_price === undefined ? null : input.estimated_unit_price,
      note: input.note,
    }
    try {
      await api(existing ? `/api/items/${existing.id}` : '/api/items', {
        method: existing ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      })
      await loadItems()
      setShowAdd(false)
      setEditing(null)
    } catch (error) {
      onMessage(errorMessage(error, 'Промяната не бе запазена. Опитайте отново.'))
    } finally {
      setBusy(false)
    }
  }

  async function updateItem(item: ShoppingItem, updates: Partial<Pick<ShoppingItem, 'quantity' | 'is_purchased'>>) {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(updates) })
      await loadItems()
    } catch (error) {
      onMessage(errorMessage(error, 'Промяната не бе запазена. Опитайте отново.'))
    } finally {
      setBusy(false)
    }
  }

  async function deleteItem(item: ShoppingItem) {
    if (busy || !window.confirm(`Да изтрием ли „${item.name}“ от списъка?`)) return
    setBusy(true)
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' })
      await loadItems()
    } catch (error) {
      onMessage(errorMessage(error, 'Продуктът не бе изтрит.'))
    } finally {
      setBusy(false)
    }
  }

  async function clearPurchased() {
    const purchased = items.filter((item) => item.is_purchased)
    if (busy || purchased.length === 0 || !window.confirm(`Да изтрием всички ${purchased.length} закупени продукта?`)) return
    setBusy(true)
    try {
      await api('/api/items/purchased', { method: 'DELETE' })
      await loadItems()
    } catch (error) {
      onMessage(errorMessage(error, 'Закупените продукти не бяха изтрити.'))
    } finally {
      setBusy(false)
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inviteBusy) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      setInviteError('Въведете валиден имейл адрес.')
      return
    }
    setInviteBusy(true)
    setInviteError('')
    try {
      const result = await api<{ token: string }>('/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      setInviteLink(`${window.location.origin}/?invite=${result.token}`)
    } catch (error) {
      setInviteError(errorMessage(error, 'Поканата не можа да бъде създадена.'))
    } finally {
      setInviteBusy(false)
    }
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      onMessage('Връзката за покана е копирана.')
    } catch {
      onMessage('Копирането не бе успешно. Маркирайте и копирайте връзката ръчно.')
    }
  }

  function renderItem(item: ShoppingItem) {
    return <article className={`item-card${item.is_purchased ? ' is-purchased' : ''}`} key={item.id}>
      <button className={`check-button${item.is_purchased ? ' checked' : ''}`} type="button" onClick={() => void updateItem(item, { is_purchased: !item.is_purchased })} aria-label={item.is_purchased ? `Отбележи ${item.name} като непокупен` : `Отбележи ${item.name} като закупен`} disabled={busy}>
        {item.is_purchased && <Check size={16} />}
      </button>
      <div className="item-main">
        <div className="item-title-line"><h3>{item.name}</h3><span className="item-quantity">{Number(item.quantity)} {item.unit}</span></div>
        <div className="item-meta"><span className="category-dot" />{item.category}{item.note && <span className="item-note">· {item.note}</span>}</div>
      </div>
      <div className="item-price">{item.estimated_unit_price !== null ? `${formatAmount(Number(item.quantity) * Number(item.estimated_unit_price))} €` : ''}</div>
      {!item.is_purchased && <div className="quantity-actions">
        <button type="button" aria-label={`Намали количеството на ${item.name}`} onClick={() => void updateItem(item, { quantity: Math.max(0.001, Number((Number(item.quantity) - 1).toFixed(3))) })} disabled={busy}><Minus size={14} /></button>
        <button type="button" aria-label={`Увеличи количеството на ${item.name}`} onClick={() => void updateItem(item, { quantity: Number((Number(item.quantity) + 1).toFixed(3)) })} disabled={busy}><Plus size={14} /></button>
      </div>}
      <div className="item-actions">
        <button type="button" aria-label={`Редактирай ${item.name}`} onClick={() => setEditing(item)}><Pencil size={16} /></button>
        <button type="button" aria-label={`Изтрий ${item.name}`} onClick={() => void deleteItem(item)} disabled={busy}><Trash2 size={16} /></button>
      </div>
    </article>
  }

  return <section className="shopping-page">
    <header className="topbar">
      <Brand />
      <div className="topbar-right">
        <div className={`sync-status ${online && realtimeConnected ? 'is-online' : 'is-offline'}`} aria-live="polite">
          {online && realtimeConnected ? <Cloud size={16} /> : <CloudOff size={16} />}
          <span>{!online ? 'Офлайн' : realtimeConnected ? 'Синхронизирано' : 'Свързване…'}</span>
        </div>
        {user.role === 'admin' && <button className="button button-secondary admin-shortcut" aria-label="Администраторски панел" onClick={onOpenAdmin}><Shield size={15} /> Админ</button>}
        <button className="profile-button" onClick={onSignOut} title={`Изход от профила ${displayName}`}>
          <span className="avatar">{displayName.charAt(0).toLocaleUpperCase('bg')}</span><span className="profile-name">{displayName}</span><LogOut size={15} />
        </button>
      </div>
    </header>
    <div className="page-content">
      <section className="welcome-row">
        <div><p className="eyebrow">{family.family_name.toLocaleUpperCase('bg')}</p><h1>Списък за пазаруване<span className="title-sparkle"> ✳</span></h1><p className="welcome-subtitle">Всичко необходимо — на едно място.</p></div>
        <div className="member-badge"><span className="member-avatars"><span>{displayName.charAt(0).toLocaleUpperCase('bg')}</span><span>{family.member_count > 1 ? '♥' : '+'}</span></span><span>{family.member_count} {family.member_count === 1 ? 'член' : 'членове'}</span></div>
      </section>
      <section className="summary-grid">
        <div className="summary-card summary-highlight"><div className="summary-icon"><ShoppingBasket size={20} /></div><div><span>За купуване</span><strong>{neededCount}<small> продукта</small></strong></div></div>
        <div className="summary-card"><div className="summary-icon summary-icon-green"><CheckCheck size={20} /></div><div><span>Закупени</span><strong>{items.filter((item) => item.is_purchased).length}<small> продукта</small></strong></div></div>
        <div className="summary-card"><div className="summary-icon summary-icon-yellow"><span className="currency-symbol">€</span></div><div><span>Ориентировъчна сума</span><strong>{formatAmount(total)}<small> €</small></strong></div><CircleHelp size={15} className="summary-help" aria-label="Сумата включва само посочените приблизителни цени." /></div>
      </section>
      <div className="workspace-grid">
        <section className="list-panel">
          <div className="list-heading"><div><h2>Вашият списък <span className="count-pill">{neededCount}</span></h2><p>Промените се споделят веднага.</p></div><button className="button button-primary add-button" onClick={() => setShowAdd(true)}><Plus size={18} /> Добави продукт</button></div>
          <div className="list-tools">
            <label className="search-box"><Search size={17} /><input aria-label="Търсене на продукт" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Търси продукт..." />{query && <button type="button" aria-label="Изчисти търсенето" onClick={() => setQuery('')}><X size={15} /></button>}</label>
            <label className="select-wrap"><span className="sr-only">Филтър по категория</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categoriesInList.map((entry) => <option key={entry}>{entry}</option>)}</select><ChevronDown size={15} /></label>
            <label className="select-wrap sort-select"><span className="sr-only">Сортиране</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Най-нови</option><option value="name">По име</option><option value="category">По категория</option></select><ChevronDown size={15} /></label>
            <label className="toggle-filter"><input type="checkbox" checked={showOnlyNeeded} onChange={(event) => setShowOnlyNeeded(event.target.checked)} /><span className="toggle-track" /><span>Само за купуване</span></label>
          </div>
          {loading ? <div className="list-loading"><div className="loader loader-small" />Зареждаме списъка…</div> : itemsLoadFailed ? (
            <div className="empty-state"><span className="empty-icon"><CloudOff size={24} /></span><h3>Списъкът не е достъпен</h3><p>Не успяхме да заредим данните от сървъра.</p><button className="button button-secondary" onClick={() => void loadItems()}>Опитай отново</button></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><span className="empty-icon"><ShoppingBasket size={25} /></span><h3>{items.length === 0 ? 'Списъкът е празен' : 'Няма намерени продукти'}</h3><p>{items.length === 0 ? 'Добавете първия продукт и започнете списъка си.' : 'Опитайте с друга дума или променете филтрите.'}</p>{items.length === 0 && <button className="button button-secondary" onClick={() => setShowAdd(true)}><Plus size={17} /> Добави продукт</button>}</div>
          ) : <>
            {neededItems.length > 0 && <div className="items-section"><div className="section-label"><span>ЗА КУПУВАНЕ</span><span className="section-count">{neededItems.length}</span></div>{neededItems.map(renderItem)}</div>}
            {purchasedItems.length > 0 && <div className="items-section purchased-section"><div className="section-label purchased-label"><span>ВЕЧЕ В КОЛИЧКАТА</span><button type="button" className="text-button clear-button" onClick={() => void clearPurchased()}>Изчисти</button></div>{purchasedItems.map(renderItem)}</div>}
          </>}
        </section>
        <aside className="sidebar">
          <section className="side-card family-card">
            <div className="side-card-title"><span className="side-icon"><span>⌂</span></span><div><h2>Нашето семейство</h2><p>{family.member_count} {family.member_count === 1 ? 'член' : 'членове'}</p></div></div>
            <div className="family-members">{family.members.map((member) => {
              const isCurrentUser = member.user_id === user.id
              const memberName = isCurrentUser ? displayName : member.display_name || 'Член на семейството'
              return <div className="family-member" key={member.user_id}>
                <span className={`avatar${member.role === 'owner' ? ' avatar-peach' : ''}`}>{memberName.charAt(0).toLocaleUpperCase('bg')}</span>
                <span><strong>{memberName}</strong><small>{member.role === 'owner' ? 'Собственик' : 'Член'}{isCurrentUser ? ' · Вие' : ''}</small></span>
              </div>
            })}</div>
            {family.role === 'owner' && <form className="invite-form" onSubmit={(event) => void createInvitation(event)}>
              <label>Имейл за покана<input type="email" required value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="приятел@пример.бг" /></label>
              <button className="button button-secondary button-wide" type="submit" disabled={inviteBusy}>{inviteBusy ? 'Създаваме…' : 'Създай покана'}<span>→</span></button>
              {inviteError && <p className="inline-error" role="alert">{inviteError}</p>}
              {inviteLink && <div className="invite-result"><label>Еднократна връзка · валидна 7 дни<input readOnly value={inviteLink} onFocus={(event) => event.target.select()} /></label><button className="button button-primary button-wide" type="button" onClick={() => void copyInvitation()}><Clipboard size={15} /> Копирай поканата</button><p>Само профил с имейл {inviteEmail} може да я използва.</p></div>}
            </form>}
            {family.member_count > 1 && <p className="family-full-note"><Check size={15} /> Списъкът е споделен със семейството.</p>}
          </section>
          <section className="tip-card"><span className="tip-icon">✦</span><div><strong>Малък съвет</strong><p>Добавете бележка към продукт, за да не забравите любимата марка или точния размер.</p></div></section>
          <div className="privacy-note"><span>🔒</span><p>Списъкът е личен и достъпен само за членовете на вашето семейство.</p></div>
        </aside>
      </div>
      <footer className="app-footer"><span>Направено с грижа за ежедневието <span className="heart">♥</span></span><span>Семейният списък · {family.family_name}</span></footer>
    </div>
    {(showAdd || editing) && <ItemDialog
      item={editing ?? undefined}
      busy={busy}
      onClose={() => { setShowAdd(false); setEditing(null) }}
      onSave={(input) => saveItem(input, editing ?? undefined)}
    />}
  </section>
}

function ItemDialog({
  item,
  busy,
  onClose,
  onSave,
}: {
  item?: ShoppingItem
  busy: boolean
  onClose: () => void
  onSave: (input: ItemInput) => Promise<void>
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1))
  const [unit, setUnit] = useState(item?.unit ?? 'бр.')
  const [category, setCategory] = useState(item?.category ?? categories[0])
  const [price, setPrice] = useState(item?.estimated_unit_price == null ? '' : String(item.estimated_unit_price))
  const [note, setNote] = useState(item?.note ?? '')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = itemSchema.safeParse({ name, quantity, unit, category, estimated_unit_price: price, note })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверете въведените данни.')
      return
    }
    setError('')
    await onSave(parsed.data)
  }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="item-dialog" role="dialog" aria-modal="true" aria-labelledby="item-dialog-title">
      <div className="dialog-heading"><div><p className="eyebrow">{item ? 'ПРОМЯНА' : 'НОВО В СПИСЪКА'}</p><h2 id="item-dialog-title">{item ? 'Редактирай продукт' : 'Добави продукт'}</h2></div><button className="icon-button" type="button" aria-label="Затвори" onClick={onClose}><X size={19} /></button></div>
      <form onSubmit={(event) => void submit(event)} className="item-form">
        <label>Име на продукта<input autoFocus maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} placeholder="Например: Прясно мляко" /></label>
        <div className="form-row"><label>Количество<input type="number" min="0.001" max="100000" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Мерна единица<select value={unit} onChange={(event) => setUnit(event.target.value)}>{units.map((entry) => <option key={entry}>{entry}</option>)}</select></label></div>
        <label>Категория<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label>Приблизителна цена за единица <span className="optional-label">(незадължително)</span><div className="price-input"><input type="number" min="0" max="1000000" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0,00" /><span>€</span></div></label>
        <label>Бележка <span className="optional-label">(незадължително)</span><textarea maxLength={500} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Марка, размер или друго..." /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>Отказ</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Запазване…' : item ? 'Запази промените' : 'Добави в списъка'}</button></div>
      </form>
    </section>
  </div>
}

type AdminUser = {
  id: string
  email: string
  display_name: string
  role: 'user' | 'admin'
  disabled: boolean
  must_change_password: boolean
  created_at: string
  family_name: string | null
  member_count: number | null
}

type AdminFamily = {
  family_id: string
  family_name: string
  member_count: number
  created_by: string
  created_at: string
  members: Array<{ user_id: string; email: string; display_name: string; role: 'owner' | 'member' }>
}

function AdminScreen({
  user,
  onBack,
  onSignOut,
  onMessage,
}: {
  user: AppUser
  onBack: () => void
  onSignOut: () => void
  onMessage: (message: string) => void
}) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [families, setFamilies] = useState<AdminFamily[]>([])
  const [stats, setStats] = useState({ users: 0, families: 0, items: 0 })
  const [newFamilyName, setNewFamilyName] = useState('')
  const [newFamilyError, setNewFamilyError] = useState('')
  const [newMemberEmail, setNewMemberEmail] = useState<Record<string, string>>({})
  const [newMemberError, setNewMemberError] = useState<Record<string, string>>({})
  const [sql, setSql] = useState('SELECT id, email, role, disabled, created_at FROM app_users ORDER BY created_at DESC;')
  const [sqlResults, setSqlResults] = useState<unknown>(null)
  const [sqlBusy, setSqlBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [temporaryPasswords, setTemporaryPasswords] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const [overviewResult, familiesResult] = await Promise.all([
      api<{ users: AdminUser[]; stats: typeof stats }>('/api/admin/overview'),
      api<{ families: AdminFamily[] }>('/api/admin/families'),
    ])
    setUsers(overviewResult.users)
    setStats(overviewResult.stats)
    setFamilies(familiesResult.families)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setLoading(false)
      onMessage(errorMessage(error, 'Административните данни не могат да бъдат заредени.'))
    })
  }, [refresh, onMessage])

  async function updateUser(target: AdminUser, patch: { role?: 'user' | 'admin'; disabled?: boolean }) {
    try {
      await api(`/api/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await refresh()
    } catch (error) {
      onMessage(errorMessage(error, 'Профилът не бе променен.'))
    }
  }

  async function resetPassword(target: AdminUser) {
    if (!window.confirm(`Да издадем временна парола за ${target.email}? Предишните сесии ще бъдат прекратени.`)) return
    try {
      const result = await api<{ temporary_password: string }>(`/api/admin/users/${target.id}/reset-password`, { method: 'POST' })
      setTemporaryPasswords((current) => ({ ...current, [target.id]: result.temporary_password }))
      await refresh()
    } catch (error) {
      onMessage(errorMessage(error, 'Паролата не бе нулирана.'))
    }
  }

  async function createFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newFamilyName.trim()
    if (!name) {
      setNewFamilyError('Въведете име на списъка.')
      return
    }
    setNewFamilyError('')
    try {
      await api('/api/admin/families', { method: 'POST', body: JSON.stringify({ name }) })
      setNewFamilyName('')
      await refresh()
    } catch (error) {
      setNewFamilyError(errorMessage(error, 'Списъкът не бе създаден.'))
    }
  }

  async function deleteFamily(familyId: string) {
    if (!window.confirm('Да изтрием ли този списък и всичките му продукти?')) return
    try {
      await api(`/api/admin/families/${familyId}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      onMessage(errorMessage(error, 'Списъкът не бе изтрит.'))
    }
  }

  async function addMemberToFamily(familyId: string, email: string) {
    const normalized = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setNewMemberError((current) => ({ ...current, [familyId]: 'Въведете валиден имейл адрес.' }))
      return
    }
    setNewMemberError((current) => ({ ...current, [familyId]: '' }))
    try {
      await api(`/api/admin/families/${familyId}/members`, { method: 'POST', body: JSON.stringify({ email: normalized }) })
      setNewMemberEmail((current) => ({ ...current, [familyId]: '' }))
      await refresh()
    } catch (error) {
      setNewMemberError((current) => ({ ...current, [familyId]: errorMessage(error, 'Членът не бе добавен.') }))
    }
  }

  async function removeMemberFromFamily(familyId: string, userId: string) {
    if (!window.confirm('Да премахнем ли този потребител от списъка?')) return
    try {
      await api(`/api/admin/families/${familyId}/members/${userId}`, { method: 'DELETE' })
      await refresh()
    } catch (error) {
      onMessage(errorMessage(error, 'Членът не бе премахнат.'))
    }
  }

  async function executeSql(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const modifiesData = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)
    if (modifiesData && !window.confirm('Заявката може да промени или изтрие данни/структура. Изпълнението е необратимо без резервно копие. Продължавате ли?')) return
    setSqlBusy(true)
    setSqlResults(null)
    try {
      const result = await api<{ results: unknown[] }>('/api/admin/sql', { method: 'POST', body: JSON.stringify({ sql }) })
      setSqlResults(result.results)
      try {
        await refresh()
      } catch (error) {
        onMessage(errorMessage(error, 'SQL заявката се изпълни, но административните данни не могат да бъдат обновени.'))
      }
    } catch (error) {
      setSqlResults({ error: errorMessage(error, 'SQL заявката не бе изпълнена.') })
    } finally {
      setSqlBusy(false)
    }
  }

  return <section className="admin-page">
    <header className="topbar">
      <Brand />
      <div className="topbar-right"><button className="button button-secondary" onClick={onBack}>Към списъка</button><button className="profile-button" onClick={onSignOut}><span className="avatar">{(user.display_name || user.email).charAt(0).toLocaleUpperCase('bg')}</span><span className="profile-name">{user.display_name || user.email}</span><LogOut size={15} /></button></div>
    </header>
    <div className="admin-content">
      <div className="admin-heading"><div><p className="eyebrow">УПРАВЛЕНИЕ НА ПРИЛОЖЕНИЕТО</p><h1><Shield size={25} /> Администраторски панел</h1><p>Управлявайте потребителите и базата данни на вашата инсталация.</p></div><button className="button button-secondary" onClick={() => void refresh()}><Database size={16} /> Обнови</button></div>
      <section className="admin-stats">
        <div className="summary-card"><span>Потребители</span><strong>{stats.users}</strong></div>
        <div className="summary-card"><span>Семейства</span><strong>{stats.families}</strong></div>
        <div className="summary-card"><span>Продукти</span><strong>{stats.items}</strong></div>
      </section>
      <section className="admin-panel">
        <div className="admin-panel-title"><div><h2>Потребители</h2><p>Нулирането прекратява всички активни сесии и изисква смяна на паролата.</p></div></div>
        {loading ? <div className="list-loading"><div className="loader loader-small" />Зареждаме потребителите…</div> : <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Потребител</th><th>Семейство</th><th>Роля / статус</th><th>Действия</th></tr></thead>
            <tbody>{users.map((target) => <tr key={target.id}>
              <td><strong>{target.display_name || target.email}</strong><small>{target.email}</small>{temporaryPasswords[target.id] && <code className="temporary-password">Временна парола: {temporaryPasswords[target.id]}</code>}</td>
              <td>{target.family_name ?? '—'}{target.member_count ? <small>{target.member_count} членове</small> : null}</td>
              <td><span className={`admin-status${target.disabled ? ' is-disabled' : ''}`}>{target.disabled ? 'Деактивиран' : target.role === 'admin' ? 'Администратор' : 'Потребител'}</span>{target.must_change_password && <small>Чака смяна на парола</small>}</td>
              <td><div className="admin-actions">
                <button className="button button-secondary" onClick={() => void updateUser(target, { role: target.role === 'admin' ? 'user' : 'admin' })} disabled={target.id === user.id}>{target.role === 'admin' ? 'Премахни админ' : 'Направи админ'}</button>
                <button className="button button-secondary" onClick={() => void resetPassword(target)} disabled={target.disabled || target.id === user.id}>Нулирай парола</button>
                <button className="button button-secondary" onClick={() => void updateUser(target, { disabled: !target.disabled })} disabled={target.id === user.id}>{target.disabled ? 'Активирай' : 'Деактивирай'}</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      <section className="admin-panel">
        <div className="admin-panel-title"><div><h2>Списъци</h2><p>Създавайте нови списъци, изтривайте съществуващи и управлявайте членове във всеки списък.</p></div></div>
        <form onSubmit={(event) => void createFamily(event)} className="family-create-form">
          <label>Име на списъка<input value={newFamilyName} onChange={(event) => setNewFamilyName(event.target.value)} placeholder="Например: Къща или Град" /></label>
          <button className="button button-primary" type="submit">Създай списък</button>
        </form>
        {newFamilyError && <p className="inline-error" role="alert">{newFamilyError}</p>}
        {families.length === 0 ? <p className="empty-hint">Няма създадени списъци.</p> : <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Списък</th><th>Членове</th><th>Действия</th></tr></thead>
            <tbody>{families.map((family) => <tr key={family.family_id}>
              <td><strong>{family.family_name}</strong><small>{family.member_count} членове</small></td>
              <td>
                <div className="family-member-list">{family.members.length === 0 ? <span>—</span> : family.members.map((member) => <div key={member.user_id} className="family-member-row"><span>{member.display_name || member.email}</span><button className="button button-secondary" type="button" onClick={() => void removeMemberFromFamily(family.family_id, member.user_id)}>Премахни</button></div>)}</div>
              </td>
              <td><div className="admin-actions">
                <div className="inline-add-member">
                  <input value={newMemberEmail[family.family_id] ?? ''} onChange={(event) => setNewMemberEmail((current) => ({ ...current, [family.family_id]: event.target.value }))} placeholder="имейл@пример.bg" />
                  <button className="button button-secondary" type="button" onClick={() => void addMemberToFamily(family.family_id, newMemberEmail[family.family_id] ?? '')}>Добави член</button>
                </div>
                {newMemberError[family.family_id] && <p className="inline-error" role="alert">{newMemberError[family.family_id]}</p>}
                <button className="button button-secondary" type="button" onClick={() => void deleteFamily(family.family_id)}>Изтрий списък</button>
              </div></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
      <section className="admin-panel sql-panel">
        <div className="admin-panel-title"><div><h2><Database size={19} /> SQL конзола</h2><p>Работи с PostgreSQL от името на административния профил. Направете резервно копие преди промени.</p></div></div>
        <form onSubmit={(event) => void executeSql(event)}>
          <label className="sr-only" htmlFor="admin-sql">SQL заявка</label>
          <textarea id="admin-sql" className="sql-editor" spellCheck={false} value={sql} onChange={(event) => setSql(event.target.value)} />
          <div className="sql-toolbar"><span>Изходът ограничава визуализирането до първите 200 реда на заявка.</span><button className="button button-primary" disabled={sqlBusy}>{sqlBusy ? 'Изпълнение…' : 'Изпълни заявката'}</button></div>
        </form>
        {sqlResults !== null && <pre className="sql-results" role="status">{JSON.stringify(sqlResults, null, 2)}</pre>}
      </section>
      <p className="admin-warning"><Shield size={16} /> Достъпът до този панел е ограничен до администратори. SQL заявките могат да променят или изтрият данни.</p>
    </div>
  </section>
}
