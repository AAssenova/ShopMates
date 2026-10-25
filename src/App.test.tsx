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
})
