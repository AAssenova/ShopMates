import { describe, expect, it } from 'vitest'
import { estimateTotal } from './shopping'
import { credentialsSchema, itemSchema } from './validation'
import type { ShoppingItem } from '../types'

const item = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: 'item-1',
  family_id: 'family-1',
  name: 'Ябълки',
  quantity: 2,
  unit: 'кг',
  category: 'Плодове и зеленчуци',
  estimated_unit_price: 3.5,
  note: '',
  is_purchased: false,
  created_by: 'user-1',
  created_at: '',
  updated_at: '',
  ...overrides,
})

describe('shopping input validation', () => {
  it('accepts a valid item and converts numeric form values', () => {
    const parsed = itemSchema.parse({
      name: '  Ябълки ',
      quantity: '2',
      unit: 'кг',
      category: 'Плодове и зеленчуци',
      estimated_unit_price: '3.50',
      note: '',
    })
    expect(parsed.name).toBe('Ябълки')
    expect(parsed.quantity).toBe(2)
    expect(parsed.estimated_unit_price).toBe(3.5)
  })

  it.each([
    { name: '', quantity: 1, unit: 'бр.', category: 'Други', note: '' },
    { name: 'Хляб', quantity: 0, unit: 'бр.', category: 'Други', note: '' },
    { name: 'Хляб', quantity: 1, unit: 'бр.', category: 'Други', estimated_unit_price: -1, note: '' },
  ])('rejects invalid item data', (input) => {
    expect(itemSchema.safeParse(input).success).toBe(false)
  })
})

describe('account input validation', () => {
  it('accepts valid credentials and rejects weak passwords', () => {
    expect(credentialsSchema.safeParse({ email: 'a@example.test', password: 'password123' }).success).toBe(true)
    expect(credentialsSchema.safeParse({ email: 'not-an-email', password: 'short' }).success).toBe(false)
  })
})

describe('estimateTotal', () => {
  it('totals priced, unpurchased products only', () => {
    expect(estimateTotal([
      item(),
      item({ id: 'item-2', quantity: 1, estimated_unit_price: null }),
      item({ id: 'item-3', quantity: 8, is_purchased: true }),
    ])).toBe(7)
  })
})
