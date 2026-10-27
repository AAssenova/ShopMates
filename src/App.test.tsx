import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { ApiError } from './lib/api'

const apiMock = vi.hoisted(() => vi.fn())

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return { ...original, api: apiMock }
})

describe('authentication screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me') return Promise.reject(new ApiError('Влезте в профила си.', 401))
      return Promise.resolve({ user: { id: 'user-1', email: 'person@example.test', display_name: 'Test', role: 'user', must_change_password: false } })
    })
  })

  it('submits email and password to the backend and reports rejected credentials', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me') return Promise.reject(new ApiError('Влезте в профила си.', 401))
      return Promise.reject(new ApiError('Имейлът или паролата не са правилни.', 401))
    })
    render(<App />)

    fireEvent.change(await screen.findByLabelText('Имейл'), { target: { value: 'person@example.test' } })
    fireEvent.change(screen.getByLabelText('Парола'), { target: { value: 'valid-password' } })
    fireEvent.click(screen.getByRole('button', { name: /Вход/ }))

    expect(apiMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'person@example.test', password: 'valid-password', display_name: '' }),
    }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Имейлът или паролата не са правилни.')
  })

  it('registers a user with a display name', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Регистрирайте се' }))
    fireEvent.change(screen.getByLabelText('Име'), { target: { value: 'Мария' } })
    fireEvent.change(screen.getByLabelText('Имейл'), { target: { value: 'maria@example.test' } })
    fireEvent.change(screen.getByLabelText('Парола'), { target: { value: 'valid-password' } })
    fireEvent.click(screen.getByRole('button', { name: /Създай профил/ }))

    expect(apiMock).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'maria@example.test', password: 'valid-password', display_name: 'Мария' }),
    }))
    expect(await screen.findByRole('button', { name: /Създай семеен списък/ })).toBeInTheDocument()
  })

  it('shows the ShopMates brand and exposes family management in the admin area', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/api/me') {
        return Promise.resolve({ user: { id: 'admin-1', email: 'admin@example.test', display_name: 'Администратор', role: 'admin', must_change_password: false } })
      }
      if (path === '/api/family') {
        return Promise.resolve({ family: { family_id: 'family-1', family_name: 'Домашно', role: 'owner', member_count: 2, members: [{ user_id: 'admin-1', display_name: 'Администратор', role: 'owner' }, { user_id: 'user-1', display_name: 'Потребител', role: 'member' }] } })
      }
      if (path === '/api/admin/overview') {
        return Promise.resolve({ users: [], stats: { users: 2, families: 1, items: 0 } })
      }
      return Promise.resolve({})
    })

    render(<App />)

    expect(await screen.findByText('ShopMates')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Админ/ }))
    expect(await screen.findByText('Списъци')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Създай списък/ })).toBeInTheDocument()
  })
})
