import type { ShoppingItem } from '../types'

export function estimateTotal(items: ShoppingItem[]): number {
  return items
    .filter((item) => !item.is_purchased && item.estimated_unit_price !== null)
    .reduce((sum, item) => sum + item.quantity * Number(item.estimated_unit_price), 0)
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('bg-BG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}
