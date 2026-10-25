import { z } from 'zod'

export const itemSchema = z.object({
  name: z.string().trim().min(1, 'Въведете име на продукта.').max(120, 'Името е твърде дълго.'),
  quantity: z.coerce.number().positive('Количеството трябва да е по-голямо от 0.').max(100000, 'Количеството е твърде голямо.'),
  unit: z.string().trim().min(1, 'Изберете мерна единица.').max(20),
  category: z.string().trim().min(1, 'Изберете категория.').max(40),
  estimated_unit_price: z.union([
    z.literal(''),
    z.coerce.number().nonnegative('Цената не може да е отрицателна.').max(1000000, 'Цената е твърде голяма.'),
  ]).optional(),
  note: z.string().trim().max(500, 'Бележката е твърде дълга.'),
})

export type ItemInput = z.infer<typeof itemSchema>

export const credentialsSchema = z.object({
  email: z.string().trim().email('Въведете валиден имейл адрес.'),
  password: z.string().min(8, 'Паролата трябва да е поне 8 символа.').max(72, 'Паролата е твърде дълга.'),
})

export const familyNameSchema = z.string().trim().min(1, 'Въведете име на семейството.').max(80, 'Името е твърде дълго.')
